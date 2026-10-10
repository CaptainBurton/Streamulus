// Copied from shared/apple/StreamulusCore/PlayerParts.swift by generate_project.rb.
// Edit the original there, then run generate_project.rb for both apps.

import AVKit
import SwiftUI

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
