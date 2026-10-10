import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var featured: Movie?
    @State private var rotateSeconds = 120
    @State private var continueItems: [ContinueItem] = []
    @State private var movies: [Movie] = []
    @State private var shows: [Show] = []
    @State private var loaded = false
    @State private var errorText: String?
    @State private var loadedFor: Profile?

    private var m: Metrics { Metrics(sizeClass) }

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if let featured {
                        FeaturedBanner(movie: featured, metrics: m, topInset: geo.safeAreaInsets.top)
                    } else {
                        // No featured movie (yet): keep the rows clear of the top bar.
                        Color.clear.frame(height: geo.safeAreaInsets.top)
                        if !loaded { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 60) }
                    }

                    if !continueItems.isEmpty {
                        Shelf("Continue Watching", margin: m.margin) {
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
                                        progress: item.duration.map { Double(item.position) / Double(max($0, 1)) },
                                        width: m.wideCardWidth
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if !movies.isEmpty {
                        Shelf("Recently Added Movies", margin: m.margin) {
                            ForEach(movies) { movie in
                                PosterCard(value: movie, title: movie.title, subtitle: movie.year.map { String($0) },
                                           imageURL: session.imageURL(movie.posterPath), width: m.posterWidth)
                            }
                        }
                    }

                    if !shows.isEmpty {
                        Shelf("Recently Added Shows", margin: m.margin) {
                            ForEach(shows) { show in
                                PosterCard(value: show, title: show.title, subtitle: show.year,
                                           imageURL: session.imageURL(show.posterPath), width: m.posterWidth)
                            }
                        }
                    }

                    if loaded && featured == nil && continueItems.isEmpty && movies.isEmpty && shows.isEmpty {
                        ContentUnavailableView("Nothing here yet",
                                               systemImage: "film.stack",
                                               description: Text(errorText ?? "Add a library in Streamulus on the web."))
                    }
                }
                .padding(.bottom, 30)
            }
            .scrollIndicators(.hidden)
            .ignoresSafeArea(edges: .top)
        }
        .background(Theme.background)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            // In the top bar with the profile picture, so it sits right at the top and
            // stays put when the page scrolls or is pulled down past the top.
            ToolbarItem(placement: .topBarLeading) {
                BrandMark(size: 20)
                    .shadow(color: .black.opacity(0.5), radius: 8)
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .accountButton()
        .mediaDestinations()
        .refreshable { await load() }
        // Reload when the player closes (Continue Watching) or the profile changes.
        .task(id: ReloadKey(playerClosed: player.request == nil, profile: session.profile)) {
            guard player.request == nil else { return }
            if loadedFor != session.profile {
                if loadedFor != nil { featured = nil }
                loadedFor = session.profile
            }
            await load()
        }
        // A different featured movie every rotateSeconds (Admin › Settings › Home Page).
        .task(id: RotationKey(movieId: featured?.id, seconds: rotateSeconds, paused: player.request != nil)) {
            guard let current = featured?.id, player.request == nil else { return }
            try? await Task.sleep(nanoseconds: UInt64(rotateSeconds) * 1_000_000_000)
            guard !Task.isCancelled else { return }
            await rotate(excluding: current)
        }
    }

    private struct RotationKey: Equatable {
        let movieId: Int?
        let seconds: Int
        let paused: Bool
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
        if case .failure(let error) = results.1 { errorText = error.localizedDescription } else { errorText = nil }
        if featured == nil {
            let response = try? await session.get("/api/movies/featured", as: FeaturedResponse.self)
            featured = response?.movie
            if let seconds = response?.rotateSeconds, seconds > 0 { rotateSeconds = seconds }
        }
        loaded = true
    }

    private func rotate(excluding current: Int) async {
        let response = try? await session.get("/api/movies/featured", query: [URLQueryItem(name: "exclude", value: String(current))], as: FeaturedResponse.self)
        guard let response, !Task.isCancelled else { return }
        if let seconds = response.rotateSeconds, seconds > 0 { rotateSeconds = seconds }
        guard let next = response.movie, next.id != current else { return }
        // Fetch the artwork first (into the URL cache) so the crossfade is smooth.
        if let url = session.imageURL(next.backdropPath ?? next.posterPath) { _ = try? await URLSession.shared.data(from: url) }
        if let url = session.imageURL(next.logoPath) { _ = try? await URLSession.shared.data(from: url) }
        guard !Task.isCancelled else { return }
        withAnimation(.easeInOut(duration: 0.9)) { featured = next }
    }

    private static func fetch<T>(_ request: () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await request()) } catch { return .failure(error) }
    }

    private func resume(_ item: ContinueItem) {
        let type: MediaType = item.type == "movie" ? .movie : .episode
        player.play(type, id: item.mediaId, from: item.position, title: item.title, subtitle: item.subtitle)
    }
}

/// Netflix-style banner: artwork, title logo, Play and More Info.
struct FeaturedBanner: View {
    let movie: Movie
    let metrics: Metrics
    let topInset: CGFloat
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter

    var body: some View {
        Color.clear
            .frame(height: metrics.heroHeight + topInset)
            .overlay {
                RemoteImage(url: session.imageURL(movie.backdropPath ?? movie.posterPath))
                    .id(movie.id)
                    .transition(.opacity)
            }
            .clipped()
            .overlay {
                LinearGradient(stops: [
                    .init(color: .black.opacity(0.45), location: 0),
                    .init(color: .clear, location: 0.22),
                    .init(color: .clear, location: 0.45),
                    .init(color: Theme.background.opacity(0.85), location: 0.82),
                    .init(color: Theme.background, location: 1),
                ], startPoint: .top, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 10) {
                        TitleLogoView(url: session.imageURL(movie.logoPath), title: movie.title,
                                      maxWidth: metrics.regular ? 420 : 280, maxHeight: metrics.regular ? 150 : 100,
                                      fontSize: metrics.regular ? 44 : 32)
                        HStack(spacing: 10) {
                            if let year = movie.year { Text(String(year)) }
                            if let duration = movie.duration, duration > 0 { Text(Fmt.runtime(duration)) }
                            if let rating = movie.contentRating { Pill(text: rating) }
                        }
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        if metrics.regular, let overview = movie.overview, !overview.isEmpty {
                            Text(overview).lineLimit(3).frame(maxWidth: 620, alignment: .leading)
                        }
                    }
                    .id(movie.id)
                    .transition(.opacity)
                    HStack(spacing: 12) {
                        Button { Task { await playNow() } } label: {
                            Label("Play", systemImage: "play.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                        NavigationLink(value: movie) {
                            Label("More Info", systemImage: "info.circle").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                    }
                    .controlSize(.large)
                    .frame(maxWidth: 440)
                }
                .padding(.horizontal, metrics.margin)
                .padding(.bottom, 4)
            }
    }

    /// Resume if it's part watched, otherwise start from the beginning.
    private func playNow() async {
        let progress = try? await session.get("/api/stream/progress/movie/\(movie.id)", as: WatchProgress.self)
        let start = progress.map { !$0.completed && $0.position > 10 ? $0.position : 0 } ?? 0
        player.play(.movie, id: movie.id, from: start, title: movie.title)
    }
}
