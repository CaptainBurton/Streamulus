import AVKit
import SwiftUI

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
