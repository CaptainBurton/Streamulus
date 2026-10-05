import SwiftUI

@main
struct StreamulusApp: App {
    @StateObject private var session = Session()
    @StateObject private var player = PlayerPresenter()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .environmentObject(player)
                .preferredColorScheme(.dark)
                .tint(Theme.accent)
        }
    }
}

/// Picks the screen for the current sign-in state.
struct RootView: View {
    @EnvironmentObject private var session: Session

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch session.phase {
            case .starting:
                ProgressView()
            case .needsServer:
                ServerSetupView()
            case .signedOut:
                LoginView()
            case .pickingProfile:
                ProfilePickerView()
            case .ready:
                MainTabView()
            case .unreachable(let message):
                UnreachableView(message: message)
            }
        }
        .task { await session.start() }
    }
}

struct UnreachableView: View {
    let message: String
    @EnvironmentObject private var session: Session

    var body: some View {
        VStack(spacing: 40) {
            Logo()
            Text("Can't reach your Streamulus server").font(.title2)
            Text(message).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 1100)
            GlassEffectContainer(spacing: 40) {
                HStack(spacing: 40) {
                    Button("Try Again") { Task { await session.start() } }
                        .buttonStyle(.glassProminent)
                    Button("Change Server") { session.changeServer() }
                        .buttonStyle(.glass)
                }
            }
        }
        .padding(80)
    }
}
