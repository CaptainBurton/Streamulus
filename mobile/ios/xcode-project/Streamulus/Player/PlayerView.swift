import AVKit
import SwiftUI

/// Full-screen player for iPhone and iPad: tap to show/hide the controls,
/// double-tap the left or right side to skip 10 s, drag the progress bar to
/// seek; subtitles, AirPlay, Picture in Picture and Up Next for episodes.
/// Playback logic is the shared PlaybackController (same as the Apple TV app).
struct PlayerView: View {
    @StateObject private var controller: PlaybackController
    @StateObject private var pip = PictureInPicture()
    private let onClose: () -> Void

    @State private var controlsVisible = true
    @State private var hideTask: Task<Void, Never>?
    @State private var scrubbing = false
    @State private var skipHint: SkipHint?

    private struct SkipHint: Equatable {
        let forward: Bool
        let id = UUID()
    }

    init(request: PlayRequest, session: Session, onClose: @escaping () -> Void) {
        _controller = StateObject(wrappedValue: PlaybackController(session: session, request: request, onFinished: onClose))
        self.onClose = onClose
    }

    private var showControls: Bool {
        controlsVisible || !controller.isPlaying || scrubbing || controller.pendingSeek != nil
    }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            PiPVideoSurface(player: controller.player, pip: pip).ignoresSafeArea()

            // Tap: show/hide controls. Double-tap left / right: back / forward 10 s.
            HStack(spacing: 0) {
                tapZone(forward: false)
                tapZone(forward: true)
            }
            .ignoresSafeArea()

            if let skipHint {
                Image(systemName: skipHint.forward ? "goforward.10" : "gobackward.10")
                    .font(.system(size: 34, weight: .semibold))
                    .frame(width: 84, height: 84)
                    .glassEffect(.regular, in: .circle)
                    .frame(maxWidth: .infinity, alignment: skipHint.forward ? .trailing : .leading)
                    .padding(.horizontal, 60)
                    .transition(.opacity)
                    .allowsHitTesting(false)
            }

            if controller.isBuffering && controller.errorText == nil {
                ProgressView().controlSize(.large).tint(.white).allowsHitTesting(false)
            }

            if !controller.subtitleLines.isEmpty { subtitleOverlay }

            if showControls { controls.transition(.opacity) }

            if controller.showUpNext, let next = controller.upNext {
                upNextCard(next).transition(.move(edge: .trailing).combined(with: .opacity))
            }

            if let error = controller.errorText { errorPanel(error) }
        }
        .statusBarHidden(!showControls)
        .persistentSystemOverlays(.hidden)
        .animation(.easeInOut(duration: 0.2), value: showControls)
        .animation(.easeInOut(duration: 0.3), value: controller.showUpNext)
        .animation(.easeOut(duration: 0.2), value: skipHint)
        .onAppear { poke() }
        .onDisappear { controller.stop() }
    }

    // MARK: Pieces

    private func tapZone(forward: Bool) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .onTapGesture(count: 2) {
                controller.skip(forward ? 10 : -10)
                let hint = SkipHint(forward: forward)
                skipHint = hint
                Task {
                    try? await Task.sleep(nanoseconds: 600_000_000)
                    if skipHint == hint { skipHint = nil }
                }
                poke()
            }
            .onTapGesture {
                if showControls && controller.isPlaying {
                    controlsVisible = false
                    hideTask?.cancel()
                } else {
                    poke()
                }
            }
    }

    private var controls: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button(action: close) {
                    Image(systemName: "xmark").font(.headline).frame(width: 30, height: 30)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel("Close")

                VStack(alignment: .leading, spacing: 2) {
                    Text(controller.title).font(.headline).lineLimit(1)
                    if let subtitle = controller.subtitle {
                        Text(subtitle).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)

                if !controller.subtitleTracks.isEmpty { subtitlesMenu }
                if pip.isPossible {
                    Button { pip.toggle() } label: {
                        Image(systemName: pip.isActive ? "pip.exit" : "pip.enter").font(.headline).frame(width: 30, height: 30)
                    }
                    .buttonStyle(.glass)
                    .buttonBorderShape(.circle)
                    .accessibilityLabel("Picture in Picture")
                }
                AirPlayButton()
                    .frame(width: 46, height: 46)
                    .glassEffect(.regular, in: .circle)
                    .accessibilityLabel("AirPlay")
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .background(LinearGradient(colors: [.black.opacity(0.6), .clear], startPoint: .top, endPoint: .bottom).ignoresSafeArea())

            Spacer()

            HStack(spacing: 40) {
                transportButton("gobackward.10", label: "Back 10 seconds") { controller.skip(-10) }
                Button {
                    controller.togglePlay()
                    poke()
                } label: {
                    Image(systemName: controller.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 30))
                        .frame(width: 56, height: 56)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .accessibilityLabel(controller.isPlaying ? "Pause" : "Play")
                transportButton("goforward.10", label: "Forward 10 seconds") { controller.skip(10) }
            }

            Spacer()

            VStack(spacing: 8) {
                scrubber
                HStack(spacing: 10) {
                    let shown = controller.pendingSeek ?? controller.position
                    Text(Fmt.clock(Int(shown)))
                    Spacer()
                    if controller.duration > 0 {
                        let left = max(0, controller.duration - shown)
                        Text("-\(Fmt.clock(Int(left)))").foregroundStyle(.secondary)
                        Text("· Ends at \(Fmt.endsAt(Int(left)))")
                    }
                }
                .font(.caption.monospacedDigit())
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .glassEffect(.regular, in: .rect(cornerRadius: 22))
            .frame(maxWidth: 900)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }

    private func transportButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button {
            action()
            poke()
        } label: {
            Image(systemName: symbol).font(.system(size: 22)).frame(width: 44, height: 44)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .accessibilityLabel(label)
    }

    /// Drag anywhere along the bar; the knob follows and the seek happens on release.
    private var scrubber: some View {
        GeometryReader { geo in
            ScrubBar(
                shown: controller.pendingSeek ?? controller.position,
                played: controller.position,
                buffered: controller.buffered,
                duration: controller.duration,
                // Only grows while your finger is on it — not while the new spot buffers.
                seeking: scrubbing,
                barHeight: scrubbing ? 8 : 5,
                knobSize: 14,
                seekingKnobSize: 22
            )
            .animation(.easeOut(duration: 0.15), value: scrubbing)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        guard controller.duration > 0, geo.size.width > 0 else { return }
                        scrubbing = true
                        hideTask?.cancel()
                        let fraction = min(max(value.location.x / geo.size.width, 0), 1)
                        controller.seek(to: fraction * controller.duration, commit: false)
                    }
                    .onEnded { value in
                        guard controller.duration > 0, geo.size.width > 0 else { scrubbing = false; return }
                        let fraction = min(max(value.location.x / geo.size.width, 0), 1)
                        controller.seek(to: fraction * controller.duration)
                        scrubbing = false
                        poke()
                    }
            )
        }
        .frame(height: 30)
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue(Fmt.clock(Int(controller.position)))
        .accessibilityAdjustableAction { direction in
            controller.skip(direction == .increment ? 10 : -10)
        }
    }

    private var subtitlesMenu: some View {
        Menu {
            Picker("Subtitles", selection: Binding(
                get: { controller.selectedSubtitle ?? "off" },
                set: { id in controller.selectSubtitle(controller.subtitleTracks.first { $0.id == id }) }
            )) {
                Text("Off").tag("off")
                ForEach(controller.subtitleTracks) { track in
                    Text(track.label).tag(track.id)
                }
            }
        } label: {
            Image(systemName: controller.selectedSubtitle == nil ? "captions.bubble" : "captions.bubble.fill")
                .font(.headline)
                .frame(width: 46, height: 46)
                .glassEffect(.regular, in: .circle)
        }
        .accessibilityLabel("Subtitles")
    }

    private var subtitleOverlay: some View {
        VStack(spacing: 4) {
            ForEach(Array(controller.subtitleLines.enumerated()), id: \.offset) { _, line in
                Text(line)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .shadow(color: .black.opacity(0.9), radius: 2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 3)
                    .background(Color.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 6))
            }
        }
        .frame(maxWidth: 900)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .padding(.horizontal, 16)
        .padding(.bottom, showControls ? 120 : 28)
        .animation(.easeInOut(duration: 0.2), value: showControls)
        .allowsHitTesting(false)
    }

    private func upNextCard(_ next: NextEpisode) -> some View {
        let fraction = min(1, max(0, controller.remaining / Double(controller.upNextSeconds)))
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("UP NEXT").font(.caption2.weight(.heavy)).foregroundStyle(Theme.accent)
                Spacer()
                Text("\(Int(controller.remaining.rounded(.up)))s").font(.caption2.monospacedDigit()).foregroundStyle(.secondary)
            }
            Text("S\(next.season) E\(next.episodeNumber)" + (next.title.map { " · \($0)" } ?? ""))
                .font(.subheadline.weight(.semibold))
                .lineLimit(2)
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.2))
                    Capsule().fill(Theme.accent).frame(width: geo.size.width * fraction)
                }
            }
            .frame(height: 4)
            HStack(spacing: 10) {
                Button { controller.playNextNow() } label: {
                    Label("Play Now", systemImage: "play.fill").font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.glassProminent)
                Button("Hide") { controller.dismissUpNext() }
                    .buttonStyle(.glass)
            }
        }
        .padding(16)
        .frame(width: 300, alignment: .leading)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
        .padding(.trailing, 16)
        .padding(.bottom, showControls ? 130 : 24)
    }

    private func errorPanel(_ message: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill").font(.largeTitle).foregroundStyle(.yellow)
            Text("This video couldn't be played").font(.headline)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
            Button("Close", action: close).buttonStyle(.glassProminent)
        }
        .padding(24)
        .frame(maxWidth: 420)
        .glassEffect(.regular, in: .rect(cornerRadius: 26))
        .padding(24)
    }

    /// Show the controls, then hide them after 3.5 s of playback.
    private func poke() {
        controlsVisible = true
        hideTask?.cancel()
        hideTask = Task {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if !Task.isCancelled && controller.isPlaying && !scrubbing {
                controlsVisible = false
            }
        }
    }

    private func close() {
        controller.stop()
        onClose()
    }
}

// MARK: - Picture in Picture and AirPlay

/// Picture in Picture for the player's AVPlayerLayer. Starts automatically when
/// you leave the app while a video plays.
@MainActor
final class PictureInPicture: NSObject, ObservableObject, AVPictureInPictureControllerDelegate {
    @Published private(set) var isPossible = false
    @Published private(set) var isActive = false
    private var controller: AVPictureInPictureController?
    private var possibleObservation: NSKeyValueObservation?

    func attach(_ layer: AVPlayerLayer) {
        guard controller == nil, AVPictureInPictureController.isPictureInPictureSupported(),
              let pip = AVPictureInPictureController(playerLayer: layer) else { return }
        pip.canStartPictureInPictureAutomaticallyFromInline = true
        pip.delegate = self
        controller = pip
        possibleObservation = pip.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] pip, _ in
            let possible = pip.isPictureInPicturePossible
            Task { @MainActor in self?.isPossible = possible }
        }
    }

    func toggle() {
        guard let controller else { return }
        if controller.isPictureInPictureActive { controller.stopPictureInPicture() } else { controller.startPictureInPicture() }
    }

    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor in self.isActive = true }
    }

    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        Task { @MainActor in self.isActive = false }
    }

    /// The player screen is still open behind Picture in Picture, so there's nothing to restore.
    nonisolated func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
                                                restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }
}

/// The video, with Picture in Picture hooked up to its layer.
struct PiPVideoSurface: UIViewRepresentable {
    let player: AVPlayer
    let pip: PictureInPicture

    func makeUIView(context: Context) -> VideoSurface.PlayerLayerView {
        let view = VideoSurface.PlayerLayerView()
        view.backgroundColor = .black
        view.playerLayer.videoGravity = .resizeAspect
        view.playerLayer.player = player
        pip.attach(view.playerLayer)
        return view
    }

    func updateUIView(_ view: VideoSurface.PlayerLayerView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
    }
}

/// The system AirPlay button.
struct AirPlayButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = UIColor(Theme.accent)
        view.prioritizesVideoDevices = true
        return view
    }

    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
