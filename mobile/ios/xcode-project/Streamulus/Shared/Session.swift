// Shared with the Apple TV app — tv/appletv/generate_project.rb copies this folder into
// its project. Edit it here, then run that script to update the Apple TV copy.

import Foundation
import SwiftUI
import UIKit

/// Which screen the app shows, and the signed-in account/profile.
@MainActor
final class Session: ObservableObject {
    enum Phase: Equatable {
        case starting
        case needsServer
        case signedOut
        case pickingProfile
        case ready
        case unreachable(String)
    }

    @Published private(set) var phase: Phase = .starting
    @Published private(set) var user: User?
    @Published private(set) var profile: Profile? {
        didSet { if profile != oldValue { Task { await refreshTabAvatar() } } }
    }
    /// Small round picture of the current profile for the tab bar (still).
    @Published private(set) var tabAvatar: UIImage?
    /// The address in use right now: the home one, or the public one when away.
    @Published private(set) var serverURL: URL?
    /// The address entered when setting up (usually on the home network).
    @Published private(set) var homeURL: URL?
    /// The server's public address (Admin › Settings › Remote Access, e.g. a
    /// Tailscale Funnel URL), learned from the server; used when home doesn't answer.
    @Published private(set) var publicURL: URL?
    /// Logo / text settings from Admin › Settings › Branding.
    @Published private(set) var branding = Branding.default

    var usingPublicAddress: Bool { serverURL != nil && serverURL == publicURL && serverURL != homeURL }

    private var api: APIClient?

    private static let serverKey = "serverURL"
    private static let publicKey = "publicServerURL"
    private static let tokenKey = "token"

    init() {
        if let saved = UserDefaults.standard.string(forKey: Self.serverKey), let url = URL(string: saved) {
            homeURL = url
            serverURL = url
            api = APIClient(baseURL: url, token: Keychain.get(Self.tokenKey))
        } else if let preset = Self.presetServer {
            // Built-in server (see StreamulusServerURL in Info.plist), so the app just works.
            homeURL = preset
        }
        if let saved = UserDefaults.standard.string(forKey: Self.publicKey), let url = URL(string: saved) {
            publicURL = url
        }
    }

    /// Optional server address built into the app (Info.plist key StreamulusServerURL),
    /// e.g. your public Tailscale Funnel address for friends' phones.
    static var presetServer: URL? {
        guard let text = Bundle.main.object(forInfoDictionaryKey: "StreamulusServerURL") as? String,
              !text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return URL(string: text.trimmingCharacters(in: .whitespaces))
    }

    // MARK: Start-up

    func start() async {
        guard homeURL != nil else { phase = .needsServer; return }
        phase = .starting
        // Whichever answers: the home address first, then the public one.
        guard await connectToReachableAddress() else {
            phase = .unreachable(publicURL == nil
                ? "The server isn't answering at \(homeURL?.host ?? "its address")."
                : "The server isn't answering at home (\(homeURL?.host ?? "")) or at \(publicURL?.host ?? "its public address").")
            return
        }
        if UserDefaults.standard.string(forKey: Self.serverKey) == nil, let home = homeURL {
            UserDefaults.standard.set(home.absoluteString, forKey: Self.serverKey) // first run with a preset server
        }
        await refreshBranding()
        guard let api, api.token != nil else { phase = .signedOut; return }
        do {
            let me: MeResponse = try await api.get("/api/auth/me")
            user = me.user
            profile = me.profile
            phase = .ready
        } catch let error as APIError where error.status == 401 {
            signOut()
        } catch {
            phase = .unreachable(error.localizedDescription)
        }
    }

    // MARK: Server

    /// Accepts "192.168.1.20:8096", "http://nas.local:8096/", "https://name.tailnet.ts.net", etc.
    func setServer(_ text: String) async throws {
        var address = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !address.contains("://") { address = "http://" + address }
        while address.hasSuffix("/") { address.removeLast() }
        guard let url = URL(string: address), url.host != nil else {
            throw APIError(status: 0, message: "That doesn't look like a server address.", code: nil)
        }
        let client = APIClient(baseURL: url)
        _ = try await client.get("/api/health", as: HealthResponse.self)
        UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
        UserDefaults.standard.removeObject(forKey: Self.publicKey) // another server's public address
        Keychain.delete(Self.tokenKey)
        homeURL = url
        publicURL = nil
        serverURL = url
        api = client
        await refreshBranding()
        phase = .signedOut
    }

    func changeServer() {
        signOut()
        UserDefaults.standard.removeObject(forKey: Self.serverKey)
        UserDefaults.standard.removeObject(forKey: Self.publicKey)
        homeURL = nil
        publicURL = nil
        serverURL = nil
        api = nil
        branding = .default
        phase = .needsServer
    }

    // MARK: Home / public address

    /// Use the home address if it answers quickly, otherwise the public one.
    private func connectToReachableAddress() async -> Bool {
        if let home = homeURL, await APIClient.ping(home, timeout: 4) {
            use(home)
            return true
        }
        if let pub = publicURL, pub != homeURL, await APIClient.ping(pub, timeout: 10) {
            use(pub)
            return true
        }
        return false
    }

    private func use(_ url: URL) {
        guard serverURL != url || api == nil else { return }
        serverURL = url
        api = APIClient(baseURL: url, token: Keychain.get(Self.tokenKey))
    }

    /// The current address stopped answering (left home, or came back): try the other one.
    private func switchAddress() async -> Bool {
        let other = serverURL == publicURL ? homeURL : publicURL
        guard let other, other != serverURL, await APIClient.ping(other, timeout: 6) else { return false }
        use(other)
        return true
    }

    /// Branding and the public address from the server (public endpoint, no sign-in needed).
    func refreshBranding() async {
        guard let api else { return }
        guard let fetched = try? await api.get("/api/branding", as: Branding.self) else { return }
        branding = fetched
        if let text = fetched.publicUrl, let url = URL(string: text) {
            publicURL = url
            UserDefaults.standard.set(url.absoluteString, forKey: Self.publicKey)
        } else {
            publicURL = nil
            UserDefaults.standard.removeObject(forKey: Self.publicKey)
        }
    }

    // MARK: Sign in / out

    func login(username: String, password: String) async throws {
        let response: LoginResponse = try await client().post("/api/auth/login", body: ["username": username, "password": password])
        completeSignIn(token: response.token, user: response.user, profile: response.profile, profileCount: response.profileCount)
    }

    /// Finish signing in with a token from a password sign-in or an approved Quick Login.
    func completeSignIn(token: String, user: User, profile: Profile, profileCount: Int) {
        Keychain.set(token, for: Self.tokenKey)
        api?.token = token
        self.user = user
        self.profile = profile
        phase = profileCount > 1 ? .pickingProfile : .ready
    }

    func signOut() {
        Keychain.delete(Self.tokenKey)
        api?.token = nil
        user = nil
        profile = nil
        phase = api == nil ? .needsServer : .signedOut
    }

    // MARK: Quick Login

    func quickLoginStart() async throws -> QuickStartResponse {
        // "Apple TV", "iPhone" or "iPad" — shown on the device that approves it.
        try await client().post("/api/auth/quick/start", body: ["deviceName": UIDevice.current.model])
    }

    func quickLoginPoll(requestId: String) async throws -> QuickPollResponse {
        try await client().post("/api/auth/quick/poll", body: ["requestId": requestId])
    }

    /// Web page the QR code opens, with the code filled in.
    func quickLoginLink(code: String) -> String {
        guard let api else { return "" }
        return api.url("/quick-login", query: [URLQueryItem(name: "code", value: code)]).absoluteString
    }

    // MARK: Profiles

    func profiles() async throws -> [Profile] {
        let response: ProfilesResponse = try await get("/api/profiles")
        return response.profiles
    }

    /// Switch profile. `pin` / `password` when the profile list says it needs one.
    func selectProfile(_ target: Profile, pin: String? = nil, password: String? = nil) async throws {
        var body: [String: Any] = [:]
        if let pin { body["pin"] = pin }
        if let password { body["password"] = password }
        let response: SelectProfileResponse = try await post("/api/profiles/\(target.id)/select", body: body)
        Keychain.set(response.token, for: Self.tokenKey)
        api?.token = response.token
        profile = response.profile
        phase = .ready
    }

    func switchProfile() {
        phase = .pickingProfile
    }

    /// Show titles and descriptions in English (this profile, web and TV).
    /// Screens reload their lists when `profile` changes.
    func setEnglishTitles(_ on: Bool) async throws {
        guard let current = profile else { return }
        let response: UpdateProfileResponse = try await signedIn { try await $0.put("/api/profiles/\(current.id)", body: ["english_titles": on]) }
        profile = response.profile
    }

    // MARK: Requests (signed in)

    func get<T: Decodable>(_ path: String, query: [URLQueryItem] = [], as type: T.Type = T.self) async throws -> T {
        try await signedIn { try await $0.get(path, query: query) }
    }

    func post<T: Decodable>(_ path: String, body: [String: Any] = [:], as type: T.Type = T.self) async throws -> T {
        try await signedIn { try await $0.post(path, body: body) }
    }

    func getText(_ path: String) async throws -> String {
        try await signedIn { try await $0.getText(path) }
    }

    /// Subtitles: the WebVTT text and whether it's complete (the server serves
    /// what it has read so far while it extracts subtitles from a big file).
    func getSubtitles(_ path: String) async throws -> (text: String, complete: Bool) {
        let response = try await signedIn { try await $0.getTextResponse(path) }
        let flag = response.headers.first { String(describing: $0.key).lowercased() == "x-subtitles-complete" }?.value as? String
        return (response.text, flag != "0")
    }

    /// Runs a request; a 401 (expired token, removed profile) signs out.
    private func signedIn<T>(_ request: (APIClient) async throws -> T) async throws -> T {
        do {
            return try await request(try client())
        } catch let error as APIError where error.status == 401 {
            signOut()
            throw error
        } catch let error as URLError where Self.unreachable.contains(error.code) {
            // Left home (or came back): switch between the home and public address and retry once.
            guard await switchAddress() else { throw error }
            return try await request(try client())
        }
    }

    private static let unreachable: Set<URLError.Code> = [
        .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost, .notConnectedToInternet, .dnsLookupFailed,
    ]

    private func client() throws -> APIClient {
        guard let api else { throw APIError(status: 0, message: "No server set up.", code: nil) }
        return api
    }

    // MARK: Tab bar avatar

    private func refreshTabAvatar() async {
        guard let profile else { tabAvatar = nil; return }
        var photo: UIImage?
        if let url = imageURL(profile.avatarPath) {
            photo = await AnimatedImageLoader.load(url, maxPixelSize: 96)
        }
        guard self.profile?.id == profile.id else { return }
        // Tab bar icons are shown at their own size, so keep this within the bar's height.
        // A GIF shows its first frame.
        tabAvatar = Self.roundAvatar(photo: photo?.images?.first ?? photo, profile: profile, size: 32)
    }

    /// Circle-cropped photo, or the profile's initial on its gradient.
    private static func roundAvatar(photo: UIImage?, profile: Profile, size: CGFloat) -> UIImage {
        let rect = CGRect(x: 0, y: 0, width: size, height: size)
        let image = UIGraphicsImageRenderer(size: rect.size).image { context in
            UIBezierPath(ovalIn: rect).addClip()
            if let photo {
                let scale = max(size / photo.size.width, size / photo.size.height)
                let drawSize = CGSize(width: photo.size.width * scale, height: photo.size.height * scale)
                photo.draw(in: CGRect(x: (size - drawSize.width) / 2, y: (size - drawSize.height) / 2, width: drawSize.width, height: drawSize.height))
            } else {
                let colors = profile.isKids
                    ? [UIColor(red: 1, green: 0.72, blue: 0.01, alpha: 1).cgColor, UIColor(red: 0.98, green: 0.34, blue: 0.03, alpha: 1).cgColor]
                    : [UIColor(red: 0, green: 0.76, blue: 1, alpha: 1).cgColor, UIColor(red: 0.48, green: 0.18, blue: 1, alpha: 1).cgColor]
                if let gradient = CGGradient(colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colors as CFArray, locations: [0, 1]) {
                    context.cgContext.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: size, y: size), options: [])
                }
                let initial = String(profile.name.prefix(1)).uppercased() as NSString
                let attributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: size * 0.45, weight: .bold),
                    .foregroundColor: UIColor.white,
                ]
                let textSize = initial.size(withAttributes: attributes)
                initial.draw(at: CGPoint(x: (size - textSize.width) / 2, y: (size - textSize.height) / 2), withAttributes: attributes)
            }
        }
        return image.withRenderingMode(.alwaysOriginal)
    }

    // MARK: URLs

    /// Artwork URL: full URLs as-is, uploads from this server, other paths from TMDB.
    func imageURL(_ path: String?) -> URL? {
        guard let path, !path.isEmpty else { return nil }
        if path.hasPrefix("http://") || path.hasPrefix("https://") { return URL(string: path) }
        if path.hasPrefix("/uploads/") { return api?.url(path) }
        if path.hasPrefix("/") { return URL(string: "https://image.tmdb.org/t/p/w780" + path) }
        return nil
    }

    /// A frame from `seconds` into the movie/episode (Continue Watching).
    func stillURL(type: String, id: Int, at seconds: Int) -> URL? {
        guard let api, let token = api.token else { return nil }
        return api.url("/api/stream/still/\(type)/\(id)", query: [
            URLQueryItem(name: "t", value: String(seconds)),
            URLQueryItem(name: "token", value: token),
        ])
    }

    /// HLS stream for a movie/episode, starting `start` seconds in. `compat` asks
    /// the server to re-encode everything instead of copying the source.
    func streamURL(type: MediaType, id: Int, start: Int, compat: Bool = false) -> URL? {
        guard let api, let token = api.token else { return nil }
        var query = [URLQueryItem(name: "token", value: token)]
        if start > 0 { query.append(URLQueryItem(name: "start", value: String(start))) }
        if compat { query.append(URLQueryItem(name: "compat", value: "1")) }
        return api.url("/api/stream/hls/\(type.rawValue)/\(id)/manifest.m3u8", query: query)
    }
}
