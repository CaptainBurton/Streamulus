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

        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        player.publisher(for: \.timeControlStatus)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                Task { @MainActor in
                    self?.isPlaying = status == .playing
                    self?.isBuffering = status == .waitingToPlayAtSpecifiedRate
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
        title = request.title
        subtitle = request.subtitle
        position = Double(request.start)
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

    private func loadUpNext(for episodeId: Int) async {
        let response = try? await session.get("/api/tv/episode/\(episodeId)/next", as: NextEpisodeResponse.self)
        guard let response, current.mediaId == episodeId, current.type == .episode else { return }
        upNext = response.next
        upNextSeconds = max(5, response.upNextSeconds)
    }

    private func tick() {
        let seconds = player.currentTime().seconds
        if seconds.isFinite, pendingSeek == nil { position = Double(current.start) + seconds }
        if let itemDuration = player.currentItem?.duration.seconds, itemDuration.isFinite, itemDuration > 0 {
            duration = Double(current.start) + itemDuration
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

    private enum Focus: Hashable { case surface, playNext, hideUpNext }

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
        .onPlayPauseCommand {
            controller.togglePlay()
            poke()
        }
        .onExitCommand(perform: close)
        .onAppear {
            focus = .surface
            poke()
        }
        .onChange(of: controller.showUpNext) { _, visible in
            // Put focus on "Play Now" so one click starts the next episode.
            focus = visible ? .playNext : .surface
            if visible { poke() }
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
            .padding(.top, 60)
            .padding(.bottom, 80)
            .background(LinearGradient(colors: [.black.opacity(0.8), .clear], startPoint: .top, endPoint: .bottom).ignoresSafeArea())

            Spacer()

            VStack(spacing: 22) {
                ScrubBar(
                    shown: controller.pendingSeek ?? controller.position,
                    played: controller.position,
                    duration: controller.duration,
                    seeking: controller.pendingSeek != nil
                )
                HStack(spacing: 24) {
                    Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill")
                    Text(Fmt.clock(Int(controller.pendingSeek ?? controller.position)))
                    Spacer()
                    if controller.duration > 0 {
                        let left = max(0, controller.duration - (controller.pendingSeek ?? controller.position))
                        Text("-\(Fmt.clock(Int(left)))").foregroundStyle(.secondary)
                        Text("Ends at \(Fmt.endsAt(Int(left)))")
                    }
                }
                .font(.callout.monospacedDigit())
            }
            .padding(.horizontal, 40)
            .padding(.vertical, 30)
            .glassEffect(.regular, in: .rect(cornerRadius: 40))
            .padding(.horizontal, 60)
            .padding(.bottom, 50)
        }
    }

    private func upNextCard(_ next: NextEpisode) -> some View {
        let fraction = min(1, max(0, controller.remaining / Double(controller.upNextSeconds)))
        return VStack(alignment: .leading, spacing: 16) {
            Text("UP NEXT").font(.caption.weight(.heavy)).foregroundStyle(Theme.accent)
            Text("S\(next.season) E\(next.episodeNumber)" + (next.title.map { " · \($0)" } ?? ""))
                .font(.headline)
                .lineLimit(2)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.2))
                    Capsule().fill(Theme.accent).frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 6)
            HStack(spacing: 20) {
                Button {
                    controller.playNextNow()
                } label: {
                    Label("Play Now", systemImage: "play.fill")
                }
                .buttonStyle(.glassProminent)
                .focused($focus, equals: .playNext)

                Button("Hide") {
                    controller.dismissUpNext()
                    focus = .surface
                }
                .buttonStyle(.glass)
                .focused($focus, equals: .hideUpNext)
            }
        }
        .padding(30)
        .frame(width: 600, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 36))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .padding(.trailing, 80)
        .padding(.bottom, showControls ? 260 : 80)
    }

    private func errorPanel(_ message: String) -> some View {
        VStack(spacing: 24) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 60)).foregroundStyle(.yellow)
            Text("This video couldn't be played").font(.title3.weight(.semibold))
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 900)
            Button("Close", action: close).buttonStyle(.glassProminent)
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
        default:
            break
        }
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
    let duration: Double
    let seeking: Bool

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            let shownFraction = duration > 0 ? min(max(shown / duration, 0), 1) : 0
            let playedFraction = duration > 0 ? min(max(played / duration, 0), 1) : 0
            let knob: CGFloat = seeking ? 34 : 22
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.25))
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
