import SwiftUI

/// Profile & Settings (opened from the profile picture top-right).
struct AccountView: View {
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @State private var savingEnglish = false
    @State private var confirmChangeServer = false

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    var body: some View {
        List {
            if let profile = session.profile {
                Section {
                    HStack(spacing: 16) {
                        ProfileAvatar(profile: profile, size: 64)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(profile.name).font(.title3.weight(.semibold))
                            if profile.isKids {
                                Text("STREAMLING").font(.caption.weight(.heavy)).foregroundStyle(Theme.streamling)
                            }
                            if let user = session.user {
                                Text("Signed in as \(user.username)").font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }
                    .padding(.vertical, 4)
                    Button {
                        dismiss()
                        session.switchProfile()
                    } label: {
                        Label("Switch Profile", systemImage: "person.2.fill")
                    }
                }

                Section {
                    Toggle(isOn: Binding(
                        get: { session.profile?.englishTitles ?? false },
                        set: { on in
                            Task {
                                savingEnglish = true
                                try? await session.setEnglishTitles(on)
                                savingEnglish = false
                            }
                        }
                    )) {
                        Label("Titles in English", systemImage: "character.bubble")
                    }
                    .disabled(savingEnglish)
                } footer: {
                    Text("Shows English titles and descriptions for movies and shows stored in another language, where available. For this profile, here and on the web and Apple TV.")
                }

                if !profile.isKids {
                    Section {
                        NavigationLink {
                            ApproveSignInView()
                        } label: {
                            Label("Approve a Sign-In", systemImage: "qrcode.viewfinder")
                        }
                    } footer: {
                        Text("Signing in on an Apple TV, another phone or a browser? Choose Quick Login there and enter the code it shows here.")
                    }
                }
            }

            Section("Server") {
                LabeledContent("Address", value: session.serverURL?.absoluteString ?? "—")
                if session.usingPublicAddress {
                    Label("Away from home — using the public address", systemImage: "globe")
                        .foregroundStyle(.secondary)
                } else if let publicURL = session.publicURL {
                    LabeledContent("Public address", value: publicURL.absoluteString)
                }
                Button("Change Server", role: .destructive) { confirmChangeServer = true }
            }

            Section {
                Button("Sign Out", role: .destructive) {
                    dismiss()
                    session.signOut()
                }
            } footer: {
                VStack(alignment: .leading, spacing: 6) {
                    BrandMark(size: 14)
                    Text("Version \(Self.appVersion)")
                }
                .padding(.top, 8)
            }
        }
        .navigationTitle("Profile & Settings")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { dismiss() }
            }
        }
        .confirmationDialog("Change server?", isPresented: $confirmChangeServer, titleVisibility: .visible) {
            Button("Change Server", role: .destructive) {
                dismiss()
                session.changeServer()
            }
        } message: {
            Text("You'll be signed out and asked for a server address.")
        }
    }
}

/// Approve a Quick Login code shown on another device (TV, phone or browser).
struct ApproveSignInView: View {
    @EnvironmentObject private var session: Session
    @State private var code = ""
    @State private var deviceName: String?
    @State private var busy = false
    @State private var errorText: String?
    @State private var approved = false
    @FocusState private var focused: Bool

    private var normalized: String {
        code.uppercased().filter { $0.isLetter || $0.isNumber }
    }

    var body: some View {
        Form {
            Section {
                TextField("ABC-234", text: $code)
                    .font(.system(.title2, design: .monospaced).weight(.bold))
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit { Task { await lookUp() } }
                    .onChange(of: code) { _, _ in
                        deviceName = nil
                        errorText = nil
                        approved = false
                    }
            } header: {
                Text("Code from the other device")
            } footer: {
                Text("On the TV or browser, choose Quick Login — it shows a 6-character code.")
            }

            if let errorText {
                Section { Label(errorText, systemImage: "exclamationmark.triangle").foregroundStyle(.red) }
            }

            if approved {
                Section {
                    Label("\(deviceName ?? "The device") is signing in now.", systemImage: "checkmark.circle.fill")
                        .foregroundStyle(.green)
                }
            } else if let deviceName {
                Section {
                    Text("Sign in **\(deviceName)** as \(session.user?.username ?? "you")?")
                    Button {
                        Task { await approve() }
                    } label: {
                        if busy { ProgressView() } else { Text("Approve") }
                    }
                    .disabled(busy)
                }
            } else {
                Section {
                    Button {
                        Task { await lookUp() }
                    } label: {
                        if busy { ProgressView() } else { Text("Continue") }
                    }
                    .disabled(normalized.count < 6 || busy)
                }
            }
        }
        .navigationTitle("Approve a Sign-In")
        .onAppear { focused = true }
    }

    private struct CodeInfo: Decodable {
        let deviceName: String?
    }

    private func lookUp() async {
        guard normalized.count >= 6 else { return }
        busy = true
        errorText = nil
        do {
            let info = try await session.get("/api/auth/quick/\(normalized)", as: CodeInfo.self)
            deviceName = info.deviceName ?? "Device"
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }

    private func approve() async {
        busy = true
        errorText = nil
        do {
            _ = try await session.post("/api/auth/quick/\(normalized)/approve", as: Empty.self)
            approved = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            errorText = error.localizedDescription
        }
        busy = false
    }
}
