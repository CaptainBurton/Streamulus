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
            Tab(session.profile?.name ?? "Profile", systemImage: "person.crop.circle.fill") {
                NavigationStack { AccountView() }
            }
        }
        .fullScreenCover(item: $player.request) { request in
            PlayerView(request: request)
        }
    }
}

// MARK: - Home

struct HomeView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @State private var continueItems: [ContinueItem] = []
    @State private var movies: [Movie] = []
    @State private var shows: [Show] = []
    @State private var loaded = false
    @State private var errorText: String?

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 30) {
                if session.profile?.isKids == true {
                    Pill(text: "STREAMLINGS", color: Theme.streamling).padding(.horizontal, 80)
                }

                if !continueItems.isEmpty {
                    Shelf("Continue Watching") {
                        ForEach(continueItems) { item in
                            Button { resume(item) } label: {
                                WideCard(
                                    title: item.title,
                                    subtitle: item.subtitle,
                                    imageURL: session.imageURL(item.backdropPath ?? item.posterPath),
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

                if loaded && continueItems.isEmpty && movies.isEmpty && shows.isEmpty {
                    Text(errorText ?? "Nothing here yet — add a library in Streamulus on the web.")
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 200)
                }
            }
            .padding(.vertical, 40)
        }
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
        loaded = true
    }

    private func resume(_ item: ContinueItem) {
        let type: MediaType = item.type == "movie" ? .movie : .episode
        player.play(type, id: item.mediaId, from: item.position, title: item.title, subtitle: item.subtitle)
    }
}

// MARK: - Library grids

struct MovieGridView: View {
    @EnvironmentObject private var session: Session
    @State private var movies: [Movie] = []
    @State private var loading = true
    @State private var errorText: String?

    private let columns = [GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 50)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 50) {
                ForEach(movies) { movie in
                    PosterLink(
                        value: movie,
                        title: movie.title,
                        subtitle: movie.year.map { String($0) },
                        imageURL: session.imageURL(movie.posterPath),
                        progress: movie.watchPosition > 10 && !movie.watchCompleted
                            ? movie.duration.map { Double(movie.watchPosition) / Double(max($0, 1)) } : nil
                    )
                }
            }
            .padding(80)
        }
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

    private let columns = [GridItem(.adaptive(minimum: 250, maximum: 250), spacing: 50)]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 50) {
                ForEach(shows) { show in
                    PosterLink(
                        value: show,
                        title: show.title,
                        subtitle: show.totalEpisodes > 0 && show.watchedEpisodes >= show.totalEpisodes ? "Watched" : show.year,
                        imageURL: session.imageURL(show.posterPath)
                    )
                }
            }
            .padding(80)
        }
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
