// Copied from mobile/ios/xcode-project/Streamulus/Shared/PlaybackController.swift by generate_project.rb.
// Edit the original there, then run tv/appletv/generate_project.rb.

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
        let path = "/api/subtitles/\(parts[0])/\(parts[1])/\(track.id).vtt"
        // The server may still be reading subtitles out of the video file: use
        // what's there now and fetch again every few seconds until complete.
        while true {
            let result = try? await session.getSubtitles(path)
            guard !Task.isCancelled, subtitleMedia == media, selectedSubtitle == track.id else { return }
            subtitleLoading = false
            guard let result else {
                // Couldn't load: show subtitles as off rather than stuck on "Loading".
                if cues.isEmpty { selectedSubtitle = nil }
                return
            }
            cues = WebVTT.parse(result.text)
            updateSubtitleLines()
            if result.complete { return }
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            if Task.isCancelled { return }
        }
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

    /// Jump to `seconds` into the file (dragging the iPhone progress bar).
    /// `commit: false` only moves the knob while the finger is still down.
    func seek(to seconds: Double, commit: Bool = true) {
        var target = seconds
        if duration > 0 { target = min(target, duration - 3) }
        target = max(0, target)
        pendingSeek = target
        seekCommit?.cancel()
        guard commit else { return }
        seekCommit = Task { [weak self] in await self?.commitSeek() }
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
