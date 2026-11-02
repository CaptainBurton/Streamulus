// Copied from mobile/ios/xcode-project/Streamulus/Shared/BufferingIndicator.swift by generate_project.rb.
// Edit the original there, then run tv/appletv/generate_project.rb.

import SwiftUI

/// The player's loading spinner, and under it — once it has been spinning for a
/// few seconds — the note the admin set (Admin › Settings › Streaming › Slow
/// Start Message): usually the server's drives waking up after a quiet spell,
/// which takes around 8–15 seconds. Shared by the iPhone/iPad and Apple TV players.
struct BufferingIndicator: View {
    /// When the spinner started showing.
    let since: Date?
    let message: BufferingMessage?
    @State private var showNote = false

    var body: some View {
        VStack(spacing: noteSpacing) {
            spinner
            if showNote, let text = message?.text, !text.isEmpty {
                Text(text)
                    .font(noteFont)
                    .fontWeight(.medium)
                    .foregroundStyle(.white.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: noteWidth)
                    .padding(.horizontal, 24)
                    .shadow(color: .black.opacity(0.6), radius: 8)
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
            }
        }
        .task(id: since) {
            showNote = false
            guard let since, let message, message.enabled else { return }
            let wait = max(0, (message.afterSeconds ?? 5) - Date().timeIntervalSince(since))
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.5)) { showNote = true }
        }
    }

    @ViewBuilder private var spinner: some View {
        #if os(tvOS)
        ProgressView().scaleEffect(1.6)
        #else
        ProgressView().controlSize(.large).tint(.white)
        #endif
    }

    #if os(tvOS)
    private var noteFont: Font { .title3 }
    private var noteWidth: CGFloat { 900 }
    private var noteSpacing: CGFloat { 40 }
    #else
    private var noteFont: Font { .subheadline }
    private var noteWidth: CGFloat { 360 }
    private var noteSpacing: CGFloat { 18 }
    #endif
}
