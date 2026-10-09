import SwiftUI

/// Opens a genre's page from the Genres tab.
struct GenreRef: Hashable {
    let name: String
}

/// Genres tab: a tile per genre, the size and shape of the Apple TV home screen's
/// app tiles (5 across, 5:3), with the admin's image or a random title's banner art.
struct GenresView: View {
    @EnvironmentObject private var session: Session
    @State private var genres: [GenreSummary] = []
    @State private var loading = true
    @State private var errorText: String?
    /// The highlighted genre's artwork, blurred behind the tiles (like the library grids).
    @FocusState private var focusedGenre: String?
    @State private var backgroundArt: URL?
    @State private var artTask: Task<Void, Never>?

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 48, alignment: .top), count: 5)

    var body: some View {
        ScrollView(.vertical) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 60) {
                ForEach(genres) { genre in
                    NavigationLink(value: GenreRef(name: genre.name)) {
                        GenreCard(genre: genre)
                    }
                    .buttonStyle(.card)
                    .focused($focusedGenre, equals: genre.name)
                }
            }
            .padding(.horizontal, 80)
            .padding(.vertical, 40)
        }
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .background(BlurredArtBackground(url: backgroundArt))
        .onChange(of: focusedGenre) { _, name in
            // Once focus settles, not for every tile flown past.
            guard let name, let genre = genres.first(where: { $0.name == name }) else { return }
            artTask?.cancel()
            artTask = Task {
                try? await Task.sleep(nanoseconds: 250_000_000)
                if !Task.isCancelled { backgroundArt = session.imageURL(genre.imageURL) }
            }
        }
        // Start dark each time the page is shown (see LibraryGrid).
        .onDisappear {
            artTask?.cancel()
            backgroundArt = nil
        }
        .overlay {
            if loading {
                ProgressView()
            } else if let errorText {
                Text(errorText).foregroundStyle(.secondary)
            } else if genres.isEmpty {
                Text("No genres yet").foregroundStyle(.secondary)
            }
        }
        .navigationDestination(for: GenreRef.self) { GenreDetailView(name: $0.name) }
        .mediaDestinations()
        .task(id: session.profile) { // reload after switching profile or English titles
            do {
                genres = try await session.get("/api/genres", as: GenresResponse.self).genres
                errorText = nil
            } catch {
                errorText = error.localizedDescription
            }
            loading = false
        }
    }
}

/// 5:3 artwork tile (like a home screen app tile) with the genre's name over a gradient.
struct GenreCard: View {
    let genre: GenreSummary
    @EnvironmentObject private var session: Session

    private var counts: String {
        [
            genre.movieCount > 0 ? "\(genre.movieCount) movie\(genre.movieCount == 1 ? "" : "s")" : nil,
            genre.showCount > 0 ? "\(genre.showCount) show\(genre.showCount == 1 ? "" : "s")" : nil,
        ].compactMap { $0 }.joined(separator: " · ")
    }

    var body: some View {
        // The tile's size comes only from its column and the 5:3 shape; the
        // artwork fills it and is cropped. (Sized by the artwork, a very wide
        // TVDB banner made its tile several times wider than the others.)
        Color.clear
            .aspectRatio(5.0 / 3.0, contentMode: .fit)
            .background(LinearGradient(colors: [Color(red: 0.1, green: 0.16, blue: 0.23), Color(red: 0.16, green: 0.1, blue: 0.23)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing))
            .overlay { RemoteImage(url: session.imageURL(genre.imageURL)) }
            .overlay { LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom) }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(genre.name).font(.headline.weight(.heavy)).lineLimit(1).minimumScaleFactor(0.7)
                    if !counts.isEmpty {
                        Text(counts).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .shadow(color: .black.opacity(0.6), radius: 8)
                .padding(18)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A genre's titles, with All / Movies / TV Shows filter chips above the A–Z grid.
struct GenreDetailView: View {
    let name: String
    @EnvironmentObject private var session: Session
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

    private var filterBar: some View {
        HStack(alignment: .center, spacing: 36) {
            Text(name).font(.title2.weight(.heavy))
            HStack(spacing: 20) {
                ForEach(Filter.allCases) { option in
                    Button { filter = option } label: {
                        Text("\(option.rawValue)  \(count(option))")
                    }
                    .buttonStyle(SeasonChipStyle(isSelected: option == filter))
                    .disabled(count(option) == 0)
                }
            }
        }
        .padding(.horizontal, 80)
        .padding(.top, 30)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
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
                progress: { _ in nil },
                // The title and All / Movies / TV Shows chips scroll with the grid.
                header: AnyView(filterBar)
            )
        }
        .overlay {
            if loading {
                ProgressView()
            } else if let errorText {
                Text(errorText).foregroundStyle(.secondary)
            }
        }
        .navigationDestination(for: GenreItem.self) { item in
            switch item {
            case .movie(let movie): MovieDetailView(movie: movie)
            case .show(let show): ShowDetailView(show: show)
            }
        }
        .task(id: session.profile) { // reload after switching profile or English titles
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
