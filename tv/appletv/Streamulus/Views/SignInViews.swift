import SwiftUI

// MARK: - Server

struct ServerSetupView: View {
    @EnvironmentObject private var session: Session
    @State private var address = ""
    @State private var connecting = false
    @State private var errorText: String?

    var body: some View {
        VStack(spacing: 36) {
            BrandMark(size: 60)
            Text("Connect to your Streamulus server").font(.title2)
            Text("Enter the address you use in your browser, for example 192.168.1.20:8096 or https://streamulus.your-tailnet.ts.net")
                .foregroundStyle(.secondary)
            TextField("Server address", text: $address)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .frame(width: 900)
            if let errorText {
                Text(errorText).foregroundStyle(.red).multilineTextAlignment(.center).frame(maxWidth: 1100)
            }
            Button {
                Task { await connect() }
            } label: {
                Text(connecting ? "Connecting…" : "Connect").frame(width: 360)
            }
            .buttonStyle(.glassProminent)
            .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || connecting)
        }
        .padding(80)
    }

    private func connect() async {
        connecting = true
        errorText = nil
        do {
            try await session.setServer(address)
        } catch {
            errorText = "Couldn't reach Streamulus at that address. Check it's running and on the same network.\n(\(error.localizedDescription))"
        }
        connecting = false
    }
}

// MARK: - Sign in

struct LoginView: View {
    @EnvironmentObject private var session: Session
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorText: String?
    @State private var quickLogin = false

    var body: some View {
        if quickLogin {
            QuickLoginView(onCancel: { quickLogin = false })
        } else {
            VStack(spacing: 30) {
                BrandMark(size: 60)
                Text("Sign in").font(.title2)
                TextField("Username", text: $username)
                    .textContentType(.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .frame(width: 700)
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .frame(width: 700)
                if let errorText {
                    Text(errorText).foregroundStyle(.red).multilineTextAlignment(.center).frame(maxWidth: 1100)
                }
                GlassEffectContainer(spacing: 40) {
                    HStack(spacing: 40) {
                        Button {
                            Task { await signIn() }
                        } label: {
                            Text(busy ? "Signing in…" : "Sign In").frame(width: 320)
                        }
                        .buttonStyle(.glassProminent)
                        .disabled(username.isEmpty || password.isEmpty || busy)

                        Button {
                            quickLogin = true
                        } label: {
                            Label("Quick Login", systemImage: "qrcode").frame(width: 320)
                        }
                        .buttonStyle(.glass)
                    }
                }
                Button("Change Server · \(session.serverURL?.host ?? "")") { session.changeServer() }
                    .buttonStyle(.glass)
                    .font(.caption)
                // Accounts are created on a phone or the web, where the new account's
                // one-time Admin Passphrase is entered too.
                Text("New to Streamulus? Create an account first in the Streamulus app on your phone, or in a browser at \(createAccountAddress). Once it's set up, sign in here.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 1100)
            }
            .padding(80)
        }
    }

    private var createAccountAddress: String {
        guard let server = session.serverURL else { return "your Streamulus server" }
        let address = server.appendingPathComponent("create-account").absoluteString
        return address.replacingOccurrences(of: "http://", with: "").replacingOccurrences(of: "https://", with: "")
    }

    private func signIn() async {
        busy = true
        errorText = nil
        do {
            try await session.login(username: username, password: password)
        } catch let error as APIError where error.isPassphraseError {
            // A new account that hasn't been activated with its Admin Passphrase yet.
            errorText = "This account isn't set up yet. Finish creating it in the Streamulus app on your phone or in a browser — you'll need the Admin Passphrase from your admin — then sign in here."
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }
}

// MARK: - Quick Login

/// Shows a code (and QR code) to approve from a phone or computer that's
/// already signed in, then signs in automatically once it's approved.
struct QuickLoginView: View {
    let onCancel: () -> Void
    @EnvironmentObject private var session: Session
    @State private var request: QuickStartResponse?
    @State private var expiresAt = Date()
    @State private var expired = false
    @State private var errorText: String?
    @State private var attempt = 0 // bump to get a new code

    var body: some View {
        HStack(alignment: .center, spacing: 100) {
            VStack(alignment: .leading, spacing: 30) {
                Text("Quick Login").font(.title)
                Text("In the Streamulus app on your iPhone or iPad, open **Profile & Settings › Approve a Sign-In** and scan the QR code. Or on a computer, choose **Quick Login** in the profile menu and enter:")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)

                if let request, !expired {
                    Text(Fmt.code(request.code))
                        .font(.system(size: 120, weight: .heavy, design: .monospaced))
                        .foregroundStyle(Theme.accent)
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let left = max(0, Int(expiresAt.timeIntervalSince(context.date)))
                        HStack(spacing: 20) {
                            ProgressView()
                            Text("Waiting for approval · code expires in \(left / 60):\(String(format: "%02d", left % 60))")
                                .foregroundStyle(.secondary)
                        }
                    }
                } else if expired {
                    Text("That code expired.").font(.title3)
                    Button("Get a New Code") { attempt += 1 }
                        .buttonStyle(.glassProminent)
                } else if let errorText {
                    Text(errorText).foregroundStyle(.red)
                    Button("Try Again") { attempt += 1 }
                        .buttonStyle(.glassProminent)
                } else {
                    ProgressView()
                }

                Button("Sign in with a Password Instead", action: onCancel)
                    .buttonStyle(.glass)
            }
            .frame(maxWidth: 950, alignment: .leading)

            if let request, !expired, let qr = QRCode.image(for: session.quickLoginLink(code: request.code)) {
                // QR code stays on solid white so phone cameras can read it; the
                // panel around it is Liquid Glass.
                VStack(spacing: 24) {
                    Image(uiImage: qr)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 400, height: 400)
                        .padding(28)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 28))
                    Text("Scan with the Streamulus app or your phone's camera").foregroundStyle(.secondary)
                }
                .padding(36)
                .glassEffect(.regular, in: .rect(cornerRadius: 48))
            }
        }
        .padding(80)
        .task(id: attempt) { await run() }
    }

    /// Get a code, then poll until it's approved or expires.
    private func run() async {
        request = nil
        expired = false
        errorText = nil
        do {
            let started = try await session.quickLoginStart()
            request = started
            expiresAt = Date().addingTimeInterval(TimeInterval(started.expiresIn))
        } catch {
            errorText = error.localizedDescription
            return
        }

        while !Task.isCancelled, let current = request, !expired {
            try? await Task.sleep(nanoseconds: UInt64(max(2, current.interval)) * 1_000_000_000)
            if Task.isCancelled { return }
            do {
                let poll = try await session.quickLoginPoll(requestId: current.requestId)
                if poll.status == "approved", let token = poll.token, let user = poll.user, let profile = poll.profile {
                    session.completeSignIn(token: token, user: user, profile: profile, profileCount: poll.profileCount ?? 1)
                    return
                }
            } catch let error as APIError where error.status == 410 {
                expired = true
            } catch {
                // Network blip — keep waiting.
            }
        }
    }
}

// MARK: - Who's watching?

struct ProfilePickerView: View {
    @EnvironmentObject private var session: Session
    @State private var profiles: [Profile] = []
    @State private var prompt: (profile: Profile, kind: String)? // kind: "pin" | "password"
    @State private var errorText: String?

    var body: some View {
        VStack(spacing: profiles.contains(where: \.isKids) ? 44 : 60) {
            if let prompt {
                if prompt.kind == "pin" {
                    PinPad(profile: prompt.profile, errorText: errorText,
                           onSubmit: { pin in await choose(prompt.profile, pin: pin) },
                           onCancel: cancelPrompt)
                } else {
                    PasswordPrompt(profile: prompt.profile, errorText: errorText,
                                   onSubmit: { password in await choose(prompt.profile, password: password) },
                                   onCancel: cancelPrompt)
                }
            } else {
                let streamlings = profiles.filter(\.isKids)
                // Two rows need a little less room each to fit on screen.
                let avatar: CGFloat = streamlings.isEmpty ? 220 : 180
                Text("Who's watching?").font(.system(size: streamlings.isEmpty ? 64 : 56, weight: .bold))
                if let errorText { Text(errorText).foregroundStyle(.red) }
                VStack(spacing: 36) {
                    profileRow(profiles.filter { !$0.isKids }, avatar: avatar)
                    // Streamlings get their own section beneath everyone else's profiles.
                    if !streamlings.isEmpty {
                        Text("STREAMLINGS")
                            .font(.callout.weight(.heavy))
                            .tracking(3)
                            .foregroundStyle(Theme.streamling)
                            .padding(.top, 8)
                        profileRow(streamlings, avatar: avatar)
                    }
                }
                Button("Sign Out") { session.signOut() }
                    .buttonStyle(.glass)
            }
        }
        .padding(80)
        .task { await load() }
    }

    private func profileRow(_ profiles: [Profile], avatar: CGFloat) -> some View {
        HStack(alignment: .top, spacing: 70) {
            ForEach(profiles) { profile in
                VStack(spacing: 24) {
                    Button {
                        if let needs = profile.requires {
                            errorText = nil
                            prompt = (profile: profile, kind: needs)
                        } else {
                            Task { await choose(profile) }
                        }
                    } label: {
                        ProfileAvatar(profile: profile, size: avatar)
                            .overlay(alignment: .topTrailing) {
                                if profile.requires != nil {
                                    Image(systemName: "lock.fill").padding(14).glassEffect(.regular, in: .circle)
                                }
                            }
                    }
                    .buttonStyle(AvatarButtonStyle())
                    Text(profile.name).font(.headline)
                }
            }
        }
        // Moving down from any profile reaches the next row, wherever it sits.
        .focusSection()
    }

    private func cancelPrompt() {
        prompt = nil
        errorText = nil
    }

    private func load() async {
        do {
            profiles = try await session.profiles()
        } catch {
            errorText = error.localizedDescription
        }
    }

    private func choose(_ profile: Profile, pin: String? = nil, password: String? = nil) async {
        do {
            try await session.selectProfile(profile, pin: pin, password: password)
        } catch let error as APIError {
            // The server says what it needs — switch to that prompt.
            if error.code == "PIN_REQUIRED" { prompt = (profile: profile, kind: "pin") }
            if error.code == "PASSWORD_REQUIRED" { prompt = (profile: profile, kind: "password") }
            errorText = error.message
        } catch {
            errorText = error.localizedDescription
        }
    }
}

/// Round profile picture that grows and gets a white ring when focused.
struct AvatarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        AvatarButtonLabel(configuration: configuration)
    }
}

private struct AvatarButtonLabel: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        configuration.label
            .overlay(Circle().stroke(Color.white, lineWidth: isFocused ? 8 : 0))
            .scaleEffect(configuration.isPressed ? 1.04 : (isFocused ? 1.12 : 1))
            .shadow(color: .black.opacity(isFocused ? 0.6 : 0), radius: 24, y: 12)
            .animation(.easeOut(duration: 0.15), value: isFocused)
    }
}

/// Account password, for leaving a Streamling when the parental lock asks for it.
struct PasswordPrompt: View {
    let profile: Profile
    let errorText: String?
    let onSubmit: (String) async -> Void
    let onCancel: () -> Void

    @State private var password = ""
    @State private var busy = false

    var body: some View {
        VStack(spacing: 36) {
            ProfileAvatar(profile: profile, size: 150)
            Text("Enter your account password to switch to \(profile.name)").font(.title2)
            SecureField("Password", text: $password)
                .textContentType(.password)
                .frame(width: 700)
            if let errorText { Text(errorText).foregroundStyle(.red) }
            GlassEffectContainer(spacing: 30) {
                HStack(spacing: 30) {
                    Button {
                        busy = true
                        let entered = password
                        Task {
                            await onSubmit(entered)
                            password = ""
                            busy = false
                        }
                    } label: {
                        Text(busy ? "Checking…" : "Continue").frame(width: 260)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(password.isEmpty || busy)

                    Button("Cancel", action: onCancel)
                        .buttonStyle(.glass)
                }
            }
        }
    }
}

/// Number pad for a 4-digit profile PIN — easier with the Siri Remote than the keyboard.
struct PinPad: View {
    let profile: Profile
    let errorText: String?
    let onSubmit: (String) async -> Void
    let onCancel: () -> Void

    @State private var digits = ""
    @State private var busy = false
    private let keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"]

    var body: some View {
        VStack(spacing: 36) {
            ProfileAvatar(profile: profile, size: 150)
            Text("Enter PIN for \(profile.name)").font(.title2)
            HStack(spacing: 26) {
                ForEach(0..<4, id: \.self) { index in
                    Circle()
                        .fill(index < digits.count ? Color.white : Color.white.opacity(0.2))
                        .frame(width: 30, height: 30)
                }
            }
            if let errorText { Text(errorText).foregroundStyle(.red) }
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(170), spacing: 30), count: 3), spacing: 30) {
                ForEach(keys, id: \.self) { key in
                    if key.isEmpty {
                        Color.clear.frame(width: 140, height: 90)
                    } else {
                        Button { tap(key) } label: {
                            Text(key).font(.title).frame(width: 110, height: 70)
                        }
                        .buttonStyle(.glass)
                        .disabled(busy)
                    }
                }
            }
            .frame(width: 600)
            Button("Cancel", action: onCancel)
                .buttonStyle(.glass)
        }
    }

    private func tap(_ key: String) {
        if key == "⌫" {
            if !digits.isEmpty { digits.removeLast() }
            return
        }
        guard digits.count < 4 else { return }
        digits += key
        if digits.count == 4 {
            let pin = digits
            busy = true
            Task {
                await onSubmit(pin)
                digits = ""
                busy = false
            }
        }
    }
}
