import SwiftUI

// MARK: - Shared pieces

/// Backdrop with a fade into the page and the title logo at the bottom-left.
private struct DetailHeader: View {
    let backdrop: URL?
    let logo: URL?
    let title: String
    let metrics: Metrics

    var body: some View {
        Color.clear
            .frame(height: metrics.detailHeaderHeight)
            .overlay { RemoteImage(url: backdrop) }
            .clipped()
            .overlay {
                LinearGradient(stops: [
                    .init(color: .black.opacity(0.4), location: 0),
                    .init(color: .clear, location: 0.3),
                    .init(color: Theme.background.opacity(0.75), location: 0.78),
                    .init(color: Theme.background, location: 1),
                ], startPoint: .top, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                TitleLogoView(url: logo, title: title,
                              maxWidth: metrics.regular ? 440 : 280, maxHeight: metrics.regular ? 150 : 96,
                              fontSize: metrics.regular ? 44 : 32)
                    .padding(.horizontal, metrics.margin)
            }
    }
}

/// Buttons: one big primary button, then the rest side by side (one row on iPad).
private struct ActionButtons<Primary: View, Secondary: View>: View {
    let metrics: Metrics
    @ViewBuilder let primary: Primary
    @ViewBuilder let secondary: Secondary

    var body: some View {
        Group {
            if metrics.regular {
                HStack(spacing: 12) { primary; secondary }
            } else {
                VStack(spacing: 10) {
                    primary
                    HStack(spacing: 10) { secondary }
                }
            }
        }
        .controlSize(.large)
        .frame(maxWidth: metrics.buttonRowMaxWidth, alignment: .leading)
    }
}

// MARK: - Movie

struct MovieDetailView: View {
    let movie: Movie
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var details: Movie?
    @State private var cast: [CastMember] = []
    @State private var director: String?
    @State private var similar: [Movie] = []
    @State private var progress = WatchProgress.none
    @State private var saving = false
    /// Year · runtime · rating… wrapping onto a second line on narrow screens.
    private let metaRow = FlowRow()

    private var shown: Movie { details ?? movie }
    private var inProgress: Bool { !progress.completed && progress.position > 10 }
    private var remaining: Int {
        guard let duration = shown.duration, duration > 0 else { return 0 }
        return max(0, duration - (inProgress ? progress.position : 0))
    }

    var body: some View {
        let m = Metrics(sizeClass)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                DetailHeader(backdrop: session.imageURL(shown.backdropPath ?? shown.posterPath),
                             logo: session.imageURL(shown.logoPath), title: shown.title, metrics: m)

                VStack(alignment: .leading, spacing: 14) {
                    metaRow {
                        if let year = shown.year { Text(String(year)) }
                        if let duration = shown.duration, duration > 0 { Text(Fmt.runtime(duration)) }
                        if let rating = shown.contentRating { Pill(text: rating) }
                        if let score = shown.rating, score > 0 {
                            Label(String(format: "%.1f", score), systemImage: "star.fill").foregroundStyle(.yellow)
                        }
                        if remaining > 0 {
                            TimelineView(.everyMinute) { context in
                                Pill(text: (inProgress ? "\(Fmt.runtime(remaining)) left · " : "") + "Ends at \(Fmt.endsAt(remaining, from: context.date))")
                            }
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                    if !shown.genres.isEmpty {
                        Text(shown.genres.joined(separator: " · ")).font(.subheadline).foregroundStyle(Theme.accent)
                    }

                    ActionButtons(metrics: m) {
                        Button { play(from: inProgress ? progress.position : 0) } label: {
                            Label(inProgress ? "Resume from \(Fmt.clock(progress.position))" : "Play", systemImage: "play.fill")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glassProminent)
                    } secondary: {
                        if inProgress {
                            Button { play(from: 0) } label: {
                                Label("From Beginning", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glass)
                        }
                        Button { Task { await toggleWatched() } } label: {
                            Label(progress.completed ? "Unwatched" : "Watched", systemImage: progress.completed ? "eye.slash" : "checkmark")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                        .disabled(saving)
                    }

                    if let overview = shown.overview, !overview.isEmpty {
                        Text(overview).font(.body).frame(maxWidth: 760, alignment: .leading)
                    }
                    if let director, !director.isEmpty {
                        Text("Directed by \(director)").font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, m.margin)

                if !cast.isEmpty { CastRow(cast: cast, metrics: m) }
                if !similar.isEmpty {
                    Shelf("More Like This", margin: m.margin) {
                        ForEach(similar) { item in
                            PosterCard(value: item, title: item.title, subtitle: item.year.map { String($0) },
                                       imageURL: session.imageURL(item.posterPath), width: m.posterWidth)
                        }
                    }
                }
            }
            .padding(.bottom, 30)
        }
        .scrollIndicators(.hidden)
        .ignoresSafeArea(edges: .top)
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: ReloadKey(playerClosed: player.request == nil, profile: session.profile)) {
            if player.request == nil { await load() }
        }
    }

    private func load() async {
        let response = try? await session.get("/api/movies/\(movie.id)/details", as: MovieDetailsResponse.self)
        if let response {
            details = response.movie
            cast = response.cast
            director = response.director
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
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        }
        saving = false
    }
}

// MARK: - TV show

struct ShowDetailView: View {
    let show: Show
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var details: ShowDetailsResponse?
    @State private var season: Int?
    @State private var episodes: [Episode] = []
    @State private var saving = false
    private let metaRow = FlowRow()

    private var shown: Show { details?.show ?? show }
    private var seasons: [Season] { details?.seasons ?? [] }
    private var allWatched: Bool { !seasons.isEmpty && seasons.allSatisfy { $0.episodeCount > 0 && $0.watchedCount >= $0.episodeCount } }
    /// First episode in this season that isn't finished — what "Play" starts.
    private var upNext: Episode? { episodes.first { !$0.watchCompleted } }

    var body: some View {
        let m = Metrics(sizeClass)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                DetailHeader(backdrop: session.imageURL(shown.backdropPath ?? shown.posterPath),
                             logo: session.imageURL(shown.logoPath), title: shown.title, metrics: m)

                VStack(alignment: .leading, spacing: 14) {
                    metaRow {
                        if let year = shown.year { Text(year) }
                        Text("\(seasons.count) season\(seasons.count == 1 ? "" : "s")")
                        if let rating = shown.contentRating { Pill(text: rating) }
                        if allWatched { Pill(text: "✓ WATCHED", color: .green) }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                    if !shown.genres.isEmpty {
                        Text(shown.genres.joined(separator: " · ")).font(.subheadline).foregroundStyle(Theme.accent)
                    }

                    ActionButtons(metrics: m) {
                        if let next = upNext {
                            Button { play(next) } label: {
                                Label("\(next.inProgress ? "Resume" : "Play") \(next.label)", systemImage: "play.fill")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glassProminent)
                        }
                    } secondary: {
                        if details?.started == true, let first = details?.firstEpisodeId {
                            Button {
                                player.play(.episode, id: first, from: 0, title: shown.title)
                            } label: {
                                Label("From Beginning", systemImage: "arrow.counterclockwise").frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.glass)
                        }
                        Button { Task { await toggleShowWatched() } } label: {
                            Label(allWatched ? "Unwatched" : "Watched", systemImage: allWatched ? "eye.slash" : "checkmark")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.glass)
                        .disabled(saving || seasons.isEmpty)
                    }

                    if let overview = shown.overview, !overview.isEmpty {
                        Text(overview).font(.body).frame(maxWidth: 760, alignment: .leading)
                    }
                }
                .padding(.horizontal, m.margin)

                if seasons.count > 1 { seasonPicker(m) }

                LazyVStack(alignment: .leading, spacing: 14) {
                    ForEach(episodes) { episode in
                        EpisodeRow(episode: episode, metrics: m, onPlay: { play(episode) },
                                   onPlayFromStart: { playFromStart(episode) },
                                   onToggleWatched: { Task { await toggleEpisodeWatched(episode) } })
                    }
                }
                .padding(.horizontal, m.margin)

                if let cast = details?.cast, !cast.isEmpty { CastRow(cast: cast, metrics: m) }
                if let similar = details?.similarLocal, !similar.isEmpty {
                    Shelf("More Like This", margin: m.margin) {
                        ForEach(similar) { item in
                            PosterCard(value: item, title: item.title, subtitle: item.year,
                                       imageURL: session.imageURL(item.posterPath), width: m.posterWidth)
                        }
                    }
                }
            }
            .padding(.bottom, 30)
        }
        .scrollIndicators(.hidden)
        .ignoresSafeArea(edges: .top)
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task(id: ReloadKey(playerClosed: player.request == nil, profile: session.profile)) {
            if player.request == nil { await load() }
        }
        .task(id: season) { await loadEpisodes() }
    }

    private func seasonPicker(_ m: Metrics) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                ForEach(seasons) { s in
                    let label = s.season == 0 ? "Specials" : "Season \(s.season)"
                    let done = s.episodeCount > 0 && s.watchedCount >= s.episodeCount
                    if s.season == season {
                        Button { season = s.season } label: {
                            Label(label, systemImage: done ? "checkmark.circle.fill" : "play.circle.fill")
                        }
                        .buttonStyle(.glassProminent)
                    } else {
                        Button { season = s.season } label: {
                            if done { Label(label, systemImage: "checkmark.circle") } else { Text(label) }
                        }
                        .buttonStyle(.glass)
                    }
                }
            }
            .padding(.horizontal, m.margin)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
    }

    private func load() async {
        guard let response = try? await session.get("/api/tv/\(show.id)/details", as: ShowDetailsResponse.self) else { return }
        details = response
        if season == nil || !response.seasons.contains(where: { $0.season == season }) {
            // Start on the first season that isn't finished; Season 0 (extras) only if nothing else is left.
            let ordered = response.seasons.filter { $0.season > 0 } + response.seasons.filter { $0.season == 0 }
            season = ordered.first(where: { $0.watchedCount < $0.episodeCount })?.season ?? ordered.first?.season
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
        player.play(.episode, id: episode.id, from: episode.inProgress ? episode.watchPosition : 0,
                    title: shown.title, subtitle: episode.label + (episode.title.map { " · \($0)" } ?? ""))
    }

    private func playFromStart(_ episode: Episode) {
        player.play(.episode, id: episode.id, from: 0,
                    title: shown.title, subtitle: episode.label + (episode.title.map { " · \($0)" } ?? ""))
    }

    private func toggleShowWatched() async {
        saving = true
        let watched = !allWatched
        _ = try? await session.post("/api/stream/watched", body: ["mediaType": "show", "mediaId": show.id, "watched": watched], as: Empty.self)
        await load()
        await loadEpisodes()
        saving = false
    }

    private func toggleEpisodeWatched(_ episode: Episode) async {
        _ = try? await session.post("/api/stream/watched", body: ["mediaType": "episode", "mediaId": episode.id, "watched": !episode.watchCompleted], as: Empty.self)
        await load()
        await loadEpisodes()
    }
}

struct EpisodeRow: View {
    let episode: Episode
    let metrics: Metrics
    let onPlay: () -> Void
    let onPlayFromStart: () -> Void
    let onToggleWatched: () -> Void
    @EnvironmentObject private var session: Session

    var body: some View {
        Button(action: onPlay) {
            HStack(alignment: .top, spacing: 12) {
                Color.clear
                    .frame(width: metrics.stillWidth, height: metrics.stillWidth * 9 / 16)
                    .overlay { RemoteImage(url: session.imageURL(episode.stillPath), placeholder: episode.label) }
                    .overlay(alignment: .bottom) {
                        if episode.inProgress, let duration = episode.duration, duration > 0 {
                            ProgressStrip(fraction: Double(episode.watchPosition) / Double(duration))
                        }
                    }
                    .overlay {
                        Image(systemName: "play.fill").font(.caption).frame(width: 30, height: 30).glassEffect(.regular, in: .circle)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Text("\(episode.episodeNumber). \(episode.displayTitle)")
                            .font(.subheadline.weight(.semibold))
                            .lineLimit(2)
                        if episode.watchCompleted {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green).font(.caption)
                        }
                    }
                    if let duration = episode.duration, duration > 0 {
                        // Finished episodes replay from the start; in-progress ones resume.
                        let left = episode.inProgress ? max(0, duration - episode.watchPosition) : duration
                        TimelineView(.everyMinute) { context in
                            Text((episode.inProgress ? "\(Fmt.runtime(left)) left" : Fmt.runtime(duration)) + " · Ends at \(Fmt.endsAt(left, from: context.date))")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    if let overview = episode.overview, !overview.isEmpty {
                        Text(overview)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(metrics.regular ? 3 : 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(action: onPlay) {
                Label(episode.inProgress ? "Resume" : "Play", systemImage: "play.fill")
            }
            if episode.inProgress {
                Button(action: onPlayFromStart) { Label("Play from Beginning", systemImage: "arrow.counterclockwise") }
            }
            Button(action: onToggleWatched) {
                Label(episode.watchCompleted ? "Mark as Unwatched" : "Mark as Watched",
                      systemImage: episode.watchCompleted ? "eye.slash" : "checkmark")
            }
        }
    }
}

/// Lays items out in a row, wrapping onto more lines when they don't fit.
struct FlowRow: Layout {
    var spacing: CGFloat = 10
    var lineSpacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, lineHeight: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width {
                y += lineHeight + lineSpacing
                x = 0
                lineHeight = 0
            }
            x += size.width + spacing
            widest = max(widest, x - spacing)
            lineHeight = max(lineHeight, size.height)
        }
        return CGSize(width: min(widest, width), height: y + lineHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, lineHeight: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX {
                y += lineHeight + lineSpacing
                x = bounds.minX
                lineHeight = 0
            }
            view.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: .unspecified)
            x += size.width + spacing
            lineHeight = max(lineHeight, size.height)
        }
    }
}
