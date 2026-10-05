import AVKit
import Combine
import SwiftUI

/// Something to play. `start` is where to begin, in seconds.
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

/// Drives one AVPlayer: saves progress every 10 s and when closed, and moves on
/// to the next episode (from the beginning) when an episode ends.
@MainActor
final class PlaybackController {
    let player = AVPlayer()

    private let session: Session
    private let onFinished: () -> Void
    private var current: PlayRequest
    private var timeObserver: Any?
    private var endObserver: AnyCancellable?
    private var stopped = false

    init(session: Session, request: PlayRequest, onFinished: @escaping () -> Void) {
        self.session = session
        self.current = request
        self.onFinished = onFinished

        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 10, preferredTimescale: 1), queue: .main) { [weak self] _ in
            Task { @MainActor in await self?.saveProgress() }
        }
        load(request)
    }

    private func load(_ request: PlayRequest) {
        current = request
        guard let url = session.streamURL(type: request.type, id: request.mediaId, start: request.start) else {
            onFinished()
            return
        }
        let item = AVPlayerItem(url: url)
        item.externalMetadata = Self.metadata(title: request.title, subtitle: request.subtitle)
        endObserver = NotificationCenter.default
            .publisher(for: .AVPlayerItemDidPlayToEndTime, object: item)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in
                Task { @MainActor in await self?.didFinishItem() }
            }
        player.replaceCurrentItem(with: item)
        player.play()
    }

    /// Position in the whole file. The stream's own timeline starts at `current.start`.
    private var position: Int {
        let seconds = player.currentTime().seconds
        return current.start + (seconds.isFinite ? Int(seconds) : 0)
    }

    private var totalDuration: Int? {
        guard let seconds = player.currentItem?.duration.seconds, seconds.isFinite, seconds > 0 else { return nil }
        return current.start + Int(seconds)
    }

    private func saveProgress(completed: Bool? = nil) async {
        let pos = position
        guard pos >= 2 else { return }
        var done = completed ?? false
        if completed == nil, let total = totalDuration {
            done = Double(pos) / Double(total) > 0.9
        }
        let body: [String: Any] = [
            "mediaType": current.type.rawValue,
            "mediaId": current.mediaId,
            "position": pos,
            "completed": done,
        ]
        _ = try? await session.post("/api/stream/progress", body: body, as: Empty.self)
    }

    private func didFinishItem() async {
        await saveProgress(completed: true)
        guard current.type == .episode, !stopped,
              let response = try? await session.get("/api/tv/episode/\(current.mediaId)/next", as: NextEpisodeResponse.self),
              let next = response.next else {
            onFinished()
            return
        }
        let subtitle = "S\(next.season) E\(next.episodeNumber)" + (next.title.map { " · \($0)" } ?? "")
        load(PlayRequest(type: .episode, mediaId: next.id, start: 0, title: current.title, subtitle: subtitle))
    }

    /// Called when the player closes.
    func stop() {
        guard !stopped else { return }
        stopped = true
        player.pause()
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = nil
        endObserver = nil
        Task { await saveProgress() }
    }

    /// Title/subtitle for the tvOS info panel.
    private static func metadata(title: String, subtitle: String?) -> [AVMetadataItem] {
        func item(_ identifier: AVMetadataIdentifier, _ value: String) -> AVMetadataItem {
            let item = AVMutableMetadataItem()
            item.identifier = identifier
            item.value = value as NSString
            item.extendedLanguageTag = "und"
            return item.copy() as! AVMetadataItem
        }
        var items = [item(.commonIdentifierTitle, title)]
        if let subtitle { items.append(item(.iTunesMetadataTrackSubTitle, subtitle)) }
        return items
    }
}

/// Full-screen native player (Siri Remote scrubbing, info panel, etc.).
struct PlayerView: View {
    let request: PlayRequest
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        PlayerHost(request: request, session: session, onFinished: { dismiss() })
            .ignoresSafeArea()
    }
}

private struct PlayerHost: UIViewControllerRepresentable {
    let request: PlayRequest
    let session: Session
    let onFinished: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(controller: PlaybackController(session: session, request: request, onFinished: onFinished))
    }

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = context.coordinator.controller.player
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {}

    static func dismantleUIViewController(_ controller: AVPlayerViewController, coordinator: Coordinator) {
        coordinator.controller.stop()
        controller.player = nil
    }

    final class Coordinator {
        let controller: PlaybackController
        init(controller: PlaybackController) { self.controller = controller }
    }
}
