import AVKit
import Combine
import SwiftUI

/// Something to play. `start` is where to begin, in seconds into the file.
struct PlayRequest: Identifiable {
    let id = UUID()
    let type: MediaType
    let mediaId: Int
    let start: Int
    let title: String
    let subtitle: String?
}

/// Shared by every screen: set `request` to open the full-screen player.
@MainActor
final class PlayerPresenter: ObservableObject {
    @Published var request: PlayRequest?

    func play(_ type: MediaType, id: Int, from start: Int, title: String, subtitle: String? = nil) {
        request = PlayRequest(type: type, mediaId: id, start: start, title: title, subtitle: subtitle)
    }
}

/// Drives one AVPlayer for the custom player screen: position/duration for the
/// controls, debounced seeking, progress saving, and Up Next for episodes.
@MainActor
final class PlaybackController: ObservableObject {
    let player = AVPlayer()

    @Published private(set) var title: String
    @Published private(set) var subtitle: String?
    @Published private(set) var position: Double = 0      // seconds into the whole file
    @Published private(set) var duration: Double = 0      // whole file; 0 until known
    @Published private(set) var isPlaying = false
    @Published private(set) var isBuffering = true
    @Published private(set) var pendingSeek: Double?      // where the user is skipping to
    @Published private(set) var buffered: Double = 0      // seconds into the file that are loaded
    @Published private(set) var upNext: NextEpisode?
    @Published private(set) var upNextSeconds = 30
    @Published var upNextDismissed = false
    @Published private(set) var errorText: String?

    private let session: Session
    private let onFinished: () -> Void
    private var current: PlayRequest
    private var timeObserver: Any?
    private var cancellables = Set<AnyCancellable>()
    private var itemCancellables = Set<AnyCancellable>()
    private var seekCommit: Task<Void, Never>?
    private var lastSaved = Date()
    private var advancing = false
    private var stopped = false
    /// Asking the server to re-encode everything (after this item failed once).
    private var compat = false

    // Subtitles: the title's tracks, the chosen one (nil = off) and the lines
    // showing now. Drawn by PlayerView, timed to the file's own clock.
    @Published private(set) var subtitleTracks: [SubtitleTrack] = []
    @Published private(set) var selectedSubtitle: String?
    @Published private(set) var subtitleLines: [String] = []
    @Published private(set) var subtitleLoading = false
    private var cues: [SubtitleCue] = []
    private var subtitleObserver: Any?
    private var subtitleMedia: String?
    private var subtitleTask: Task<Void, Never>?
    private static let subtitleLanguageKey = "subtitleLanguage"

    var remaining: Double { max(0, duration - position) }

    /// The Up Next card: the last `upNextSeconds` of an episode that has a next one.
    var showUpNext: Bool {
        guard upNext != nil, !upNextDismissed, duration > 0 else { return false }
        return remaining > 0 && remaining <= Double(upNextSeconds)
    }

    init(session: Session, request: PlayRequest, onFinished: @escaping () -> Void) {
        self.session = session
        self.onFinished = onFinished
        self.current = request
        self.title = request.title
        self.subtitle = request.subtitle

        // Subtitles need finer timing than the controls.
        subtitleObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.1, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.updateSubtitleLines() }
        }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        player.publisher(for: \.timeControlStatus)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                Task { @MainActor in
                    guard let self else { return }
                    let playing = status == .playing, buffering = status == .waitingToPlayAtSpecifiedRate
                    if self.isPlaying != playing { self.isPlaying = playing }
                    if self.isBuffering != buffering { self.isBuffering = buffering }
                }
            }
            .store(in: &cancellables)
        load(request)
    }

    // MARK: Loading

    /// `compat`: ask the server to fully re-encode — used to retry a stream that
    /// failed, and kept for seeks in the same title.
    private func load(_ request: PlayRequest, compat: Bool = false) {
        current = request
        self.compat = compat
        // A different title (not a seek or retry of this one): fetch its subtitle tracks.
        let mediaKey = "\(request.type.rawValue)-\(request.mediaId)"
        if mediaKey != subtitleMedia {
            subtitleMedia = mediaKey
            loadSubtitleTracks(type: request.type, id: request.mediaId)
        }
        title = request.title
        subtitle = request.subtitle
        position = Double(request.start)
        buffered = Double(request.start)
        duration = 0
        pendingSeek = nil
        upNext = nil
        upNextDismissed = false
        errorText = nil
        advancing = false
        isBuffering = true

        guard let url = session.streamURL(type: request.type, id: request.mediaId, start: request.start, compat: compat) else {
            errorText = "You're signed out — sign in again to play."
            return
        }
        let item = AVPlayerItem(url: url)
        itemCancellables.removeAll()
        NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in Task { @MainActor in await self?.didReachEnd() } }
            .store(in: &itemCancellables)
        item.publisher(for: \.status)
            .receive(on: DispatchQueue.main)
            .sink { [weak self, weak item] status in
                Task { @MainActor in
                    if status == .failed { self?.itemFailed(item?.error) }
                }
            }
            .store(in: &itemCancellables)
        player.replaceCurrentItem(with: item)
        player.play()

        if request.type == .episode {
            let id = request.mediaId
            Task { await loadUpNext(for: id) }
        }
    }

    /// Some files can't be streamed as-is (e.g. "CoreMediaErrorDomain error
    /// -12971"); try once more with the server re-encoding everything, from
    /// where playback got to.
    private func itemFailed(_ error: Error?) {
        guard !compat, !stopped else {
            errorText = error?.localizedDescription ?? "This video couldn't be played."
            return
        }
        let r = current
        let resumeAt = max(r.start, Int(pendingSeek ?? position))
        load(PlayRequest(type: r.type, mediaId: r.mediaId, start: resumeAt, title: r.title, subtitle: r.subtitle), compat: true)
    }

    // MARK: Subtitles

    private func loadSubtitleTracks(type: MediaType, id: Int) {
        subtitleTask?.cancel()
        subtitleTracks = []
        selectedSubtitle = nil
        cues = []
        subtitleLines = []
        subtitleTask = Task { [weak self] in
            guard let self else { return }
            let response = try? await self.session.get("/api/subtitles/\(type.rawValue)/\(id)", as: SubtitleTracksResponse.self)
            guard let response, !Task.isCancelled, self.subtitleMedia == "\(type.rawValue)-\(id)" else { return }
            self.subtitleTracks = response.tracks
            // Turn on the language used last time, if this title has it.
            if let language = UserDefaults.standard.string(forKey: Self.subtitleLanguageKey), language != "off",
               let track = response.tracks.first(where: { $0.language == language && !$0.forced }) ?? response.tracks.first(where: { $0.language == language }) {
                await self.loadCues(track)
            }
        }
    }

    /// nil turns subtitles off. Remembers the language for next time.
    func selectSubtitle(_ track: SubtitleTrack?) {
        UserDefaults.standard.set(track?.language ?? "off", forKey: Self.subtitleLanguageKey)
        subtitleTask?.cancel()
        guard let track else {
            selectedSubtitle = nil
            cues = []
            subtitleLines = []
            subtitleLoading = false
            return
        }
        subtitleTask = Task { [weak self] in await self?.loadCues(track) }
    }

    private func loadCues(_ track: SubtitleTrack) async {
        guard let media = subtitleMedia else { return }
        let parts = media.split(separator: "-")
        guard parts.count == 2 else { return }
        selectedSubtitle = track.id
        cues = []
        subtitleLines = []
        subtitleLoading = true
        let text = try? await session.getText("/api/subtitles/\(parts[0])/\(parts[1])/\(track.id).vtt")
        guard !Task.isCancelled, subtitleMedia == media, selectedSubtitle == track.id else { return }
        subtitleLoading = false
        // If they can't be loaded, show subtitles as off rather than stuck on "Loading".
        if let text { cues = WebVTT.parse(text) } else { selectedSubtitle = nil }
        updateSubtitleLines()
    }

    private func updateSubtitleLines() {
        guard !cues.isEmpty else {
            if !subtitleLines.isEmpty { subtitleLines = [] }
            return
        }
        let seconds = player.currentTime().seconds
        guard seconds.isFinite, pendingSeek == nil else { return }
        let lines = WebVTT.lines(in: cues, at: Double(current.start) + seconds)
        if lines != subtitleLines { subtitleLines = lines }
    }

    private func loadUpNext(for episodeId: Int) async {
        let response = try? await session.get("/api/tv/episode/\(episodeId)/next", as: NextEpisodeResponse.self)
        guard let response, current.mediaId == episodeId, current.type == .episode else { return }
        upNext = response.next
        upNextSeconds = max(5, response.upNextSeconds)
    }

    private func tick() {
        // Only publish real changes: every change redraws the glass controls.
        let seconds = player.currentTime().seconds
        if seconds.isFinite, pendingSeek == nil {
            let newPosition = Double(current.start) + seconds
            if abs(newPosition - position) >= 0.25 { position = newPosition }
        }
        if let itemDuration = player.currentItem?.duration.seconds, itemDuration.isFinite, itemDuration > 0 {
            let newDuration = Double(current.start) + itemDuration
            if newDuration != duration { duration = newDuration }
        }
        // How far ahead is loaded (the lighter part of the progress bar).
        if let ranges = player.currentItem?.loadedTimeRanges, seconds.isFinite {
            var end = seconds
            for value in ranges {
                let range = value.timeRangeValue
                let start = range.start.seconds, rangeEnd = (range.start + range.duration).seconds
                if start.isFinite, rangeEnd.isFinite, start <= seconds + 1, rangeEnd > end { end = rangeEnd }
            }
            let newBuffered = Double(current.start) + end
            if abs(newBuffered - buffered) >= 1 { buffered = newBuffered }
        }
        if isPlaying, Date().timeIntervalSince(lastSaved) >= 10 {
            lastSaved = Date()
            Task { await saveProgress() }
        }
        // Go to the next episode in the last second — some streams never send "ended".
        if upNext != nil, duration > 0, remaining <= 1, !advancing {
            Task { await advance() }
        }
    }

    // MARK: Controls

    func togglePlay() {
        if player.timeControlStatus == .paused { player.play() } else { player.pause() }
    }

    /// Skip by `delta` seconds. Presses add up and the seek happens once the user
    /// stops pressing, so the server restarts its transcode only once.
    func skip(_ delta: Double) {
        var target = (pendingSeek ?? position) + delta
        if duration > 0 { target = min(target, duration - 3) }
        target = max(0, target)
        pendingSeek = target
        seekCommit?.cancel()
        seekCommit = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 700_000_000)
            if Task.isCancelled { return }
            await self?.commitSeek()
        }
    }

    private func commitSeek() async {
        guard let target = pendingSeek else { return }
        if target < Double(current.start) {
            // Before where this stream begins — open a new stream from there.
            let r = current
            load(PlayRequest(type: r.type, mediaId: r.mediaId, start: Int(target), title: r.title, subtitle: r.subtitle), compat: compat)
            return
        }
        _ = await player.seek(to: CMTime(seconds: target - Double(current.start), preferredTimescale: 600))
        position = target
        pendingSeek = nil
    }

    func playNextNow() {
        Task { await advance() }
    }

    func dismissUpNext() {
        upNextDismissed = true
    }

    // MARK: End of item

    private func advance() async {
        guard !advancing else { return }
        advancing = true
        await saveProgress(completed: true)
        guard let next = upNext else {
            finish()
            return
        }
        let subtitle = "S\(next.season) E\(next.episodeNumber)" + (next.title.map { " · \($0)" } ?? "")
        // The next episode always starts from the beginning.
        load(PlayRequest(type: .episode, mediaId: next.id, start: 0, title: current.title, subtitle: subtitle))
    }

    private func didReachEnd() async {
        if current.type == .episode, upNext != nil {
            await advance()
        } else {
            await saveProgress(completed: true)
            finish()
        }
    }

    private func finish() {
        stop()
        onFinished()
    }

    // MARK: Progress

    private func saveProgress(completed: Bool? = nil) async {
        let pos = Int(position)
        guard pos >= 2 else { return }
        var done = completed ?? false
        if completed == nil, duration > 0 {
            done = position / duration > 0.9
        }
        let body: [String: Any] = [
            "mediaType": current.type.rawValue,
            "mediaId": current.mediaId,
            "position": pos,
            "completed": done,
        ]
        _ = try? await session.post("/api/stream/progress", body: body, as: Empty.self)
    }

    /// Called when the player closes.
    func stop() {
        guard !stopped else { return }
        stopped = true
        seekCommit?.cancel()
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        if let subtitleObserver { player.removeTimeObserver(subtitleObserver) }
        subtitleObserver = nil
        subtitleTask?.cancel()
        timeObserver = nil
        cancellables.removeAll()
        itemCancellables.removeAll()
        Task { await saveProgress() }
    }
}

// MARK: - Player screen

/// Custom full-screen player. Siri Remote: click = play/pause, left/right =
/// back/forward 10 s, up/down = show controls, Back/Menu = close.
struct PlayerView: View {
    @StateObject private var controller: PlaybackController
    private let onClose: () -> Void

    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?
    @FocusState private var focus: Focus?

    private enum Focus: Hashable {
        case surface, playNext, hideUpNext, closeError
        case subtitle(String) // a row in the subtitles menu ("off" = Off)
    }
    @State private var showSubtitleMenu = false

    init(request: PlayRequest, session: Session, onClose: @escaping () -> Void) {
        _controller = StateObject(wrappedValue: PlaybackController(session: session, request: request, onFinished: onClose))
        self.onClose = onClose
    }

    private var showControls: Bool {
        controlsVisible || !controller.isPlaying || controller.pendingSeek != nil
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VideoSurface(player: controller.player).ignoresSafeArea()

            // Focusable layer that receives the remote's presses and swipes.
            Color.clear
                .contentShape(Rectangle())
                .focusable()
                .focused($focus, equals: .surface)
                .focusEffectDisabled()
                .onMoveCommand(perform: handleMove)
                .onTapGesture {
                    controller.togglePlay()
                    poke()
                }
                .ignoresSafeArea()

            if controller.isBuffering && controller.errorText == nil {
                ProgressView().scaleEffect(1.6)
            }

            if showControls {
                controls.transition(.opacity)
            }

            if !controller.subtitleLines.isEmpty {
                subtitleOverlay
            }

            if showSubtitleMenu {
                subtitleMenu
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }

            if controller.showUpNext, let next = controller.upNext {
                upNextCard(next)
                    .transition(.move(edge: .trailing).combined(with: .opacity))
            }

            if let error = controller.errorText {
                errorPanel(error)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: showControls)
        .animation(.easeInOut(duration: 0.3), value: controller.showUpNext)
        .animation(.easeInOut(duration: 0.25), value: showSubtitleMenu)
        .onPlayPauseCommand {
            controller.togglePlay()
            poke()
        }
        .onExitCommand {
            // Back closes the subtitles menu first, then the player.
            if showSubtitleMenu { closeSubtitleMenu() } else { close() }
        }
        .onAppear {
            focus = .surface
            poke()
        }
        .onChange(of: controller.showUpNext) { _, visible in
            // Put focus on "Play Now" so one click starts the next episode.
            focus = visible ? .playNext : .surface
            if visible { poke() }
        }
        .onChange(of: controller.errorText) { _, error in
            // Put focus on "Close" so a click closes instead of toggling the hidden video.
            focus = error != nil ? .closeError : .surface
        }
        .onDisappear { controller.stop() }
    }

    // MARK: Pieces

    private var controls: some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text(controller.title).font(.title2.weight(.bold)).lineLimit(1)
                    if let subtitle = controller.subtitle {
                        Text(subtitle).font(.headline).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 90)
            .padding(.top, 48)
            .padding(.bottom, 70)
            .background(LinearGradient(colors: [.black.opacity(0.75), .clear], startPoint: .top, endPoint: .bottom))

            Spacer()

            VStack(spacing: 22) {
                ScrubBar(
                    shown: controller.pendingSeek ?? controller.position,
                    played: controller.position,
                    buffered: controller.buffered,
                    duration: controller.duration,
                    seeking: controller.pendingSeek != nil
                )
                HStack(spacing: 24) {
                    Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill")
                    Text(Fmt.clock(Int(controller.pendingSeek ?? controller.position)))
                    Spacer()
                    if !controller.subtitleTracks.isEmpty {
                        // Where the subtitles menu is.
                        Label(subtitleSummary, systemImage: "captions.bubble")
                            .foregroundStyle(.secondary)
                            .padding(.trailing, 20)
                    }
                    if controller.duration > 0 {
                        let left = max(0, controller.duration - (controller.pendingSeek ?? controller.position))
                        Text("-\(Fmt.clock(Int(left)))").foregroundStyle(.secondary)
                        Text("Ends at \(Fmt.endsAt(Int(left)))")
                    }
                }
                .font(.callout.monospacedDigit())
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 28)
            .glassEffect(.regular, in: .rect(cornerRadius: 40))
            .padding(.horizontal, 60)
            .padding(.bottom, 50)
        }
        // Our own margins instead of the TV safe area (~60 pt top and bottom), which
        // on top of the padding left big gaps above the title and below the bar.
        .ignoresSafeArea(edges: .vertical)
    }

    /// Compact card in the bottom-right corner: what's next, a countdown, and two small buttons.
    private func upNextCard(_ next: NextEpisode) -> some View {
        let fraction = min(1, max(0, controller.remaining / Double(controller.upNextSeconds)))
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("UP NEXT").font(.caption2.weight(.heavy)).foregroundStyle(Theme.accent)
                Spacer()
                Text("\(Int(controller.remaining.rounded(.up)))s")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Text("S\(next.season) E\(next.episodeNumber)" + (next.title.map { " · \($0)" } ?? ""))
                .font(.callout.weight(.semibold))
                .lineLimit(2)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.2))
                    Capsule().fill(Theme.accent).frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 4)
            HStack(spacing: 14) {
                Button {
                    controller.playNextNow()
                } label: {
                    Label("Play Now", systemImage: "play.fill")
                }
                .buttonStyle(CompactButtonStyle(prominent: true))
                .focused($focus, equals: .playNext)

                Button("Hide") {
                    controller.dismissUpNext()
                    focus = .surface
                }
                .buttonStyle(CompactButtonStyle())
                .focused($focus, equals: .hideUpNext)
            }
            .padding(.top, 4)
        }
        .padding(22)
        .frame(width: 440, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 28))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .padding(.trailing, 60)
        // Above the control panel while it's showing, otherwise near the corner.
        .padding(.bottom, showControls ? 210 : 50)
        .ignoresSafeArea(edges: .vertical)
    }

    private func errorPanel(_ message: String) -> some View {
        VStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 60)).foregroundStyle(.yellow)
            Text("This video couldn't be played").font(.title3.weight(.semibold))
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 900)
            Button("Close", action: close)
                .buttonStyle(ActionButtonStyle(prominent: true))
                .focused($focus, equals: .closeError)
        }
        .padding(50)
        .glassEffect(.regular, in: .rect(cornerRadius: 40))
    }

    // MARK: Remote

    private func handleMove(_ direction: MoveCommandDirection) {
        switch direction {
        case .left:
            controller.skip(-10)
        case .right:
            controller.skip(10)
        case .down where controller.showUpNext:
            focus = .playNext
        case .down where !controller.subtitleTracks.isEmpty:
            openSubtitleMenu()
        default:
            break
        }
        poke()
    }

    // MARK: Subtitles

    private var subtitleSummary: String {
        if controller.subtitleLoading { return "Loading subtitles…" }
        let current = controller.subtitleTracks.first { $0.id == controller.selectedSubtitle }
        return "Subtitles: \(current?.label ?? "Off")  ▾"
    }

    private var subtitleOverlay: some View {
        VStack(spacing: 6) {
            ForEach(Array(controller.subtitleLines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.system(size: 44, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .shadow(color: .black.opacity(0.9), radius: 3)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 4)
                    .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .frame(maxWidth: 1500)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        // Above the progress panel while it's showing.
        .padding(.bottom, showControls ? 230 : 70)
        .animation(.easeInOut(duration: 0.25), value: showControls)
        .ignoresSafeArea(edges: .vertical)
        .allowsHitTesting(false)
    }

    private var subtitleMenu: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("SUBTITLES").font(.caption.weight(.heavy)).foregroundStyle(Theme.accent).padding(.bottom, 6)
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 8) {
                    subtitleRow(id: "off", label: "Off", selected: controller.selectedSubtitle == nil) {
                        controller.selectSubtitle(nil)
                        closeSubtitleMenu()
                    }
                    ForEach(controller.subtitleTracks) { track in
                        subtitleRow(id: track.id, label: track.label, selected: controller.selectedSubtitle == track.id) {
                            controller.selectSubtitle(track)
                            closeSubtitleMenu()
                        }
                    }
                }
                .padding(.vertical, 8)
            }
            .scrollClipDisabled()
        }
        .padding(30)
        .frame(width: 620, alignment: .leading)
        .frame(maxHeight: 760)
        .glassEffect(.regular, in: .rect(cornerRadius: 36))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        .padding(.trailing, 60)
        .focusSection()
    }

    private func subtitleRow(id: String, label: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: "checkmark").opacity(selected ? 1 : 0)
                Text(label).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(SubtitleRowStyle(isSelected: selected))
        .focused($focus, equals: .subtitle(id))
    }

    private func openSubtitleMenu() {
        showSubtitleMenu = true
        focus = .subtitle(controller.selectedSubtitle ?? "off")
    }

    private func closeSubtitleMenu() {
        showSubtitleMenu = false
        focus = .surface
        poke()
    }

    /// Show the controls, then hide them after 4 s of playback.
    private func poke() {
        controlsVisible = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            if !Task.isCancelled && controller.isPlaying {
                controlsVisible = false
            }
        }
    }

    private func close() {
        controller.stop()
        onClose()
    }
}

/// Progress line with a knob; the knob jumps ahead while skipping.
struct ScrubBar: View {
    let shown: Double
    let played: Double
    var buffered: Double = 0
    let duration: Double
    let seeking: Bool

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let shownFraction = duration > 0 ? min(max(shown / duration, 0), 1) : 0
            let playedFraction = duration > 0 ? min(max(played / duration, 0), 1) : 0
            let bufferedFraction = duration > 0 ? min(max(buffered / duration, playedFraction), 1) : 0
            let knob: CGFloat = seeking ? 34 : 22
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.2))
                Capsule().fill(Color.white.opacity(0.35)).frame(width: width * bufferedFraction)
                Capsule().fill(Theme.accent).frame(width: width * playedFraction)
                Circle()
                    .fill(Color.white)
                    .frame(width: knob, height: knob)
                    .shadow(radius: 6)
                    .offset(x: width * shownFraction - knob / 2)
            }
        }
        .frame(height: 10)
    }
}

/// Shows the AVPlayer's video (no system controls).
struct VideoSurface: UIViewRepresentable {
    let player: AVPlayer

    func makeUIView(context: Context) -> PlayerLayerView {
        let view = PlayerLayerView()
        view.backgroundColor = .black
        view.playerLayer.videoGravity = .resizeAspect
        view.playerLayer.player = player
        return view
    }

    func updateUIView(_ view: PlayerLayerView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
    }

    final class PlayerLayerView: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
    }
}

/// A row in the player's subtitles menu: white when focused, accent text when it's the current choice.
private struct SubtitleRowStyle: ButtonStyle {
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        SubtitleRow(configuration: configuration, isSelected: isSelected)
    }
}

private struct SubtitleRow: View {
    let configuration: ButtonStyleConfiguration
    let isSelected: Bool
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        configuration.label
            .font(.callout.weight(isSelected ? .bold : .semibold))
            .foregroundStyle(isFocused ? Color.black : (isSelected ? Theme.accent : Color.white))
            .padding(.horizontal, 22)
            .padding(.vertical, 14)
            .background(RoundedRectangle(cornerRadius: 14).fill(isFocused ? Color.white : Color.white.opacity(0.06)))
            .scaleEffect(isFocused ? 1.03 : 1)
            .animation(.easeOut(duration: 0.15), value: isFocused)
    }
}
