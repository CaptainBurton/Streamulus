import SwiftUI

// MARK: - Server

struct ServerSetupView: View {
    @EnvironmentObject private var session: Session
    @State private var address = ""
    @State private var connecting = false
    @State private var errorText: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                BrandMark(size: 30).padding(.top, 60)
                Text("Connect to your Streamulus server")
                    .font(.title2.weight(.semibold))
                    .multilineTextAlignment(.center)
                Text("At home, use the address you open in your browser, e.g. 192.168.1.20:8096. Away from home, use the server's public address, e.g. https://streamulus.your-tailnet.ts.net.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                TextField("Server address", text: $address)
                    .keyboardType(.URL)
                    .textContentType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit { Task { await connect() } }
                    .padding(14)
                    .glassEffect(.regular, in: .rect(cornerRadius: 14))

                if let errorText {
                    Text(errorText).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }

                Button { Task { await connect() } } label: {
                    Group {
                        if connecting { ProgressView() } else { Text("Connect") }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || connecting)

                Text("Once you've connected at home, the app also learns the server's public address (if the admin has set one) and switches to it by itself when you're out.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onAppear { focused = true }
    }

    private func connect() async {
        connecting = true
        errorText = nil
        do {
            try await session.setServer(address)
        } catch {
            errorText = "Couldn't reach a Streamulus server there. \(error.localizedDescription)"
        }
        connecting = false
    }
}

// MARK: - Sign in

struct SignInView: View {
    @EnvironmentObject private var session: Session
    @State private var username = ""
    @State private var password = ""
    @State private var busy = false
    @State private var errorText: String?
    @State private var mode: Mode = .password
    /// A new account's first sign-in needs the Admin Passphrase: why, and whether it was just made.
    @State private var passphraseNote: String?
    @State private var justCreated = false
    @State private var passphrase = ""

    enum Mode { case password, quickLogin, create }

    var body: some View {
        switch mode {
        case .quickLogin:
            QuickLoginRequestView(onCancel: { mode = .password })
        case .create:
            CreateAccountView(onCancel: { mode = .password }) { name, newPassword, message in
                username = name
                password = newPassword
                passphrase = ""
                passphraseNote = message
                justCreated = true
                errorText = nil
                mode = .password
            }
        case .password:
            signInForm
        }
    }

    private var signInForm: some View {
        ScrollView {
            VStack(spacing: 18) {
                BrandMark(size: 30).padding(.top, 60)
                Text(passphraseNote == nil ? "Sign in" : "One more step").font(.title2.weight(.semibold))

                if let passphraseNote {
                    VStack(alignment: .leading, spacing: 6) {
                        if justCreated {
                            Label("Account created", systemImage: "checkmark.circle.fill")
                                .font(.headline)
                                .foregroundStyle(.green)
                        }
                        Text(passphraseNote).font(.subheadline)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .glassEffect(.regular.tint(Theme.accent.opacity(0.25)), in: .rect(cornerRadius: 16))
                }

                VStack(spacing: 12) {
                    TextField("Username", text: $username)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .disabled(justCreated)
                        .padding(14)
                        .glassEffect(.regular, in: .rect(cornerRadius: 14))
                    SecureField("Password", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .onSubmit { Task { await signIn() } }
                        .padding(14)
                        .glassEffect(.regular, in: .rect(cornerRadius: 14))
                    if passphraseNote != nil {
                        TextField("Admin Passphrase", text: $passphrase, prompt: Text("Admin Passphrase, e.g. maple-river-otter-comet"))
                            .textContentType(.oneTimeCode)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .onSubmit { Task { await signIn() } }
                            .padding(14)
                            .glassEffect(.regular, in: .rect(cornerRadius: 14))
                    }
                }

                if let errorText {
                    Text(errorText).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }

                Button { Task { await signIn() } } label: {
                    Group {
                        if busy { ProgressView() } else { Text(passphraseNote == nil ? "Sign In" : "Activate & Sign In") }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(username.isEmpty || password.isEmpty || busy
                          || (passphraseNote != nil && passphrase.trimmingCharacters(in: .whitespaces).isEmpty))

                if passphraseNote != nil {
                    Button("Back to sign in") {
                        passphraseNote = nil
                        justCreated = false
                        passphrase = ""
                        errorText = nil
                    }
                    .font(.subheadline)
                } else {
                    Button { mode = .quickLogin } label: {
                        Label("Quick Login with a code", systemImage: "qrcode").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)

                    Button {
                        errorText = nil
                        mode = .create
                    } label: {
                        Label("Create Account", systemImage: "person.badge.plus").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.glass)
                    .controlSize(.large)
                }

                Button("Change Server · \(session.serverURL?.host ?? "")") { session.changeServer() }
                    .font(.footnote)
                    .padding(.top, 8)
            }
            .padding(24)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func signIn() async {
        guard !busy else { return }
        busy = true
        errorText = nil
        do {
            try await session.login(username: username, password: password,
                                    passphrase: passphraseNote == nil ? nil : passphrase.trimmingCharacters(in: .whitespaces))
        } catch let error as APIError where error.isPassphraseError {
            // First sign-in of a new account: ask for (or retry) the Admin Passphrase.
            if passphraseNote == nil || error.code == "PASSPHRASE_REQUIRED" {
                passphraseNote = error.message
            } else {
                errorText = error.message
            }
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }
}

/// Create an account: a display name (also the sign-in name) and a password. It
/// then needs an Admin Passphrase from the server's admin before the first sign-in.
struct CreateAccountView: View {
    let onCancel: () -> Void
    /// Name as the server stored it, the password, and what happens next.
    let onCreated: (String, String, String) -> Void
    @EnvironmentObject private var session: Session
    @State private var name = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var busy = false
    @State private var errorText: String?

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                BrandMark(size: 30).padding(.top, 60)
                Text("Create Account").font(.title2.weight(.semibold))

                VStack(spacing: 12) {
                    TextField("Display name", text: $name)
                        .textContentType(.username)
                        .autocorrectionDisabled()
                        .padding(14)
                        .glassEffect(.regular, in: .rect(cornerRadius: 14))
                    SecureField("Password (at least 6 characters)", text: $password)
                        .textContentType(.newPassword)
                        .padding(14)
                        .glassEffect(.regular, in: .rect(cornerRadius: 14))
                    SecureField("Confirm password", text: $confirm)
                        .textContentType(.newPassword)
                        .submitLabel(.go)
                        .onSubmit { Task { await create() } }
                        .padding(14)
                        .glassEffect(.regular, in: .rect(cornerRadius: 14))
                }
                Text("You'll sign in with your display name.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if let errorText {
                    Text(errorText).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
                }

                Button { Task { await create() } } label: {
                    Group {
                        if busy { ProgressView() } else { Text("Create Account") }
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || password.isEmpty || confirm.isEmpty || busy)

                Text("New accounts need an **Admin Passphrase** from your Streamulus admin before the first sign-in. It usually takes 5–10 minutes to get one.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button("Already have an account? Sign in", action: onCancel)
                    .font(.subheadline)
                    .padding(.top, 4)
            }
            .padding(24)
            .frame(maxWidth: 460)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func create() async {
        guard !busy else { return }
        guard password == confirm else {
            errorText = "The passwords don't match."
            return
        }
        busy = true
        errorText = nil
        do {
            let created = try await session.register(displayName: name, password: password)
            onCreated(created.username, password, created.message)
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }
}

/// Sign this device in by approving a code on a device that's already signed in.
struct QuickLoginRequestView: View {
    let onCancel: () -> Void
    @EnvironmentObject private var session: Session
    @State private var request: QuickStartResponse?
    @State private var expiresAt = Date()
    @State private var expired = false
    @State private var errorText: String?
    @State private var attempt = 0

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                BrandMark(size: 26).padding(.top, 60)
                Text("Quick Login").font(.title2.weight(.semibold))
                Text("On a device that's signed in — Streamulus in a browser, or this app on another iPhone or iPad (Profile & Settings › Approve a Sign-In) — scan this or enter the code:")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if let request, !expired {
                    if let qr = QRCode.image(for: session.quickLoginLink(code: request.code)) {
                        Image(uiImage: qr)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 170, height: 170)
                            .padding(12)
                            .background(Color.white, in: .rect(cornerRadius: 18))
                            .accessibilityLabel("Sign-in QR code")
                    }
                    Text(Fmt.code(request.code))
                        .font(.system(size: 52, weight: .heavy, design: .monospaced))
                        .foregroundStyle(Theme.accent)
                        .textSelection(.enabled)
                        .padding(.vertical, 18)
                        .padding(.horizontal, 28)
                        .glassEffect(.regular, in: .rect(cornerRadius: 24))
                    TimelineView(.periodic(from: .now, by: 1)) { context in
                        let left = max(0, Int(expiresAt.timeIntervalSince(context.date)))
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("Waiting for approval · \(left / 60):\(String(format: "%02d", left % 60))")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                    ShareLink(item: session.quickLoginLink(code: request.code)) {
                        Label("Send the approval link", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.glass)
                } else if expired {
                    Text("That code expired.")
                    Button("Get a New Code") { attempt += 1 }.buttonStyle(.glassProminent)
                } else if let errorText {
                    Text(errorText).foregroundStyle(.red).multilineTextAlignment(.center)
                    Button("Try Again") { attempt += 1 }.buttonStyle(.glassProminent)
                } else {
                    ProgressView()
                }

                Button("Sign in with a password instead", action: onCancel)
                    .padding(.top, 6)
            }
            .padding(24)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
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
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var profiles: [Profile] = []
    @State private var prompt: Prompt?
    @State private var errorText: String?

    struct Prompt: Identifiable {
        let profile: Profile
        let kind: String // "pin" | "password"
        var id: String { "\(profile.id)-\(kind)" }
    }

    var body: some View {
        let avatar: CGFloat = sizeClass == .regular ? 150 : 104
        ScrollView {
            VStack(spacing: 30) {
                BrandMark(size: 24).padding(.top, 50)
                Text("Who's watching?").font(.largeTitle.weight(.bold))
                if let errorText, prompt == nil {
                    Text(errorText).font(.footnote).foregroundStyle(.red)
                }
                profileGrid(profiles.filter { !$0.isKids }, avatar: avatar)
                // Streamlings get their own section beneath everyone else's profiles.
                let streamlings = profiles.filter(\.isKids)
                if !streamlings.isEmpty {
                    Text("Streamlings")
                        .font(.subheadline.weight(.heavy))
                        .tracking(1.5)
                        .textCase(.uppercase)
                        .foregroundStyle(Theme.streamling)
                        .padding(.top, 10)
                    profileGrid(streamlings, avatar: avatar)
                }
                Button("Sign Out") { session.signOut() }
                    .buttonStyle(.glass)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
        }
        .task { await load() }
        .sheet(item: $prompt) { prompt in
            UnlockSheet(prompt: prompt, errorText: $errorText) { pin, password in
                await choose(prompt.profile, pin: pin, password: password)
            }
            .presentationDetents([.medium])
        }
    }

    private func profileGrid(_ profiles: [Profile], avatar: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: avatar + 20), spacing: 24)], spacing: 28) {
            ForEach(profiles) { profile in
                Button {
                    if let needs = profile.requires {
                        errorText = nil
                        prompt = Prompt(profile: profile, kind: needs)
                    } else {
                        Task { await choose(profile) }
                    }
                } label: {
                    VStack(spacing: 10) {
                        ProfileAvatar(profile: profile, size: avatar)
                            .overlay(alignment: .topTrailing) {
                                if profile.requires != nil {
                                    Image(systemName: "lock.fill")
                                        .font(.caption)
                                        .padding(7)
                                        .glassEffect(.regular, in: .circle)
                                }
                            }
                        Text(profile.name).font(.headline).foregroundStyle(.primary)
                    }
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: 760)
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
            prompt = nil
        } catch let error as APIError {
            // The server says what it needs — switch to that prompt.
            if error.code == "PIN_REQUIRED" { prompt = Prompt(profile: profile, kind: "pin") }
            if error.code == "PASSWORD_REQUIRED" { prompt = Prompt(profile: profile, kind: "password") }
            errorText = error.message
        } catch {
            errorText = error.localizedDescription
        }
    }
}

/// PIN (4 digits) or account password before switching to a locked profile.
private struct UnlockSheet: View {
    let prompt: ProfilePickerView.Prompt
    @Binding var errorText: String?
    let submit: (_ pin: String?, _ password: String?) async -> Void
    @State private var value = ""
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(spacing: 18) {
            ProfileAvatar(profile: prompt.profile, size: 64)
            Text(prompt.kind == "pin" ? "Enter \(prompt.profile.name)'s PIN" : "Enter your account password")
                .font(.headline)
            Group {
                if prompt.kind == "pin" {
                    SecureField("PIN", text: $value)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .multilineTextAlignment(.center)
                        .font(.title.monospacedDigit())
                        .onChange(of: value) { _, new in
                            value = String(new.filter(\.isNumber).prefix(4))
                            if value.count == 4 { Task { await go() } }
                        }
                } else {
                    SecureField("Password", text: $value)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .onSubmit { Task { await go() } }
                }
            }
            .focused($focused)
            .padding(14)
            .glassEffect(.regular, in: .rect(cornerRadius: 14))
            .frame(maxWidth: 320)
            if let errorText {
                Text(errorText).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button { Task { await go() } } label: {
                Group { if busy { ProgressView() } else { Text("Continue") } }.frame(maxWidth: 280)
            }
            .buttonStyle(.glassProminent)
            .controlSize(.large)
            .disabled(value.isEmpty || busy)
        }
        .padding(24)
        .onAppear { errorText = nil; focused = true }
    }

    private func go() async {
        guard !busy else { return }
        busy = true
        let entered = value
        value = ""
        await submit(prompt.kind == "pin" ? entered : nil, prompt.kind == "password" ? entered : nil)
        busy = false
    }
}
