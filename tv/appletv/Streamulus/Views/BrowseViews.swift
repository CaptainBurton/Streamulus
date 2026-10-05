import SwiftUI

struct MainTabView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter

    var body: some View {
        // On tvOS 26+ the system draws this tab bar as Liquid Glass.
        TabView {
            Tab("Home", systemImage: "house.fill") {
                NavigationStack { HomeView() }
            }
            Tab("Movies", systemImage: "film.fill") {
                NavigationStack { MovieGridView() }
            }
            Tab("TV Shows", systemImage: "tv.fill") {
                NavigationStack { ShowGridView() }
            }
            // The profile tab shows the current profile's own picture.
            Tab {
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

struct HomeView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @State private var featured: Movie?
    @State private var continueItems: [ContinueItem] = []
    @State private var movies: [Movie] = []
    @State private var shows: [Show] = []
    @State private var loaded = false
    @State private var errorText: String?

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 30) {
                if let featured {
                    FeaturedHero(movie: featured)
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
        .ignoresSafeArea(edges: .top)
        .mediaDestinations()
        // Reload when the player closes so Continue Watching is up to date.
        .task(id: player.request == nil) {
            if player.request == nil { await load() }
        }
    }

    private func load() async {
        do {
            async let cont = session.get("/api/stream/continue-watching", as: ContinueResponse.self)
            async let recentMovies = session.get("/api/movies/recent", as: MoviesResponse.self)
            async let recentShows = session.get("/api/tv/recent", as: ShowsResponse.self)
            continueItems = try await cont.items
            movies = try await recentMovies.movies
            shows = try await recentShows.shows
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        // A new featured movie only on first load, so it doesn't change under the user.
        if featured == nil {
            let response = try? await session.get("/api/movies/featured", as: FeaturedResponse.self)
            featured = response?.movie
        }
        loaded = true
    }

    private func resume(_ item: ContinueItem) {
        let type: MediaType = item.type == "movie" ? .movie : .episode
        player.play(type, id: item.mediaId, from: item.position, title: item.title, subtitle: item.subtitle)
    }
}

/// Netflix-style banner at the top of Home: artwork, title logo, Play Now and More Info.
struct FeaturedHero: View {
    let movie: Movie
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            RemoteImage(url: session.imageURL(movie.backdropPath ?? movie.posterPath))
                .frame(height: 880)
                .frame(maxWidth: .infinity)
                .clipped()
                .overlay(LinearGradient(colors: [Theme.background.opacity(0.95), Theme.background.opacity(0.3), .clear],
                                        startPoint: .leading, endPoint: .trailing))
                .overlay(LinearGradient(colors: [.clear, Theme.background], startPoint: .center, endPoint: .bottom))

            VStack(alignment: .leading, spacing: 22) {
                TitleLogoView(url: session.imageURL(movie.logoPath), title: movie.title, maxWidth: 760, maxHeight: 220, fontSize: 72)
                HStack(spacing: 18) {
                    if let year = movie.year { Text(String(year)) }
                    if let duration = movie.duration, duration > 0 { Text(Fmt.runtime(duration)) }
                    if let rating = movie.contentRating { Pill(text: rating) }
                }
                .foregroundStyle(.secondary)
                if let overview = movie.overview, !overview.isEmpty {
                    Text(overview).lineLimit(3).frame(maxWidth: 1000, alignment: .leading)
                }
                GlassEffectContainer(spacing: 30) {
                    HStack(spacing: 30) {
                        Button {
                            Task { await playNow() }
                        } label: {
                            Label("Play Now", systemImage: "play.fill")
                        }
                        .buttonStyle(.glassProminent)

                        NavigationLink(value: movie) {
                            Label("More Info", systemImage: "info.circle")
                        }
                        .buttonStyle(.glass)
                    }
                }
            }
            .padding(.horizontal, 80)
            .padding(.bottom, 40)
        }
        .frame(height: 880)
    }

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
        .task {
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
        .task {
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

/// A–Z library grid: 7 posters per row, grouped under letters, with an
/// alphabet rail on the right to jump around and a big letter while scrolling.
struct LibraryGrid<Item: Identifiable & Hashable>: View where Item.ID == Int {
    let items: [Item]
    let title: (Item) -> String
    let subtitle: (Item) -> String?
    let imageURL: (Item) -> URL?
    let progress: (Item) -> Double?

    @State private var currentLetter: String?
    @State private var bubbleVisible = false
    @State private var bubbleTask: Task<Void, Never>?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 40, alignment: .top), count: 7)

    struct LetterGroup: Identifiable {
        let letter: String
        var items: [Item]
        var id: String { letter }
    }

    /// Sorted by title ignoring "The", "A", "An", grouped by first letter.
    private var sections: [LetterGroup] {
        let sorted = items.sorted {
            Self.sortKey(title($0)).localizedCaseInsensitiveCompare(Self.sortKey(title($1))) == .orderedAscending
        }
        var result: [LetterGroup] = []
        for item in sorted {
            let letter = Self.indexLetter(title(item))
            if let last = result.last, last.letter == letter {
                result[result.count - 1].items.append(item)
            } else {
                result.append(LetterGroup(letter: letter, items: [item]))
            }
        }
        return result
    }

    static func sortKey(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        for article in ["The ", "A ", "An "] where trimmed.count > article.count && trimmed.hasPrefix(article) {
            return String(trimmed.dropFirst(article.count))
        }
        return trimmed
    }

    static func indexLetter(_ title: String) -> String {
        guard let first = sortKey(title).uppercased().first, first.isASCII, first.isLetter else { return "#" }
        return String(first)
    }

    var body: some View {
        let groups = sections
        ScrollViewReader { proxy in
            HStack(alignment: .center, spacing: 10) {
                ScrollView(.vertical) {
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
                                        onFocus: { focusMoved(to: group.letter) }
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
                    .padding(.leading, 80)
                    .padding(.trailing, 20)
                    .padding(.vertical, 40)
                }
                // Our own A–Z rail and letter bubble replace the scroll dots.
                .scrollIndicators(.hidden)

                if groups.count > 1 {
                    AlphabetRail(letters: groups.map { $0.letter }, current: currentLetter) { letter in
                        currentLetter = letter
                        withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo("letter-\(letter)", anchor: .top) }
                        flashBubble()
                    }
                    .padding(.trailing, 30)
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
                    .buttonStyle(.glassProminent)
                    Button { session.signOut() } label: {
                        Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                    .buttonStyle(.glass)
                    Button { session.changeServer() } label: {
                        Label("Change Server", systemImage: "server.rack")
                    }
                    .buttonStyle(.glass)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Server: \(session.serverURL?.absoluteString ?? "")")
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
