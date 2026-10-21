import SwiftUI

/// 16:9 dark tile with a streaming service's logo (the Home row).
struct ServiceTile: View {
    let service: StreamingService
    let width: CGFloat

    var body: some View {
        let size = CGSize(width: width, height: (width * 9 / 16).rounded())
        ServiceTileBackground()
            .frame(width: size.width, height: size.height)
            .overlay { ServiceLogo(service: service, size: serviceLogoSize(aspect: service.logoAspect, box: size)) }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.08)))
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(service.name), \(service.titleCount) title\(service.titleCount == 1 ? "" : "s")")
    }
}

/// One streaming service: its banner and logo, then its movies and shows with an
/// All / Movies / TV Shows switch above the A–Z grid (like a genre).
struct ServiceDetailView: View {
    let service: StreamingService
    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var detail: StreamingService?
    @State private var movies: [Movie] = []
    @State private var shows: [Show] = []
    @State private var filter: GenreDetailView.Filter = .all
    @State private var loading = true
    @State private var errorText: String?

    private var shown: StreamingService { detail ?? service }

    private var items: [GenreItem] {
        (filter == .shows ? [] : movies.map(GenreItem.movie)) + (filter == .movies ? [] : shows.map(GenreItem.show))
    }

    private func count(_ filter: GenreDetailView.Filter) -> Int {
        switch filter {
        case .all: return movies.count + shows.count
        case .movies: return movies.count
        case .shows: return shows.count
        }
    }

    var body: some View {
        let m = Metrics(sizeClass)
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
                VStack(alignment: .leading, spacing: 14) {
                    banner(m)
                    Picker("Show", selection: $filter) {
                        ForEach(GenreDetailView.Filter.allCases) { option in
                            Text("\(option.rawValue) (\(count(option)))").tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, m.margin)
                }
                .padding(.bottom, 8)
            )
        )
        .overlay { LibraryStatus(loading: loading, errorText: errorText, isEmpty: movies.isEmpty && shows.isEmpty, emptyText: "Nothing on \(service.name) yet") }
        .background(Theme.background)
        .navigationTitle(service.name)
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: GenreItem.self) { item in
            switch item {
            case .movie(let movie): MovieDetailView(movie: movie)
            case .show(let show): ShowDetailView(show: show)
            }
        }
        .task(id: session.profile) {
            do {
                let response = try await session.get("/api/services/\(service.id)", as: ServiceDetailResponse.self)
                detail = response.service
                movies = response.movies
                shows = response.shows
                errorText = nil
            } catch {
                errorText = error.localizedDescription
            }
            loading = false
        }
    }

    /// The service's banner (the admin's, or a title's art) with its logo over it.
    private func banner(_ m: Metrics) -> some View {
        let height: CGFloat = sizeClass == .regular ? 280 : 200
        let logoBox = CGSize(width: sizeClass == .regular ? 460 : 300, height: sizeClass == .regular ? 150 : 110)
        return ServiceTileBackground()
            .frame(height: height)
            .overlay {
                if let url = session.imageURL(shown.bannerURL) {
                    RemoteImage(url: url).opacity(0.55)
                }
            }
            .overlay {
                LinearGradient(stops: [
                    .init(color: Theme.background.opacity(0.2), location: 0),
                    .init(color: Theme.background.opacity(0.7), location: 0.75),
                    .init(color: Theme.background, location: 1),
                ], startPoint: .top, endPoint: .bottom)
            }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 6) {
                    ServiceLogo(service: shown, size: serviceLogoSize(aspect: shown.logoAspect, box: logoBox, fill: 0.3, maxWidth: 0.95, maxHeight: 0.75))
                        .shadow(color: .black.opacity(0.6), radius: 12)
                    if !loading {
                        Text("\(count(.all)) title\(count(.all) == 1 ? "" : "s") on \(shown.name)")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.horizontal, m.margin)
                .padding(.bottom, 12)
            }
            .clipped()
    }
}
