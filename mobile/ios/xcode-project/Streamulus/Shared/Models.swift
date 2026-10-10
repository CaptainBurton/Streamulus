// Copied from shared/apple/StreamulusCore/Models.swift by generate_project.rb.
// Edit the original there, then run generate_project.rb for both apps.

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

    enum CodingKeys: String, CodingKey {
        case id, name, requires
        case englishTitles = "english_titles"
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
    }
}

struct LoginResponse: Decodable {
    let token: String
    let user: User
    let profile: Profile
    let profileCount: Int
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
