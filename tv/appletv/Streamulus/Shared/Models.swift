// Copied from mobile/ios/xcode-project/Streamulus/Shared/Models.swift by generate_project.rb.
// Edit the original there, then run tv/appletv/generate_project.rb.

import Foundation

// Models for the Streamulus API. Decoding is deliberately forgiving: the server
// (SQLite) can return numbers as integers or decimals, booleans as 0/1, and
// many fields as null.

extension KeyedDecodingContainer {
    func lossyInt(_ key: Key) -> Int? {
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return Int(value) }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Int(value) }
        return nil
    }

    func lossyDouble(_ key: Key) -> Double? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return Double(value) }
        return nil
    }

    func lossyString(_ key: Key) -> String? {
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return String(value) }
        if let value = try? decodeIfPresent(Double.self, forKey: key) { return String(value) }
        return nil
    }

    func lossyBool(_ key: Key) -> Bool {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) { return value }
        if let value = try? decodeIfPresent(Int.self, forKey: key) { return value != 0 }
        if let value = try? decodeIfPresent(String.self, forKey: key) { return value == "true" || value == "1" }
        return false
    }

    func lossyStrings(_ key: Key) -> [String] {
        (try? decodeIfPresent([String].self, forKey: key)) ?? []
    }
}

enum MediaType: String {
    case movie
    case episode
}

// MARK: - Accounts & profiles

struct User: Decodable, Hashable {
    let id: Int
    let username: String
    let role: String

    enum CodingKeys: String, CodingKey { case id, username, role }
}

extension User {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        username = c.lossyString(.username) ?? ""
        role = c.lossyString(.role) ?? "user"
    }
}

struct Profile: Decodable, Identifiable, Hashable {
    let id: Int
    let name: String
    let avatarPath: String?
    let isMain: Bool
    let isKids: Bool
    let hasPin: Bool
    /// What switching to this profile needs from the current one: "pin", "password" or nil.
    let requires: String?
    /// Show titles and descriptions in English where available.
    let englishTitles: Bool
    /// Preferred audio for files with several tracks: "default", "original" or a language code.
    let audioLanguage: String
    /// Turn on English subtitles when the audio is in another language.
    let autoSubtitles: Bool

    enum CodingKeys: String, CodingKey {
        case id, name, requires
        case englishTitles = "english_titles"
        case audioLanguage = "audio_language"
        case autoSubtitles = "auto_subtitles"
        case avatarPath = "avatar_url"
        case isMain = "is_main"
        case isKids = "is_kids"
        case hasPin = "has_pin"
    }
}

extension Profile {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        name = c.lossyString(.name) ?? ""
        avatarPath = c.lossyString(.avatarPath)
        isMain = c.lossyBool(.isMain)
        isKids = c.lossyBool(.isKids)
        hasPin = c.lossyBool(.hasPin)
        requires = c.lossyString(.requires)
        englishTitles = c.lossyBool(.englishTitles)
        audioLanguage = c.lossyString(.audioLanguage) ?? "default"
        autoSubtitles = c.lossyBool(.autoSubtitles)
    }
}

struct LoginResponse: Decodable {
    let token: String
    let user: User
    let profile: Profile
    let profileCount: Int
}

/// A new account, waiting for its Admin Passphrase.
struct RegisterResponse: Decodable {
    let username: String
    let message: String
}

extension APIError {
    /// The server wants (or didn't accept) a new account's Admin Passphrase.
    var isPassphraseError: Bool { code?.hasPrefix("PASSPHRASE_") == true }
}

struct MeResponse: Decodable {
    let user: User
    let profile: Profile
}

struct ProfilesResponse: Decodable {
    let profiles: [Profile]
}

struct UpdateProfileResponse: Decodable {
    let profile: Profile
}

/// Profile pictures the admin provides (Admin › Profile Pictures), as offered to
/// one profile: only those meant for Streamers or Streamlings, as it is.
struct AvatarChoices: Decodable {
    let categories: [AvatarCategory]
    let currentImageId: Int?
}

struct AvatarCategory: Decodable, Identifiable {
    let id: Int
    let name: String
    let images: [AvatarChoice]
}

struct AvatarChoice: Decodable, Identifiable, Hashable {
    let id: Int
    let url: String
}

struct SelectProfileResponse: Decodable {
    let token: String
    let profile: Profile
}

struct HealthResponse: Decodable {
    let ok: Bool
}

// MARK: - Quick Login

struct QuickStartResponse: Decodable {
    let requestId: String
    let code: String
    let expiresIn: Int
    let interval: Int
}

struct QuickPollResponse: Decodable {
    let status: String
    let token: String?
    let user: User?
    let profile: Profile?
    let profileCount: Int?
}

// MARK: - Library

struct Movie: Decodable, Identifiable, Hashable {
    let id: Int
    let title: String
    let year: Int?
    let overview: String?
    let posterPath: String?
    let backdropPath: String?
    let logoPath: String?
    let rating: Double?
    let contentRating: String?
    let genres: [String]
    let duration: Int?
    let watchCompleted: Bool
    let watchPosition: Int

    enum CodingKeys: String, CodingKey {
        case id, title, year, overview, rating, genres, duration
        case posterPath = "poster_url"
        case backdropPath = "backdrop_url"
        case logoPath = "logo_url"
        case contentRating = "content_rating"
        case watchCompleted = "watch_completed"
        case watchPosition = "watch_position"
    }
}

extension Movie {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        title = c.lossyString(.title) ?? "Untitled"
        year = c.lossyInt(.year)
        overview = c.lossyString(.overview)
        posterPath = c.lossyString(.posterPath)
        backdropPath = c.lossyString(.backdropPath)
        logoPath = c.lossyString(.logoPath)
        rating = c.lossyDouble(.rating)
        contentRating = c.lossyString(.contentRating)
        genres = c.lossyStrings(.genres)
        duration = c.lossyInt(.duration)
        watchCompleted = c.lossyBool(.watchCompleted)
        watchPosition = c.lossyInt(.watchPosition) ?? 0
    }
}

struct Show: Decodable, Identifiable, Hashable {
    let id: Int
    let title: String
    let overview: String?
    let posterPath: String?
    let backdropPath: String?
    let firstAirDate: String?
    let rating: Double?
    let contentRating: String?
    let genres: [String]
    let totalEpisodes: Int
    let watchedEpisodes: Int
    let logoPath: String?

    enum CodingKeys: String, CodingKey {
        case id, title, overview, rating, genres
        case posterPath = "poster_url"
        case backdropPath = "backdrop_url"
        case logoPath = "logo_url"
        case firstAirDate = "first_air_date"
        case contentRating = "content_rating"
        case totalEpisodes = "total_episodes"
        case watchedEpisodes = "watched_episodes"
    }

    var year: String? { firstAirDate.map { String($0.prefix(4)) } }
}

extension Show {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        title = c.lossyString(.title) ?? "Untitled"
        overview = c.lossyString(.overview)
        posterPath = c.lossyString(.posterPath)
        backdropPath = c.lossyString(.backdropPath)
        firstAirDate = c.lossyString(.firstAirDate)
        rating = c.lossyDouble(.rating)
        contentRating = c.lossyString(.contentRating)
        genres = c.lossyStrings(.genres)
        totalEpisodes = c.lossyInt(.totalEpisodes) ?? 0
        watchedEpisodes = c.lossyInt(.watchedEpisodes) ?? 0
        logoPath = c.lossyString(.logoPath)
    }
}

struct Season: Decodable, Identifiable, Hashable {
    let season: Int
    let episodeCount: Int
    let watchedCount: Int
    let posterPath: String?

    var id: Int { season }

    enum CodingKeys: String, CodingKey {
        case season
        case episodeCount = "episode_count"
        case watchedCount = "watched_count"
        case posterPath = "season_poster"
    }
}

extension Season {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        season = c.lossyInt(.season) ?? 0
        episodeCount = c.lossyInt(.episodeCount) ?? 0
        watchedCount = c.lossyInt(.watchedCount) ?? 0
        posterPath = c.lossyString(.posterPath)
    }
}

struct Episode: Decodable, Identifiable, Hashable {
    let id: Int
    let season: Int
    let episodeNumber: Int
    let title: String?
    let overview: String?
    let stillPath: String?
    let duration: Int?
    let watchCompleted: Bool
    let watchPosition: Int

    enum CodingKeys: String, CodingKey {
        case id, season, title, overview, duration
        case episodeNumber = "episode_number"
        case stillPath = "still_url"
        case watchCompleted = "watch_completed"
        case watchPosition = "watch_position"
    }

    var inProgress: Bool { !watchCompleted && watchPosition > 10 }
    var label: String { "S\(season) E\(episodeNumber)" }
    var displayTitle: String { title ?? "Episode \(episodeNumber)" }
}

extension Episode {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        season = c.lossyInt(.season) ?? 0
        episodeNumber = c.lossyInt(.episodeNumber) ?? 0
        title = c.lossyString(.title)
        overview = c.lossyString(.overview)
        stillPath = c.lossyString(.stillPath)
        duration = c.lossyInt(.duration)
        watchCompleted = c.lossyBool(.watchCompleted)
        watchPosition = c.lossyInt(.watchPosition) ?? 0
    }
}

struct ContinueItem: Decodable, Identifiable, Hashable {
    let type: String
    let mediaId: Int
    let position: Int
    let title: String
    let subtitle: String?
    let posterPath: String?
    let backdropPath: String?
    let duration: Int?

    var id: String { "\(type)-\(mediaId)" }

    enum CodingKeys: String, CodingKey {
        case type, position, title, subtitle, duration
        case mediaId = "id"
        case posterPath = "poster_url"
        case backdropPath = "backdrop_url"
    }
}

extension ContinueItem {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        type = c.lossyString(.type) ?? "movie"
        mediaId = c.lossyInt(.mediaId) ?? 0
        position = c.lossyInt(.position) ?? 0
        title = c.lossyString(.title) ?? ""
        subtitle = c.lossyString(.subtitle)
        posterPath = c.lossyString(.posterPath)
        backdropPath = c.lossyString(.backdropPath)
        duration = c.lossyInt(.duration)
    }
}

struct WatchProgress: Decodable {
    let position: Int
    let completed: Bool

    enum CodingKeys: String, CodingKey { case position, completed }

    static let none = WatchProgress(position: 0, completed: false)
}

extension WatchProgress {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        position = c.lossyInt(.position) ?? 0
        completed = c.lossyBool(.completed)
    }
}

// MARK: - Responses

struct MoviesResponse: Decodable { let movies: [Movie] }
struct ShowsResponse: Decodable { let shows: [Show] }
struct ContinueResponse: Decodable { let items: [ContinueItem] }
struct FeaturedResponse: Decodable {
    let movie: Movie?
    /// How often Home switches to another featured movie (admin setting).
    let rotateSeconds: Int?
}

struct CastMember: Decodable, Identifiable, Hashable {
    let id: Int
    let name: String
    let character: String?
    let profilePath: String?

    enum CodingKeys: String, CodingKey {
        case id, name, character
        case profilePath = "profile_url"
    }
}

extension CastMember {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        name = c.lossyString(.name) ?? ""
        character = c.lossyString(.character)
        profilePath = c.lossyString(.profilePath)
    }
}

struct MovieDetailsResponse: Decodable {
    let movie: Movie
    let cast: [CastMember]
    let director: String?
    let similarLocal: [Movie]

    enum CodingKeys: String, CodingKey { case movie, cast, director, similarLocal }
}

extension MovieDetailsResponse {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        movie = try c.decode(Movie.self, forKey: .movie)
        cast = (try? c.decode([CastMember].self, forKey: .cast)) ?? []
        director = c.lossyString(.director)
        similarLocal = (try? c.decode([Movie].self, forKey: .similarLocal)) ?? []
    }
}
struct SeasonResponse: Decodable { let episodes: [Episode] }

struct ShowDetailsResponse: Decodable {
    let show: Show
    let seasons: [Season]
    let firstEpisodeId: Int?
    let started: Bool
    let cast: [CastMember]
    let similarLocal: [Show]

    enum CodingKeys: String, CodingKey { case show, seasons, firstEpisodeId, started, cast, similarLocal }
}

extension ShowDetailsResponse {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        show = try c.decode(Show.self, forKey: .show)
        seasons = (try? c.decode([Season].self, forKey: .seasons)) ?? []
        firstEpisodeId = c.lossyInt(.firstEpisodeId)
        started = c.lossyBool(.started)
        cast = (try? c.decode([CastMember].self, forKey: .cast)) ?? []
        similarLocal = (try? c.decode([Show].self, forKey: .similarLocal)) ?? []
    }
}

/// GET /api/tv/episode/:id — used for the player's title when resuming an episode.
struct EpisodeInfo: Decodable {
    let season: Int
    let episodeNumber: Int
    let episodeTitle: String?
    let showTitle: String

    enum CodingKeys: String, CodingKey {
        case season
        case episodeNumber = "episode_number"
        case episodeTitle = "episode_title"
        case showTitle = "show_title"
    }
}

extension EpisodeInfo {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        season = c.lossyInt(.season) ?? 0
        episodeNumber = c.lossyInt(.episodeNumber) ?? 0
        episodeTitle = c.lossyString(.episodeTitle)
        showTitle = c.lossyString(.showTitle) ?? ""
    }
}

struct NextEpisode: Decodable {
    let id: Int
    let season: Int
    let episodeNumber: Int
    let title: String?

    enum CodingKeys: String, CodingKey {
        case id, season, title
        case episodeNumber = "episode_number"
    }
}

extension NextEpisode {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        season = c.lossyInt(.season) ?? 0
        episodeNumber = c.lossyInt(.episodeNumber) ?? 0
        title = c.lossyString(.title)
    }
}

struct NextEpisodeResponse: Decodable {
    let next: NextEpisode?
    /// Seconds before the end the Up Next card appears (Admin > Settings).
    let upNextSeconds: Int

    enum CodingKeys: String, CodingKey { case next, upNextSeconds }
}

extension NextEpisodeResponse {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        next = try? c.decodeIfPresent(NextEpisode.self, forKey: .next)
        upNextSeconds = c.lossyInt(.upNextSeconds) ?? 30
    }
}

// MARK: - Genres

struct GenreSummary: Decodable, Identifiable, Hashable {
    let name: String
    let movieCount: Int
    let showCount: Int
    /// The admin's image for the genre, or a random title's artwork.
    let imageURL: String?

    var id: String { name }

    enum CodingKeys: String, CodingKey {
        case name
        case movieCount = "movie_count"
        case showCount = "show_count"
        case imageURL = "image_url"
    }
}

extension GenreSummary {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = c.lossyString(.name) ?? ""
        movieCount = c.lossyInt(.movieCount) ?? 0
        showCount = c.lossyInt(.showCount) ?? 0
        imageURL = c.lossyString(.imageURL)
    }
}

struct GenresResponse: Decodable {
    let genres: [GenreSummary]
}

struct GenreDetailResponse: Decodable {
    let genre: String
    let movies: [Movie]
    let shows: [Show]
}

/// A movie or a show in a genre's grid. The id keeps movies and shows apart
/// (both tables number from 1).
enum GenreItem: Identifiable, Hashable {
    case movie(Movie)
    case show(Show)

    var id: Int {
        switch self {
        case .movie(let movie): return movie.id * 2
        case .show(let show): return show.id * 2 + 1
        }
    }
}

// MARK: - Subtitles

struct SubtitleTrack: Decodable, Identifiable, Hashable {
    let id: String
    let label: String
    let language: String?
    let forced: Bool

    enum CodingKeys: String, CodingKey { case id, label, language, forced }
}

extension SubtitleTrack {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyString(.id) ?? ""
        label = c.lossyString(.label) ?? "Subtitles"
        language = c.lossyString(.language)
        forced = c.lossyBool(.forced)
    }
}

struct SubtitleTracksResponse: Decodable {
    let tracks: [SubtitleTrack]
}

// MARK: - Audio tracks

/// One of a file's audio tracks (e.g. Japanese and English on dual-audio anime).
/// `index` is what the stream URL's `audio` takes.
struct AudioTrack: Decodable, Identifiable, Hashable {
    let index: Int
    let label: String
    let language: String?
    let codec: String?
    let commentary: Bool

    var id: Int { index }

    enum CodingKeys: String, CodingKey { case index, label, language, codec, commentary }
}

extension AudioTrack {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        index = c.lossyInt(.index) ?? 0
        label = c.lossyString(.label) ?? "Track \(index + 1)"
        language = c.lossyString(.language)
        codec = c.lossyString(.codec)
        commentary = c.lossyBool(.commentary)
    }
}

/// GET /api/stream/audio/:type/:id — the tracks, the one the stream plays by
/// default for this profile, and whether to turn on English subtitles with
/// audio in other languages.
struct AudioTracksResponse: Decodable {
    let tracks: [AudioTrack]
    let selected: Int?
    let autoSubtitles: Bool

    enum CodingKeys: String, CodingKey { case tracks, selected, autoSubtitles }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tracks = (try? c.decode([AudioTrack].self, forKey: .tracks)) ?? []
        selected = c.lossyInt(.selected)
        autoSubtitles = c.lossyBool(.autoSubtitles)
    }
}

/// Choices for a profile's Audio language setting.
enum AudioLanguage {
    static let options: [(code: String, name: String)] = [
        ("default", "File's default"),
        ("original", "Original language"),
        ("en", "English"), ("ja", "Japanese"), ("es", "Spanish"), ("fr", "French"), ("de", "German"),
        ("it", "Italian"), ("pt", "Portuguese"), ("ko", "Korean"), ("zh", "Chinese"), ("hi", "Hindi"), ("ru", "Russian"),
    ]

    static func name(_ code: String) -> String {
        options.first { $0.code == code }?.name ?? code.uppercased()
    }
}

struct SubtitleCue {
    let start: Double
    let end: Double
    let lines: [String]
}

/// Minimal WebVTT reader for the player's own subtitle overlay. Cue times are
/// the video file's own times.
enum WebVTT {
    static func parse(_ text: String) -> [SubtitleCue] {
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var cues: [SubtitleCue] = []
        for block in normalized.components(separatedBy: "\n\n") {
            let lines = block.components(separatedBy: "\n")
            guard let at = lines.firstIndex(where: { $0.contains("-->") }) else { continue }
            let parts = lines[at].components(separatedBy: "-->")
            guard parts.count == 2,
                  let start = seconds(parts[0]),
                  let end = seconds(parts[1].trimmingCharacters(in: .whitespaces).components(separatedBy: " ").first ?? ""),
                  end > start else { continue }
            let body = lines[(at + 1)...].map(clean).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
            if !body.isEmpty { cues.append(SubtitleCue(start: start, end: end, lines: body)) }
        }
        return cues.sorted { $0.start < $1.start }
    }

    /// Lines of every cue showing at `time`.
    static func lines(in cues: [SubtitleCue], at time: Double) -> [String] {
        // First cue starting after `time`, then look back over the few before it.
        var low = 0, high = cues.count
        while low < high {
            let mid = (low + high) / 2
            if cues[mid].start > time { high = mid } else { low = mid + 1 }
        }
        var result: [String] = []
        var index = low - 1
        while index >= 0 && index >= low - 8 {
            if cues[index].end > time { result.insert(contentsOf: cues[index].lines, at: 0) }
            index -= 1
        }
        return result
    }

    private static func seconds(_ stamp: String) -> Double? {
        let parts = stamp.trimmingCharacters(in: .whitespaces).components(separatedBy: ":").compactMap { Double($0) }
        switch parts.count {
        case 3: return parts[0] * 3600 + parts[1] * 60 + parts[2]
        case 2: return parts[0] * 60 + parts[1]
        default: return nil
        }
    }

    private static func clean(_ line: String) -> String {
        line.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&nbsp;", with: " ")
    }
}

// MARK: - Feedback

/// Feedback or an app suggestion sent from Profile & Settings: a conversation
/// with the server's admin. Times are milliseconds since 1970.
struct FeedbackItem: Decodable, Identifiable, Hashable {
    let id: Int
    let kind: String          // "feedback" | "suggestion"
    let status: String        // "open" | "answered" | "closed"
    let createdAt: Double
    let updatedAt: Double
    let preview: String
    let unread: Bool
    let messages: [FeedbackMessage]

    enum CodingKeys: String, CodingKey { case id, kind, status, createdAt, updatedAt, preview, unread, messages }

    var kindLabel: String { kind == "suggestion" ? "App Suggestion" : "Feedback" }
    var statusLabel: String {
        switch status {
        case "answered": return "Answered"
        case "closed": return "Closed"
        default: return "Waiting for reply"
        }
    }
    var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

extension FeedbackItem {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        kind = c.lossyString(.kind) ?? "feedback"
        status = c.lossyString(.status) ?? "open"
        createdAt = c.lossyDouble(.createdAt) ?? 0
        updatedAt = c.lossyDouble(.updatedAt) ?? 0
        preview = c.lossyString(.preview) ?? ""
        unread = c.lossyBool(.unread)
        messages = (try? c.decode([FeedbackMessage].self, forKey: .messages)) ?? []
    }
}

struct FeedbackMessage: Decodable, Identifiable, Hashable {
    let id: Int
    let fromAdmin: Bool
    let author: String?
    let body: String
    let createdAt: Double

    enum CodingKeys: String, CodingKey { case id, fromAdmin, author, body, createdAt }

    var date: Date { Date(timeIntervalSince1970: createdAt / 1000) }
}

extension FeedbackMessage {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyInt(.id) ?? 0
        fromAdmin = c.lossyBool(.fromAdmin)
        author = c.lossyString(.author)
        body = c.lossyString(.body) ?? ""
        createdAt = c.lossyDouble(.createdAt) ?? 0
    }
}

struct FeedbackListResponse: Decodable {
    let items: [FeedbackItem]
    let unreadCount: Int
}

struct FeedbackItemResponse: Decodable {
    let item: FeedbackItem
}

struct CountResponse: Decodable {
    let count: Int
}

// MARK: - Branding

/// Admin › Settings › Branding and Remote Access (GET /api/branding).
struct Branding: Decodable, Equatable {
    var showLogo = true
    var showText = true
    /// An uploaded logo ("/uploads/branding/…"), or nil for the built-in one.
    var logoUrl: String?
    /// The server's public address, e.g. a Tailscale Funnel URL.
    var publicUrl: String?

    static let `default` = Branding()

    enum CodingKeys: String, CodingKey { case showLogo, showText, logoUrl, publicUrl }

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        showLogo = (try? c.decodeIfPresent(Bool.self, forKey: .showLogo)) ?? true
        showText = (try? c.decodeIfPresent(Bool.self, forKey: .showText)) ?? true
        logoUrl = c.lossyString(.logoUrl)
        publicUrl = c.lossyString(.publicUrl)
        if !showLogo && !showText { showText = true }
    }
}

// MARK: - Film and series requests (/api/requests)

struct RequestsConfig: Decodable {
    let open: Bool
    /// Films (Radarr) and series (Sonarr) can each be on or off.
    let films: Bool?
    let tv: Bool?
    let limit: Int?
    /// How often to refresh progress (Admin › Requests).
    let refreshSeconds: Double?
    /// For the Genre filter: film genres, and series genres.
    let genres: [GenreOption]?
    let tvGenres: [GenreOption]?
}

struct GenreOption: Decodable, Hashable, Identifiable {
    let id: Int
    let name: String
}

/// A film (or series) to choose on the Requests page (films already on the server are left out).
struct FilmResult: Decodable, Identifiable, Hashable {
    let tmdbId: Int
    let title: String
    let year: Int?
    let overview: String?
    let posterUrl: String?
    let rating: Double?
    var request: FilmRequestState?
    /// On a person's page: their character, or "Director".
    let role: String?
    /// "tv" for a series.
    let mediaType: String?
    /// A series already on Streamulus (its missing seasons can be asked for).
    let showId: Int?
    var id: Int { tmdbId }
    var isShow: Bool { mediaType == "tv" }
}

/// Someone has already asked for this film (or series / season).
struct FilmRequestState: Decodable, Hashable {
    let id: Int
    let status: String
    let label: String?
    let mine: Bool
    /// Series: "series" or "season", and which season.
    let scope: String?
    let season: Int?
}

/// A series' page on the Requests screen (/api/requests/show/:tmdbId).
struct ShowRequestDetail: Decodable {
    let tmdbId: Int
    let title: String
    let year: Int?
    let overview: String?
    let posterUrl: String?
    let backdropUrl: String?
    let rating: Double?
    let voteCount: Int?
    let request: FilmRequestState?
    let tagline: String?
    let firstAirDate: String?
    let lastAirDate: String?
    /// Returning Series, Ended, Canceled…
    let status: String?
    let genres: [String]
    let networks: [String]
    let certification: String?
    let numberOfSeasons: Int?
    let creators: [FilmCredit]
    let cast: [FilmCredit]
    let trailer: FilmTrailer?
    let onServer: ShowOnServer?
    let seasons: [ShowRequestSeason]
    let canRequestSeries: Bool

    var asResult: FilmResult {
        FilmResult(tmdbId: tmdbId, title: title, year: year, overview: overview, posterUrl: posterUrl, rating: rating, request: request,
                   role: nil, mediaType: "tv", showId: onServer?.showId)
    }
}

struct ShowOnServer: Decodable, Hashable {
    let showId: Int
    let episodes: Int
}

/// A season on a series' page: how much has aired, how much is on Streamulus, and whether it's asked for.
struct ShowRequestSeason: Decodable, Identifiable, Hashable {
    let season: Int
    let name: String
    let episodeCount: Int
    let aired: Int
    let onServer: Int
    let complete: Bool
    let airDate: String?
    let year: Int?
    let posterUrl: String?
    let request: FilmRequestState?
    let canRequest: Bool
    var id: Int { season }
}

struct ShowRequestResponse: Decodable { let show: ShowRequestDetail }

struct SeasonEpisodesResponse: Decodable {
    let season: Int
    let episodes: [SeasonRequestEpisode]
}

struct SeasonRequestEpisode: Decodable, Identifiable, Hashable {
    let episode: Int
    let title: String?
    let airDate: String?
    let aired: Bool
    let onServer: Bool
    var id: Int { episode }
}

/// A series request's checklist: every episode ready, downloading, moving in, not found, or not aired yet.
struct TVProgress: Decodable, Hashable {
    let total: Int
    let ready: Int
    let downloading: Int?
    let progress: Double?
    let seasons: [TVSeasonProgress]
}

struct TVSeasonProgress: Decodable, Hashable, Identifiable {
    let season: Int
    let total: Int?
    let ready: Int?
    let active: Int?
    let missing: Int?
    let unaired: Int?
    let progress: Double?
    let episodes: [TVEpisodeProgress]
    var id: Int { season }
}

struct TVEpisodeProgress: Decodable, Hashable, Identifiable {
    let episode: Int
    let title: String?
    let airDate: String?
    /// ready, downloading, importing, adding, searching, missing, failed, unaired
    let state: String
    let progress: Double?
    var id: Int { episode }
}

struct FilmSearchResponse: Decodable {
    let query: String?
    let results: [FilmResult]
}

/// A film's page on the Requests screen (/api/requests/film/:tmdbId).
struct FilmDetail: Decodable {
    let tmdbId: Int
    let title: String
    let year: Int?
    let overview: String?
    let posterUrl: String?
    let backdropUrl: String?
    let rating: Double?
    let voteCount: Int?
    /// The film on the server, if it's already here.
    let movieId: Int?
    let request: FilmRequestState?
    let originalTitle: String?
    let tagline: String?
    let releaseDate: String?
    let runtime: Int?
    let genres: [String]
    let certification: String?
    let directors: [FilmCredit]
    let cast: [FilmCredit]
    let trailer: FilmTrailer?
}

/// Someone in a film: id (for their page), name, and their character.
struct FilmCredit: Decodable, Hashable, Identifiable {
    let id: Int
    let name: String
    let character: String?
    let profileUrl: String?
}

struct FilmTrailer: Decodable, Hashable {
    let name: String?
    let url: String
}

struct FilmDetailResponse: Decodable { let film: FilmDetail }

/// An actor or director found by name.
struct PersonResult: Decodable, Hashable, Identifiable {
    let id: Int
    let name: String
    let department: String?
    let profileUrl: String?
    let knownFor: [String]
}

struct PeopleResponse: Decodable { let people: [PersonResult] }

struct PersonDetail: Decodable {
    let id: Int
    let name: String
    let department: String?
    let profileUrl: String?
    let biography: String?
    let birthday: String?
    let deathday: String?
    let placeOfBirth: String?
}

/// A person's page: their films that aren't on the server yet, and how many are.
struct PersonPageResponse: Decodable {
    let person: PersonDetail
    let films: [FilmResult]
    let onServer: Int
}

struct MovieRequest: Decodable, Identifiable, Hashable {
    let id: Int
    let tmdbId: Int
    let title: String
    let year: Int?
    let posterUrl: String?
    let status: String
    let label: String
    let detail: String?
    /// 0…1 while downloading.
    let progress: Double?
    /// When it should finish (ms since 1970).
    let eta: Double?
    /// Bytes per second, when Deluge reports it.
    let speed: Double?
    let declineReason: String?
    let decidedBy: String?
    /// The film on the server once it's ready.
    let movieId: Int?
    /// Series requests: "tv", the whole series or one season, the show once it's here, and the episode checklist.
    let mediaType: String?
    let scope: String?
    let season: Int?
    let showId: Int?
    let displayTitle: String?
    let tv: TVProgress?
    let createdAt: Double
    let mine: Bool?
    let requestedBy: String?
    let others: Int?

    static let active: Set<String> = ["pending", "searching", "waiting_release", "not_found", "downloading", "importing", "failed", "adding", "missing"]
    var isActive: Bool { Self.active.contains(status) }
    var isShow: Bool { mediaType == "tv" }
    var name: String { displayTitle ?? title }
}

struct MyRequestsResponse: Decodable { let requests: [MovieRequest] }

struct CreateRequestResponse: Decodable {
    let request: MovieRequest
    let joined: Bool?
    let already: Bool?
}

struct CancelRequestResponse: Decodable { let removed: Bool? }

struct MovieEnvelope: Decodable { let movie: Movie }
