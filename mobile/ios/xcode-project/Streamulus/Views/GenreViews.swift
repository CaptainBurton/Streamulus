import SwiftUI

/// Opens a genre's page from the Genres tab.
struct GenreRef: Hashable {
    let name: String
}

/// Genre tiles: the admin's image or a random title's banner art.
struct GenresView: View {
    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var genres: [GenreSummary] = []
    @State private var loading = true
    @State private var errorText: String?

    var body: some View {
        let m = Metrics(sizeClass)
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: m.genreTileMinimum), spacing: 14)], spacing: 14) {
                ForEach(genres) { genre in
                    NavigationLink(value: GenreRef(name: genre.name)) {
                        GenreTile(genre: genre)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, m.margin)
            .padding(.bottom, 24)
        }
        .background(Theme.background)
        .overlay { LibraryStatus(loading: loading, errorText: errorText, isEmpty: genres.isEmpty, emptyText: "No genres yet") }
        .navigationTitle("Genres")
        .accountButton()
        .navigationDestination(for: GenreRef.self) { GenreDetailView(name: $0.name) }
        .mediaDestinations()
        .refreshable { await load() }
        .task(id: session.profile) { await load() }
    }

    private func load() async {
        do {
            genres = try await session.get("/api/genres", as: GenresResponse.self).genres
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        loading = false
    }
}

/// 16:9 tile with the genre's name over a gradient. Sized only by its column —
/// the artwork fills and is cropped.
struct GenreTile: View {
    let genre: GenreSummary
    @EnvironmentObject private var session: Session

    private var counts: String {
        [
            genre.movieCount > 0 ? "\(genre.movieCount) movie\(genre.movieCount == 1 ? "" : "s")" : nil,
            genre.showCount > 0 ? "\(genre.showCount) show\(genre.showCount == 1 ? "" : "s")" : nil,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        Color.clear
            .aspectRatio(16.0 / 9.0, contentMode: .fit)
            .background(LinearGradient(colors: [Color(red: 0.1, green: 0.16, blue: 0.23), Color(red: 0.16, green: 0.1, blue: 0.23)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay { RemoteImage(url: session.imageURL(genre.imageURL)) }
            .overlay { LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom) }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(genre.name).font(.headline.weight(.heavy)).lineLimit(1).minimumScaleFactor(0.7)
                    if !counts.isEmpty { Text(counts).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
                }
                .shadow(color: .black.opacity(0.6), radius: 6)
                .padding(12)
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

/// A genre's titles with an All / Movies / TV Shows switch above the A–Z grid.
struct GenreDetailView: View {
    let name: String
    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var movies: [Movie] = []
    @State private var shows: [Show] = []
    @State private var filter: Filter = .all
    @State private var loading = true
    @State private var errorText: String?

    enum Filter: String, CaseIterable, Identifiable {
        case all = "All", movies = "Movies", shows = "TV Shows"
        var id: String { rawValue }
    }

    private var items: [GenreItem] {
        (filter == .shows ? [] : movies.map(GenreItem.movie)) + (filter == .movies ? [] : shows.map(GenreItem.show))
    }

    private func count(_ filter: Filter) -> Int {
        switch filter {
        case .all: return movies.count + shows.count
        case .movies: return movies.count
        case .shows: return shows.count
        }
    }

    var body: some View {
        LibraryGrid(
            items: items,
            title: { item in
                switch item {
                case .movie(let movie): return movie.title
                case .show(let show): return show.title
                }
            },
            subtitle: { item in
                switch item {
                case .movie(let movie): return ["Movie", movie.year.map { String($0) }].compactMap { $0 }.joined(separator: " · ")
                case .show(let show): return ["TV Show", show.year].compactMap { $0 }.joined(separator: " · ")
                }
            },
            imageURL: { item in
                switch item {
                case .movie(let movie): return session.imageURL(movie.posterPath)
                case .show(let show): return session.imageURL(show.posterPath)
                }
            },
            header: AnyView(
                Picker("Show", selection: $filter) {
                    ForEach(Filter.allCases) { option in
                        Text("\(option.rawValue) (\(count(option)))").tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, Metrics(sizeClass).margin)
                .padding(.vertical, 8)
            )
        )
        .overlay { LibraryStatus(loading: loading, errorText: errorText, isEmpty: movies.isEmpty && shows.isEmpty, emptyText: "Nothing in \(name)") }
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: GenreItem.self) { item in
            switch item {
            case .movie(let movie): MovieDetailView(movie: movie)
            case .show(let show): ShowDetailView(show: show)
            }
        }
        .task(id: session.profile) {
            do {
                // Plain name: the request builder percent-encodes the path itself.
                let response = try await session.get("/api/genres/\(name)", as: GenreDetailResponse.self)
                movies = response.movies
                shows = response.shows
                errorText = nil
            } catch {
                errorText = error.localizedDescription
            }
            loading = false
        }
    }
}

/// The search tab: movies and shows by title (English titles too).
struct SearchView: View {
    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var query = ""
    @State private var movies: [Movie] = []
    @State private var shows: [Show] = []
    @State private var searching = false

    var body: some View {
        let m = Metrics(sizeClass)
        let text = query.trimmingCharacters(in: .whitespaces)
        ScrollView {
            if text.isEmpty {
                ContentUnavailableView("Search Streamulus", systemImage: "magnifyingglass",
                                       description: Text("Find movies and TV shows by title."))
                    .padding(.top, 80)
            } else if movies.isEmpty && shows.isEmpty && !searching {
                ContentUnavailableView.search(text: text).padding(.top, 80)
            } else {
                VStack(alignment: .leading, spacing: 22) {
                    if !movies.isEmpty { results("Movies", movies.map(GenreItem.movie), m) }
                    if !shows.isEmpty { results("TV Shows", shows.map(GenreItem.show), m) }
                }
                .padding(.bottom, 24)
            }
        }
        .background(Theme.background)
        .navigationTitle("Search")
        .searchable(text: $query, prompt: "Movies and TV shows")
        .accountButton()
        .navigationDestination(for: GenreItem.self) { item in
            switch item {
            case .movie(let movie): MovieDetailView(movie: movie)
            case .show(let show): ShowDetailView(show: show)
            }
        }
        .mediaDestinations()
        .task(id: text) {
            guard !text.isEmpty else { movies = []; shows = []; return }
            try? await Task.sleep(nanoseconds: 300_000_000) // wait until typing pauses
            guard !Task.isCancelled else { return }
            searching = true
            let search = [URLQueryItem(name: "search", value: text), URLQueryItem(name: "limit", value: "60")]
            async let foundMovies = session.get("/api/movies", query: search, as: MoviesResponse.self)
            async let foundShows = session.get("/api/tv", query: search, as: ShowsResponse.self)
            let movieResults = try? await foundMovies
            let showResults = try? await foundShows
            guard !Task.isCancelled else { return }
            movies = movieResults?.movies ?? []
            shows = showResults?.shows ?? []
            searching = false
        }
    }

    private func results(_ title: String, _ items: [GenreItem], _ m: Metrics) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.title3.weight(.bold)).padding(.horizontal, m.margin)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: m.gridMinimum), spacing: 12, alignment: .top)], alignment: .leading, spacing: 16) {
                ForEach(items) { item in
                    switch item {
                    case .movie(let movie):
                        PosterCard(value: item, title: movie.title, subtitle: movie.year.map { String($0) }, imageURL: session.imageURL(movie.posterPath))
                    case .show(let show):
                        PosterCard(value: item, title: show.title, subtitle: show.year, imageURL: session.imageURL(show.posterPath))
                    }
                }
            }
            .padding(.horizontal, m.margin)
        }
    }
}
