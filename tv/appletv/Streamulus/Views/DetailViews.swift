import SwiftUI

// MARK: - Movie

struct MovieDetailView: View {
    let movie: Movie
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @State private var details: Movie?
    @State private var cast: [CastMember] = []
    @State private var similar: [Movie] = []
    @State private var progress = WatchProgress.none
    @State private var saving = false

    private var shown: Movie { details ?? movie }
    private var inProgress: Bool { !progress.completed && progress.position > 10 }
    private var remaining: Int {
        guard let duration = shown.duration, duration > 0 else { return 0 }
        return max(0, duration - (inProgress ? progress.position : 0))
    }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 40) {
                header
                if !cast.isEmpty { CastShelf(cast: cast) }
                if !similar.isEmpty {
                    Shelf("More Like This") {
                        ForEach(similar) { item in
                            PosterLink(value: item, title: item.title, subtitle: item.year.map { String($0) }, imageURL: session.imageURL(item.posterPath))
                        }
                    }
                }
            }
            .padding(.bottom, 80)
        }
        .scrollIndicators(.hidden)
        .background(Backdrop(url: session.imageURL(shown.backdropPath ?? shown.posterPath)))
        .task(id: player.request == nil) {
            if player.request == nil { await load() }
        }
    }

    private var header: some View {
            VStack(alignment: .leading, spacing: 26) {
                TitleLogoView(url: session.imageURL(shown.logoPath), title: shown.title)

                HStack(spacing: 20) {
                    if let year = shown.year { Text(String(year)) }
                    if let duration = shown.duration, duration > 0 { Text(Fmt.runtime(duration)) }
                    if let rating = shown.contentRating { Pill(text: rating) }
                    if let score = shown.rating, score > 0 { Text("★ \(String(format: "%.1f", score))").foregroundStyle(.yellow) }
                    if remaining > 0 {
                        TimelineView(.everyMinute) { context in
                            Pill(text: (inProgress ? "\(Fmt.runtime(remaining)) left · " : "") + "Ends at \(Fmt.endsAt(remaining, from: context.date))")
                        }
                    }
                }
                .foregroundStyle(.secondary)

                if !shown.genres.isEmpty {
                    Text(shown.genres.joined(separator: " · ")).font(.callout).foregroundStyle(Theme.accent)
                }

                if let overview = shown.overview, !overview.isEmpty {
                    Text(overview).lineLimit(4).frame(maxWidth: 1150, alignment: .leading)
                }

                GlassEffectContainer(spacing: 30) {
                    HStack(spacing: 30) {
                        Button {
                            play(from: inProgress ? progress.position : 0)
                        } label: {
                            Label(inProgress ? "Resume from \(Fmt.clock(progress.position))" : "Play", systemImage: "play.fill")
                        }
                        .buttonStyle(.glassProminent)
                        if inProgress {
                            Button { play(from: 0) } label: {
                                Label("Play from Beginning", systemImage: "arrow.counterclockwise")
                            }
                            .buttonStyle(.glass)
                        }
                        Button {
                            Task { await toggleWatched() }
                        } label: {
                            Label(progress.completed ? "Mark as Unwatched" : "Mark as Watched",
                                  systemImage: progress.completed ? "eye.slash" : "checkmark")
                        }
                        .buttonStyle(.glass)
                        .disabled(saving)
                    }
                }
                .padding(.top, 10)
            }
            .padding(.horizontal, 80)
            .padding(.top, 320)
            .frame(maxWidth: .infinity, minHeight: 940, alignment: .bottomLeading)
    }

    private func load() async {
        let response = try? await session.get("/api/movies/\(movie.id)/details", as: MovieDetailsResponse.self)
        if let response {
            details = response.movie
            cast = response.cast
            similar = response.similarLocal
        }
        let watched = try? await session.get("/api/stream/progress/movie/\(movie.id)", as: WatchProgress.self)
        if let watched { progress = watched }
    }

    private func play(from start: Int) {
        player.play(.movie, id: movie.id, from: start, title: shown.title)
    }

    private func toggleWatched() async {
        saving = true
        let watched = !progress.completed
        if (try? await session.post("/api/stream/watched", body: ["mediaType": "movie", "mediaId": movie.id, "watched": watched], as: Empty.self)) != nil {
            progress = WatchProgress(position: 0, completed: watched)
        }
        saving = false
    }
}

// MARK: - TV show

struct ShowDetailView: View {
    let show: Show
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @State private var details: ShowDetailsResponse?
    @State private var season: Int?
    @State private var episodes: [Episode] = []
    @State private var saving = false

    private var shown: Show { details?.show ?? show }
    private var seasons: [Season] { details?.seasons ?? [] }
    private var allWatched: Bool { !seasons.isEmpty && seasons.allSatisfy { $0.episodeCount > 0 && $0.watchedCount >= $0.episodeCount } }
    /// First episode in this season that isn't finished — what "Play" starts.
    private var upNext: Episode? { episodes.first { !$0.watchCompleted } }

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 40) {
                header
                if seasons.count > 1 { seasonPicker }
                VStack(alignment: .leading, spacing: 24) {
                    ForEach(episodes) { episode in
                        EpisodeRow(episode: episode) { play(episode) }
                    }
                }
                .padding(.horizontal, 80)
                if let cast = details?.cast, !cast.isEmpty { CastShelf(cast: cast) }
                if let similar = details?.similarLocal, !similar.isEmpty {
                    Shelf("More Like This") {
                        ForEach(similar) { item in
                            PosterLink(value: item, title: item.title, subtitle: item.year, imageURL: session.imageURL(item.posterPath))
                        }
                    }
                }
            }
            .padding(.bottom, 80)
        }
        .background(Backdrop(url: session.imageURL(shown.backdropPath ?? shown.posterPath)))
        .task(id: player.request == nil) {
            if player.request == nil { await load() }
        }
        .task(id: season) { await loadEpisodes() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 24) {
            TitleLogoView(url: session.imageURL(shown.logoPath), title: shown.title)
            HStack(spacing: 20) {
                if let year = shown.year { Text(year) }
                Text("\(seasons.count) season\(seasons.count == 1 ? "" : "s")")
                if let rating = shown.contentRating { Pill(text: rating) }
                if allWatched { Pill(text: "✓ WATCHED", color: .green) }
            }
            .foregroundStyle(.secondary)
            if let overview = shown.overview, !overview.isEmpty {
                Text(overview).lineLimit(3).frame(maxWidth: 1150, alignment: .leading)
            }
            GlassEffectContainer(spacing: 30) {
                HStack(spacing: 30) {
                    if let next = upNext {
                        Button { play(next) } label: {
                            Label("\(next.inProgress ? "Resume" : "Play") \(next.label)", systemImage: "play.fill")
                        }
                        .buttonStyle(.glassProminent)
                    }
                    if details?.started == true, let first = details?.firstEpisodeId {
                        Button {
                            player.play(.episode, id: first, from: 0, title: shown.title, subtitle: "S1 E1")
                        } label: {
                            Label("Play from Beginning", systemImage: "arrow.counterclockwise")
                        }
                        .buttonStyle(.glass)
                    }
                    Button {
                        Task { await toggleWatched() }
                    } label: {
                        Label(allWatched ? "Mark as Unwatched" : "Mark as Watched", systemImage: allWatched ? "eye.slash" : "checkmark")
                    }
                    .buttonStyle(.glass)
                    .disabled(saving || seasons.isEmpty)
                }
            }
        }
        .padding(.horizontal, 80)
        .padding(.top, 260)
    }

    private var seasonPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            GlassEffectContainer(spacing: 24) {
                HStack(spacing: 24) {
                    ForEach(seasons) { s in
                        // The selected season is the prominent (tinted) glass button.
                        if s.season == season {
                            Button { season = s.season } label: { Text("Season \(s.season)").fontWeight(.bold) }
                                .buttonStyle(.glassProminent)
                        } else {
                            Button { season = s.season } label: { Text("Season \(s.season)") }
                                .buttonStyle(.glass)
                        }
                    }
                }
            }
            .padding(.horizontal, 80)
            .padding(.vertical, 20)
        }
        .scrollClipDisabled()
    }

    private func load() async {
        guard let response = try? await session.get("/api/tv/\(show.id)/details", as: ShowDetailsResponse.self) else { return }
        details = response
        if season == nil || !response.seasons.contains(where: { $0.season == season }) {
            // Start on the first season that isn't finished.
            season = response.seasons.first(where: { $0.watchedCount < $0.episodeCount })?.season ?? response.seasons.first?.season
        } else {
            await loadEpisodes()
        }
    }

    private func loadEpisodes() async {
        guard let season else { return }
        let response = try? await session.get("/api/tv/\(show.id)/season/\(season)", as: SeasonResponse.self)
        if let response { episodes = response.episodes }
    }

    private func play(_ episode: Episode) {
        let subtitle = episode.label + (episode.title.map { " · \($0)" } ?? "")
        player.play(.episode, id: episode.id, from: episode.inProgress ? episode.watchPosition : 0, title: shown.title, subtitle: subtitle)
    }

    private func toggleWatched() async {
        saving = true
        let watched = !allWatched
        _ = try? await session.post("/api/stream/watched", body: ["mediaType": "show", "mediaId": show.id, "watched": watched], as: Empty.self)
        await load()
        await loadEpisodes()
        saving = false
    }
}

struct EpisodeRow: View {
    let episode: Episode
    let action: () -> Void
    @EnvironmentObject private var session: Session

    var body: some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 36) {
                ZStack(alignment: .bottom) {
                    RemoteImage(url: session.imageURL(episode.stillPath), placeholder: episode.label)
                    if episode.inProgress, let duration = episode.duration, duration > 0 {
                        ProgressStrip(fraction: Double(episode.watchPosition) / Double(duration))
                    }
                }
                .frame(width: 384, height: 216)
                .clipped()

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 16) {
                        Text("\(episode.episodeNumber). \(episode.displayTitle)")
                            .font(.headline)
                            .lineLimit(1)
                        if episode.watchCompleted {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                        }
                    }
                    if let duration = episode.duration, duration > 0 {
                        // Finished episodes replay from the start; in-progress ones resume.
                        let left = episode.inProgress ? max(0, duration - episode.watchPosition) : duration
                        TimelineView(.everyMinute) { context in
                            Text((episode.inProgress ? "\(Fmt.runtime(left)) left" : Fmt.runtime(duration)) + " · Ends at \(Fmt.endsAt(left, from: context.date))")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let overview = episode.overview, !overview.isEmpty {
                        Text(overview).font(.callout).foregroundStyle(.secondary).lineLimit(3)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(24)
        }
        .buttonStyle(.card)
    }
}
