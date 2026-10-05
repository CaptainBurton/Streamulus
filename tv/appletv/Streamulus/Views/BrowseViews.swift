import SwiftUI
import UIKit

struct MainTabView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @State private var selection: AppTab = .home

    enum AppTab: Hashable { case home, movies, shows, genres, profile }

    var body: some View {
        // On tvOS 26+ the system draws this tab bar as Liquid Glass. Each tab has a
        // fixed value so the selection can't be lost when a label changes.
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house.fill", value: AppTab.home) {
                NavigationStack { HomeView() }
            }
            Tab("Movies", systemImage: "film.fill", value: AppTab.movies) {
                NavigationStack { MovieGridView() }
            }
            Tab("TV Shows", systemImage: "tv.fill", value: AppTab.shows) {
                NavigationStack { ShowGridView() }
            }
            Tab("Genres", systemImage: "square.grid.2x2.fill", value: AppTab.genres) {
                NavigationStack { GenresView() }
            }
            // The profile tab shows the current profile's own picture — a still
            // one: swapping the icon to animate a GIF made the tab bar lose its
            // place (moving onto this tab jumped back to Genres).
            Tab(value: AppTab.profile) {
                NavigationStack { AccountView() }
            } label: {
                Label {
                    Text(session.profile?.name ?? "Profile")
                } icon: {
                    if let avatar = session.tabAvatar {
                        Image(uiImage: avatar).renderingMode(.original)
                    } else {
                        Image(systemName: "person.crop.circle.fill")
                    }
                }
            }
        }
        .fullScreenCover(item: $player.request) { request in
            PlayerView(request: request, session: session, onClose: { player.request = nil })
        }
    }
}

// MARK: - Home

/// Reload when the player closes (Continue Watching changed) or the profile —
/// or its English-titles setting — changes.
struct ReloadKey: Equatable {
    let playerClosed: Bool
    let profile: Profile?
}

struct HomeView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @State private var featured: Movie?
    @State private var featuredArt: FeaturedArt?
    @State private var loadedFor: Profile?
    @State private var rotateSeconds = 120
    @State private var heroFocused = false
    @State private var continueItems: [ContinueItem] = []
    @State private var movies: [Movie] = []
    @State private var shows: [Show] = []
    @State private var loaded = false
    @State private var errorText: String?

    var body: some View {
        ScrollViewReader { proxy in
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 30) {
                if let featured {
                    // Back up at its buttons: show the whole banner again, not just the buttons.
                    FeaturedHero(movie: featured, art: featuredArt, onFocus: {
                        withAnimation(.easeInOut(duration: 0.35)) { proxy.scrollTo("top", anchor: .top) }
                    }, onFocusChange: { heroFocused = $0 })
                    .id("top")
                } else if session.profile?.isKids == true {
                    Pill(text: "STREAMLINGS", color: Theme.streamling).padding(.horizontal, 80)
                }

                if !continueItems.isEmpty {
                    Shelf("Continue Watching") {
                        ForEach(continueItems) { item in
                            Button { resume(item) } label: {
                                WideCard(
                                    title: item.title,
                                    subtitle: item.subtitle,
                                    imageURLs: [
                                        session.stillURL(type: item.type, id: item.mediaId, at: item.position),
                                        session.imageURL(item.backdropPath),
                                        session.imageURL(item.posterPath),
                                    ].compactMap { $0 },
                                    progress: item.duration.map { Double(item.position) / Double(max($0, 1)) }
                                )
                            }
                            .buttonStyle(.card)
                        }
                    }
                }

                if !movies.isEmpty {
                    Shelf("Recently Added Movies") {
                        ForEach(movies) { movie in
                            PosterLink(value: movie, title: movie.title, subtitle: movie.year.map { String($0) }, imageURL: session.imageURL(movie.posterPath))
                        }
                    }
                }

                if !shows.isEmpty {
                    Shelf("Recently Added Shows") {
                        ForEach(shows) { show in
                            PosterLink(value: show, title: show.title, subtitle: show.year, imageURL: session.imageURL(show.posterPath))
                        }
                    }
                }

                if loaded && featured == nil && continueItems.isEmpty && movies.isEmpty && shows.isEmpty {
                    Text(errorText ?? "Nothing here yet — add a library in Streamulus on the web.")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 200)
                }
            }
            .padding(.bottom, 60)
        }
        .scrollIndicators(.hidden)
        // Edge to edge, so the banner artwork fills the screen; rows keep their own 80 pt margin.
        .contentMargins(.horizontal, 0, for: .scrollContent)
        .ignoresSafeArea(edges: [.top, .horizontal])
        }
        .mediaDestinations()
        // Reload when the player closes so Continue Watching is up to date.
        .task(id: ReloadKey(playerClosed: player.request == nil, profile: session.profile)) {
            guard player.request == nil else { return }
            // Another profile, or English titles switched: pick a new featured movie too.
            if loadedFor != session.profile {
                if loadedFor != nil { featured = nil; featuredArt = nil }
                loadedFor = session.profile
            }
            await load()
        }
        // Switch the banner every `rotateSeconds`, but not while its buttons are
        // focused (it shouldn't change under a click) or a video is playing.
        .task(id: RotationKey(movieId: featured?.id, paused: heroFocused || player.request != nil, seconds: rotateSeconds)) {
            guard let current = featured?.id, !heroFocused, player.request == nil else { return }
            try? await Task.sleep(nanoseconds: UInt64(rotateSeconds) * 1_000_000_000)
            guard !Task.isCancelled else { return }
            await rotateFeatured(excluding: current)
        }
    }

    private struct RotationKey: Equatable {
        let movieId: Int?
        let paused: Bool
        let seconds: Int
    }

    private func rotateFeatured(excluding current: Int) async {
        let response = try? await session.get("/api/movies/featured", query: [URLQueryItem(name: "exclude", value: String(current))], as: FeaturedResponse.self)
        guard let response, !Task.isCancelled else { return }
        if let seconds = response.rotateSeconds, seconds > 0 { rotateSeconds = seconds }
        guard let next = response.movie, next.id != current else { return }
        // Artwork and logo fully loaded first, so the crossfade is one smooth move
        // with nothing popping in halfway through.
        let art = await FeaturedArt.load(for: next, session: session)
        guard !Task.isCancelled else { return }
        withAnimation(.easeInOut(duration: 1.0)) {
            featured = next
            featuredArt = art
        }
    }

    private func load() async {
        // Each row on its own, so one failed request doesn't empty the others.
        async let cont = Self.fetch { try await session.get("/api/stream/continue-watching", as: ContinueResponse.self).items }
        async let recentMovies = Self.fetch { try await session.get("/api/movies/recent", as: MoviesResponse.self).movies }
        async let recentShows = Self.fetch { try await session.get("/api/tv/recent", as: ShowsResponse.self).shows }
        let results = (await cont, await recentMovies, await recentShows)
        if case .success(let items) = results.0 { continueItems = items }
        if case .success(let items) = results.1 { movies = items }
        if case .success(let items) = results.2 { shows = items }
        let failures = [Self.error(in: results.0), Self.error(in: results.1), Self.error(in: results.2)].compactMap { $0 }
        errorText = failures.first?.localizedDescription
        // The first featured movie; after that it changes on its own timer.
        if featured == nil {
            let response = try? await session.get("/api/movies/featured", as: FeaturedResponse.self)
            if let movie = response?.movie {
                featuredArt = await FeaturedArt.load(for: movie, session: session)
                featured = movie
            }
            if let seconds = response?.rotateSeconds, seconds > 0 { rotateSeconds = seconds }
        }
        loaded = true
    }

    private static func fetch<T>(_ request: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await request()) } catch { return .failure(error) }
    }

    private static func error<T>(in result: Result<T, Error>) -> Error? {
        if case .failure(let error) = result { return error }
        return nil
    }

    private func resume(_ item: ContinueItem) {
        let type: MediaType = item.type == "movie" ? .movie : .episode
        player.play(type, id: item.mediaId, from: item.position, title: item.title, subtitle: item.subtitle)
    }
}

/// The featured movie's backdrop and title logo, downloaded and decoded ahead of
/// time so a rotation can crossfade straight to them.
struct FeaturedArt {
    let movieId: Int
    let backdrop: UIImage?
    let logo: UIImage?

    @MainActor
    static func load(for movie: Movie, session: Session) async -> FeaturedArt {
        let backdropURL = session.imageURL(movie.backdropPath ?? movie.posterPath)
        let logoURL = session.imageURL(movie.logoPath)
        async let backdrop = image(backdropURL)
        async let logo = image(logoURL)
        return FeaturedArt(movieId: movie.id, backdrop: await backdrop, logo: await logo)
    }

    private static func image(_ url: URL?) async -> UIImage? {
        guard let url else { return nil }
        let result = try? await URLSession.shared.data(from: url)
        guard let result, let image = UIImage(data: result.0) else { return nil }
        // Decode now rather than on the first frame of the fade.
        return await image.byPreparingForDisplay() ?? image
    }
}

/// Netflix-style banner at the top of Home: artwork, title logo, Play Now and More Info.
struct FeaturedHero: View {
    let movie: Movie
    /// Preloaded artwork for `movie` (used only if it's for this movie).
    var art: FeaturedArt? = nil
    /// Called when focus comes to the banner's buttons.
    var onFocus: () -> Void = {}
    /// Whether one of the banner's buttons has focus.
    var onFocusChange: (Bool) -> Void = { _ in }
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @FocusState private var buttonFocus: Int?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            // When the movie changes: the new artwork fades in over the old (which
            // only goes once it's covered, so there's no dip to black), while the
            // old title/text fades out and the new fades in just after. The buttons
            // stay put so focus isn't knocked off them.
            ZStack {
                backdrop
                    .containerRelativeFrame(.horizontal)
                    .frame(height: Self.height)
                    .clipped()
                    .id(movie.id)
                    .transition(.asymmetric(
                        insertion: .opacity.animation(.easeInOut(duration: 1.0)),
                        removal: .opacity.animation(.easeInOut(duration: 0.4).delay(1.0))
                    ))
            }
            // The full visible width of Home's scroll view (the whole screen): the
            // scroll content can still be inset by the TV's side margin, which left
            // a black strip down the right of the artwork.
            .containerRelativeFrame(.horizontal)
            .frame(height: Self.height)
            .clipped()
            .overlay(LinearGradient(colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.3), .clear],
                                    startPoint: .leading, endPoint: .trailing))
            .overlay(LinearGradient(colors: [.clear, Theme.background], startPoint: .center, endPoint: .bottom))

            VStack(alignment: .leading, spacing: 22) {
                ZStack(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 22) {
                        logo
                        HStack(spacing: 18) {
                            if let year = movie.year { Text(String(year)) }
                            if let duration = movie.duration, duration > 0 { Text(Fmt.runtime(duration)) }
                            if let rating = movie.contentRating { Pill(text: rating) }
                        }
                        .foregroundStyle(.secondary)
                        if let overview = movie.overview, !overview.isEmpty {
                            Text(overview).lineLimit(3).frame(maxWidth: 1000, alignment: .leading)
                        }
                    }
                    .id(movie.id)
                    .transition(.asymmetric(
                        insertion: .opacity.animation(.easeInOut(duration: 0.6).delay(0.45)),
                        removal: .opacity.animation(.easeOut(duration: 0.35))
                    ))
                }
                GlassEffectContainer(spacing: 30) {
                    HStack(spacing: 30) {
                        Button {
                            Task { await playNow() }
                        } label: {
                            Label("Play Now", systemImage: "play.fill")
                        }
                        .buttonStyle(ActionButtonStyle(prominent: true))
                        .focused($buttonFocus, equals: 0)

                        NavigationLink(value: movie) {
                            Label("More Info", systemImage: "info.circle")
                        }
                        .buttonStyle(ActionButtonStyle())
                        .focused($buttonFocus, equals: 1)
                    }
                }
                // Reachable with "up" from any Continue Watching card, not only the first.
                .focusSection()
                .defaultFocus($buttonFocus, 0)
                .onChange(of: buttonFocus) { old, new in
                    if (old == nil) != (new == nil) { onFocusChange(new != nil) }
                    // Coming in from the tab bar or the rows below always lands on
                    // Play Now (tvOS would pick whichever button is nearest).
                    guard old == nil, let new else { return }
                    if new != 0 { buttonFocus = 0 }
                    onFocus()
                }
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 16)
        }
        .containerRelativeFrame(.horizontal, alignment: .leading)
        .frame(height: Self.height)
    }

    private var matchingArt: FeaturedArt? { art?.movieId == movie.id ? art : nil }

    @ViewBuilder private var backdrop: some View {
        if let image = matchingArt?.backdrop {
            Image(uiImage: image).resizable().scaledToFill()
        } else {
            RemoteImage(url: session.imageURL(movie.backdropPath ?? movie.posterPath))
        }
    }

    @ViewBuilder private var logo: some View {
        if let image = matchingArt?.logo {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .frame(maxWidth: 760, maxHeight: 190, alignment: .leading)
                .shadow(color: .black.opacity(0.6), radius: 16)
                .accessibilityLabel(movie.title)
        } else {
            // Preloaded with no logo → the title as text; not preloaded → load it here.
            TitleLogoView(url: matchingArt == nil ? session.imageURL(movie.logoPath) : nil,
                          title: movie.title, maxWidth: 760, maxHeight: 190, fontSize: 72)
        }
    }

    /// Nearly the whole screen, so the text and buttons sit low and the artwork
    /// shows above them; the Continue Watching title peeks in underneath.
    static let height: CGFloat = 1030

    /// Resume if it's part watched, otherwise start from the beginning.
    private func playNow() async {
        let progress = try? await session.get("/api/stream/progress/movie/\(movie.id)", as: WatchProgress.self)
        let start = progress.map { !$0.completed && $0.position > 10 ? $0.position : 0 } ?? 0
        player.play(.movie, id: movie.id, from: start, title: movie.title)
    }
}

// MARK: - Library grids

struct MovieGridView: View {
    @EnvironmentObject private var session: Session
    @State private var movies: [Movie] = []
    @State private var loading = true
    @State private var errorText: String?

    var body: some View {
        LibraryGrid(
            items: movies,
            title: { $0.title },
            subtitle: { $0.year.map { String($0) } },
            imageURL: { session.imageURL($0.posterPath) },
            progress: { movie in
                guard movie.watchPosition > 10, !movie.watchCompleted, let duration = movie.duration, duration > 0 else { return nil }
                return Double(movie.watchPosition) / Double(duration)
            }
        )
        .overlay {
            if loading {
                ProgressView()
            } else if let errorText {
                Text(errorText).foregroundStyle(.secondary)
            } else if movies.isEmpty {
                Text("No movies yet").foregroundStyle(.secondary)
            }
        }
        .mediaDestinations()
        .task(id: session.profile) { // reload after switching profile or English titles
            do {
                let response: MoviesResponse = try await session.get("/api/movies", query: [
                    URLQueryItem(name: "sort", value: "title"),
                    URLQueryItem(name: "order", value: "ASC"),
                    URLQueryItem(name: "limit", value: "5000"),
                ])
                movies = response.movies
            } catch {
                errorText = error.localizedDescription
            }
            loading = false
        }
    }
}

struct ShowGridView: View {
    @EnvironmentObject private var session: Session
    @State private var shows: [Show] = []
    @State private var loading = true
    @State private var errorText: String?

    var body: some View {
        LibraryGrid(
            items: shows,
            title: { $0.title },
            subtitle: { show in
                show.totalEpisodes > 0 && show.watchedEpisodes >= show.totalEpisodes ? "Watched" : show.year
            },
            imageURL: { session.imageURL($0.posterPath) },
            progress: { _ in nil }
        )
        .overlay {
            if loading {
                ProgressView()
            } else if let errorText {
                Text(errorText).foregroundStyle(.secondary)
            } else if shows.isEmpty {
                Text("No TV shows yet").foregroundStyle(.secondary)
            }
        }
        .mediaDestinations()
        .task(id: session.profile) { // reload after switching profile or English titles
            do {
                let response: ShowsResponse = try await session.get("/api/tv", query: [
                    URLQueryItem(name: "sort", value: "title"),
                    URLQueryItem(name: "order", value: "ASC"),
                    URLQueryItem(name: "limit", value: "5000"),
                ])
                shows = response.shows
            } catch {
                errorText = error.localizedDescription
            }
            loading = false
        }
    }
}

/// A–Z library grid: 6 posters per row, grouped under letters, with an
/// alphabet rail on the right to jump around and a big letter while scrolling.
struct LibraryGrid<Item: Identifiable & Hashable>: View where Item.ID == Int {
    let items: [Item]
    let title: (Item) -> String
    let subtitle: (Item) -> String?
    let imageURL: (Item) -> URL?
    let progress: (Item) -> Double?
    /// Shown above the grid, scrolling with it (e.g. a genre's filter chips).
    var header: AnyView? = nil

    @State private var currentLetter: String?
    @State private var bubbleVisible = false
    @State private var bubbleTask: Task<Void, Never>?
    /// Artwork of the highlighted title, shown blurred behind the grid.
    @State private var backgroundArt: URL?
    @State private var artTask: Task<Void, Never>?

    /// Posters per row, across the full screen width.
    /// (Computed: generic types can't have stored static properties.)
    private static var postersPerRow: Int { 6 }
    private static var spacing: CGFloat { 40 }
    private static var leadingMargin: CGFloat { 80 }
    /// Room on the right for the A–Z rail.
    private static var railSpace: CGFloat { 140 }

    /// Poster width that fills the screen, worked out from the real width.
    /// (Flexible columns came out tiny and centred, with wide empty sides.)
    private static func posterWidth(for screenWidth: CGFloat) -> CGFloat {
        let n = CGFloat(postersPerRow)
        let available = screenWidth - leadingMargin - railSpace - spacing * (n - 1)
        return max(150, (available / n).rounded(.down))
    }

    struct LetterGroup: Identifiable {
        let letter: String
        var items: [Item]
        var id: String { letter }
    }

    /// Sorted by title ignoring "The", "A", "An", grouped by first letter.
    private var sections: [LetterGroup] {
        // Group by letter first, so each letter appears once ("#" first, then A–Z)
        // whatever order the sort puts accented or punctuated titles in.
        var byLetter: [String: [Item]] = [:]
        for item in items { byLetter[Self.indexLetter(title(item)), default: []].append(item) }
        return byLetter.keys
            .sorted { $0 == "#" ? $1 != "#" : ($1 == "#" ? false : $0 < $1) }
            .map { letter in
                let sorted = byLetter[letter, default: []].sorted {
                    Self.sortKey(title($0)).localizedCaseInsensitiveCompare(Self.sortKey(title($1))) == .orderedAscending
                }
                return LetterGroup(letter: letter, items: sorted)
            }
    }

    static func sortKey(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        for article in ["The ", "A ", "An "] where trimmed.count > article.count && trimmed.hasPrefix(article) {
            return String(trimmed.dropFirst(article.count))
        }
        return trimmed
    }

    /// "Élite" → E, "'Salem's Lot" → S, "2 Fast 2 Furious" → #.
    static func indexLetter(_ title: String) -> String {
        let folded = sortKey(title).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US"))
        let start = folded.drop { !$0.isLetter && !$0.isNumber }
        guard let first = start.uppercased().first, first.isASCII, first.isLetter else { return "#" }
        return String(first)
    }

    var body: some View {
        let groups = sections
        GeometryReader { geo in
            let width = Self.posterWidth(for: geo.size.width)
            let columns = Array(repeating: GridItem(.fixed(width), spacing: Self.spacing, alignment: .top), count: Self.postersPerRow)
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    // Inside the scroll content, not above the scroll view: the grid
                    // draws outside its bounds (so focused posters can grow) and
                    // would slide over anything placed above it.
                    if let header {
                        header
                            .frame(width: geo.size.width, alignment: .leading)
                            .focusSection()
                    }
                    LazyVGrid(columns: columns, alignment: .leading, spacing: 50) {
                        ForEach(groups) { group in
                            Section {
                                ForEach(group.items) { item in
                                    GridPoster(
                                        value: item,
                                        title: title(item),
                                        subtitle: subtitle(item),
                                        imageURL: imageURL(item),
                                        progress: progress(item),
                                        width: width,
                                        onFocus: {
                                            focusMoved(to: group.letter)
                                            showArt(imageURL(item))
                                        }
                                    )
                                }
                            } header: {
                                Text(group.letter)
                                    .font(.title3.weight(.heavy))
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.top, 10)
                                    .id("letter-\(group.letter)")
                            }
                        }
                    }
                    .padding(.leading, Self.leadingMargin)
                    .padding(.vertical, 40)
                    .frame(width: geo.size.width, alignment: .leading)
                }
                // Our own A–Z rail and letter bubble replace the scroll dots.
                .scrollIndicators(.hidden)
                .scrollClipDisabled()
                .frame(width: geo.size.width, height: geo.size.height)
                .overlay(alignment: .trailing) {
                    if groups.count > 1 {
                        AlphabetRail(letters: groups.map { $0.letter }, current: currentLetter) { letter in
                            currentLetter = letter
                            withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo("letter-\(letter)", anchor: .top) }
                            flashBubble()
                        }
                        .padding(.trailing, 40)
                        .focusSection() // "right" from any row reaches the rail
                    }
                }
                .overlay {
                    if bubbleVisible, let currentLetter {
                        Text(currentLetter)
                            .font(.system(size: 120, weight: .heavy))
                            .frame(width: 220, height: 220)
                            .glassEffect(.regular, in: .rect(cornerRadius: 44))
                            .transition(.opacity.combined(with: .scale(scale: 0.9)))
                    }
                }
                .animation(.easeOut(duration: 0.2), value: bubbleVisible)
            }
        }
        // The whole screen width; tvOS otherwise keeps ~80 pt in from each side.
        .ignoresSafeArea(edges: .horizontal)
        .background(BlurredArtBackground(url: backgroundArt))
    }

    /// Change the background once focus settles, not for every poster flown past.
    private func showArt(_ url: URL?) {
        artTask?.cancel()
        artTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if !Task.isCancelled { backgroundArt = url }
        }
    }

    private func focusMoved(to letter: String) {
        guard letter != currentLetter else { return }
        let first = currentLetter == nil
        currentLetter = letter
        if !first { flashBubble() }
    }

    /// Show the big letter for a moment, like the tvOS index while scrolling.
    private func flashBubble() {
        bubbleVisible = true
        bubbleTask?.cancel()
        bubbleTask = Task {
            try? await Task.sleep(nanoseconds: 900_000_000)
            if !Task.isCancelled { bubbleVisible = false }
        }
    }
}

/// Vertical A–Z (and #) index on the right of the library grids.
struct AlphabetRail: View {
    let letters: [String]
    let current: String?
    let onSelect: (String) -> Void

    var body: some View {
        VStack(spacing: 2) {
            ForEach(letters, id: \.self) { letter in
                Button(letter) { onSelect(letter) }
                    .buttonStyle(RailButtonStyle(isCurrent: letter == current))
            }
        }
        .padding(.vertical, 12)
        .padding(.horizontal, 6)
        .glassEffect(.regular, in: .capsule)
    }
}

struct RailButtonStyle: ButtonStyle {
    let isCurrent: Bool

    func makeBody(configuration: Configuration) -> some View {
        RailLetterLabel(configuration: configuration, isCurrent: isCurrent)
    }
}

private struct RailLetterLabel: View {
    let configuration: ButtonStyleConfiguration
    let isCurrent: Bool
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        configuration.label
            .font(.system(size: 20, weight: isFocused || isCurrent ? .heavy : .semibold))
            .foregroundStyle(isFocused ? Color.black : (isCurrent ? Theme.accent : Color.white.opacity(0.7)))
            .frame(width: 44, height: 30)
            .background(isFocused ? Color.white : Color.clear, in: Capsule())
            .scaleEffect(isFocused ? 1.25 : 1)
            .animation(.easeOut(duration: 0.12), value: isFocused)
    }
}

// MARK: - Profile tab

struct AccountView: View {
    @EnvironmentObject private var session: Session
    @State private var savingEnglish = false

    /// e.g. "1.1 (2)" — shows which build is installed on the TV.
    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "\(version) (\(build))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 44) {
            if let profile = session.profile {
                HStack(spacing: 40) {
                    ProfileAvatar(profile: profile, size: 180)
                    VStack(alignment: .leading, spacing: 10) {
                        Text(profile.name).font(.title)
                        if profile.isKids {
                            Text("STREAMLING").font(.headline).foregroundStyle(Theme.streamling)
                        }
                        if let user = session.user {
                            Text("Signed in as \(user.username)").foregroundStyle(.secondary)
                        }
                    }
                }
            }

            GlassEffectContainer(spacing: 40) {
                HStack(spacing: 40) {
                    Button { session.switchProfile() } label: {
                        Label("Switch Profile", systemImage: "person.2.fill")
                    }
                    .buttonStyle(ActionButtonStyle(prominent: true))
                    Button { session.signOut() } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .buttonStyle(ActionButtonStyle())
                    Button { session.changeServer() } label: {
                        Label("Change Server", systemImage: "server.rack")
                    }
                    .buttonStyle(ActionButtonStyle())
                }
            }

            // Per profile; also on the web under Profile & Account → Language.
            Button {
                Task {
                    savingEnglish = true
                    try? await session.setEnglishTitles(!(session.profile?.englishTitles ?? false))
                    savingEnglish = false
                }
            } label: {
                Label(session.profile?.englishTitles == true ? "Titles in English: On" : "Titles in English: Off",
                      systemImage: "character.bubble")
            }
            .buttonStyle(ActionButtonStyle(prominent: session.profile?.englishTitles == true))
            .disabled(savingEnglish)

            VStack(alignment: .leading, spacing: 8) {
                Text("Server: \(session.serverURL?.absoluteString ?? "")")
                Text("App version \(Self.appVersion)")
                Text("To sign in another TV or browser without a password, choose Quick Login on it, then approve the code from Streamulus on your phone or computer.")
            }
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(maxWidth: 1300, alignment: .leading)

            Spacer()
        }
        .padding(80)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
