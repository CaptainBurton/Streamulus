import SwiftUI

/// 16:9 dark card with a streaming service's logo (the Home row).
struct ServiceTile: View {
    let service: StreamingService
    var width: CGFloat = 400

    var body: some View {
        let size = CGSize(width: width, height: (width * 9 / 16).rounded())
        ServiceTileBackground()
            .frame(width: size.width, height: size.height)
            .overlay { ServiceLogo(service: service, size: serviceLogoSize(aspect: service.logoAspect, box: size)) }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(service.name), \(service.titleCount) title\(service.titleCount == 1 ? "" : "s")")
    }
}

/// One streaming service: its banner and logo, then its movies and shows with
/// All / Movies / TV Shows chips above the A–Z grid (like a genre).
struct ServiceDetailView: View {
    let service: StreamingService
    @EnvironmentObject private var session: Session
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

    /// Banner with the logo, then the filter chips — scrolls with the grid.
    private var header: some View {
        VStack(alignment: .leading, spacing: 24) {
            ServiceTileBackground()
                .frame(height: 380)
                .overlay {
                    if let url = session.imageURL(shown.bannerURL) {
                        RemoteImage(url: url).opacity(0.55)
                    }
                }
                .overlay {
                    LinearGradient(stops: [
                        .init(color: Theme.background.opacity(0.2), location: 0),
                        .init(color: Theme.background.opacity(0.7), location: 0.7),
                        .init(color: Theme.background, location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                }
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 10) {
                        ServiceLogo(service: shown, size: serviceLogoSize(aspect: shown.logoAspect, box: CGSize(width: 760, height: 220), fill: 0.3, maxWidth: 0.95, maxHeight: 0.75))
                            .shadow(color: .black.opacity(0.6), radius: 16)
                        if !loading {
                            Text("\(count(.all)) title\(count(.all) == 1 ? "" : "s") on \(shown.name)")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.horizontal, 80)
                    .padding(.bottom, 10)
                }
                .clipped()

            HStack(spacing: 20) {
                ForEach(GenreDetailView.Filter.allCases) { option in
                    Button { filter = option } label: {
                        Text("\(option.rawValue)  \(count(option))")
                    }
                    .buttonStyle(SeasonChipStyle(isSelected: option == filter))
                    .disabled(count(option) == 0)
                }
            }
            .padding(.horizontal, 80)
        }
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
                header: AnyView(header)
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
}
