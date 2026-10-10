import AVFoundation
import SwiftUI

@main
struct StreamulusApp: App {
    @StateObject private var session = Session()
    @StateObject private var player = PlayerPresenter()

    init() {
        // Sound plays even with the silent switch on, and keeps going over AirPlay
        // and in Picture in Picture.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(player)
                .tint(Theme.accent)
                .preferredColorScheme(.dark)
        }
    }
}

/// Picks the screen for the session's phase: connect, sign in, Who's watching?, or the app.
struct RootView: View {
    @EnvironmentObject private var session: Session

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch session.phase {
            case .starting:
                VStack(spacing: 28) {
                    BrandMark(size: 30)
                    ProgressView()
                }
            case .needsServer:
                ServerSetupView()
            case .signedOut:
                SignInView()
            case .pickingProfile:
                ProfilePickerView()
            case .ready:
                MainTabView()
            case .unreachable(let message):
                UnreachableView(message: message)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: session.phase)
        .task { await session.start() }
    }
}

struct UnreachableView: View {
    let message: String
    @EnvironmentObject private var session: Session

    var body: some View {
        VStack(spacing: 22) {
            BrandMark(size: 28)
            Image(systemName: "wifi.exclamationmark")
                .font(.system(size: 44))
                .foregroundStyle(.secondary)
            Text("Can't reach your Streamulus server").font(.title3.weight(.semibold))
            Text(message)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if session.publicURL == nil {
                Text("Away from home? Ask your server's admin for its public address (Admin › Settings › Remote Access) and use it with Change Server.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            VStack(spacing: 12) {
                Button { Task { await session.start() } } label: {
                    Text("Try Again").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                Button { session.changeServer() } label: {
                    Text("Change Server").frame(maxWidth: .infinity)
                }
                .buttonStyle(.glass)
            }
            .controlSize(.large)
            .frame(maxWidth: 360)
        }
        .padding(28)
        .frame(maxWidth: 560)
    }
}
