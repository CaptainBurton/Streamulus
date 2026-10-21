// Shared with the Apple TV app — tv/appletv/generate_project.rb copies this folder into
// its project. Edit it here, then run that script to update the Apple TV copy.

import SwiftUI

/// A streaming service (Netflix, Disney+…) on the Home row — Admin › Streaming
/// Services decides which titles each one has.
struct StreamingService: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    /// The logo already coloured with the Streamulus gradient (transparent PNG).
    let logoPNG: String?
    /// Width ÷ height of the logo.
    let logoAspect: Double
    let bannerURL: String?
    let movieCount: Int
    let showCount: Int

    enum CodingKeys: String, CodingKey {
        case id, name
        case logoPNG = "logo_png"
        case logoAspect = "logo_aspect"
        case bannerURL = "banner_url"
        case movieCount = "movie_count"
        case showCount = "show_count"
    }

    var titleCount: Int { movieCount + showCount }
}

extension StreamingService {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = c.lossyString(.id) ?? ""
        name = c.lossyString(.name) ?? ""
        logoPNG = c.lossyString(.logoPNG)
        logoAspect = (try? c.decode(Double.self, forKey: .logoAspect)) ?? 3
        bannerURL = c.lossyString(.bannerURL)
        movieCount = c.lossyInt(.movieCount) ?? 0
        showCount = c.lossyInt(.showCount) ?? 0
    }
}

struct StreamingServicesResponse: Decodable {
    let services: [StreamingService]
}

/// GET /api/services/:id — the service and its titles.
struct ServiceDetailResponse: Decodable {
    let service: StreamingService
    let movies: [Movie]
    let shows: [Show]
}

/// Size for a logo inside a box, by area rather than by fitting, so a tall logo
/// (HBO Max) and a long one (Crunchyroll) look about the same size.
func serviceLogoSize(aspect: Double, box: CGSize, fill: Double = 0.17, maxWidth: Double = 0.78, maxHeight: Double = 0.5) -> CGSize {
    let a = aspect > 0 ? aspect : 3
    let boxWidth = Double(box.width), boxHeight = Double(box.height)
    let area = fill * boxWidth * boxHeight
    var width = (area * a).squareRoot()
    var height = width / a
    let shrink = min(1, maxWidth * boxWidth / width, maxHeight * boxHeight / height)
    width *= shrink
    height *= shrink
    return CGSize(width: width.rounded(), height: height.rounded())
}

/// The service's logo in the Streamulus colours (the server colours the PNG).
struct ServiceLogo: View {
    let service: StreamingService
    let size: CGSize
    @EnvironmentObject private var session: Session

    var body: some View {
        AsyncImage(url: session.imageURL(service.logoPNG)) { phase in
            if case .success(let image) = phase {
                image.resizable().scaledToFit()
            } else {
                Text(service.name)
                    .font(.system(size: max(12, size.height * 0.45), weight: .heavy))
                    .foregroundStyle(Theme.logoGradient)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
            }
        }
        .frame(width: size.width, height: size.height)
        .accessibilityLabel(service.name)
    }
}

/// Dark tile behind a service's logo (Home row).
struct ServiceTileBackground: View {
    var body: some View {
        RadialGradient(colors: [Color(red: 0.12, green: 0.15, blue: 0.19), Color(red: 0.08, green: 0.08, blue: 0.09)],
                       center: .top, startRadius: 0, endRadius: 260)
    }
}
