import SwiftUI

/// Sizes for iPhone (compact width) and iPad / wide windows (regular width).
struct Metrics {
    let regular: Bool

    init(_ sizeClass: UserInterfaceSizeClass?) { regular = sizeClass == .regular }

    var margin: CGFloat { regular ? 28 : 16 }
    var heroHeight: CGFloat { regular ? 640 : 520 }
    var detailHeaderHeight: CGFloat { regular ? 460 : 300 }
    var posterWidth: CGFloat { regular ? 160 : 118 }
    var wideCardWidth: CGFloat { regular ? 360 : 272 }
    var gridMinimum: CGFloat { regular ? 150 : 104 }
    var genreTileMinimum: CGFloat { regular ? 240 : 160 }
    var castSize: CGFloat { regular ? 96 : 72 }
    var stillWidth: CGFloat { regular ? 220 : 148 }
    /// Button rows don't stretch across a whole iPad.
    var buttonRowMaxWidth: CGFloat { regular ? 520 : .infinity }
}

/// Reload when the player closes (Continue Watching changed) or the profile —
/// or its English-titles setting — changes.
struct ReloadKey: Equatable {
    let playerClosed: Bool
    let profile: Profile?
}

/// Remote image that fills its frame, with a dark placeholder while loading.
/// Put it in an overlay of a sized view so a very wide or tall image can't
/// change the layout.
struct RemoteImage: View {
    let url: URL?
    var placeholder: String? = nil

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            default:
                ZStack {
                    Color(white: 0.14)
                    if let placeholder {
                        Text(placeholder)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(8)
                    }
                }
            }
        }
    }
}

/// Tries each URL in turn until one loads (e.g. a still frame, then artwork).
struct FallbackImage: View {
    let urls: [URL]
    var placeholder: String? = nil
    @State private var index = 0

    var body: some View {
        if index < urls.count {
            AsyncImage(url: urls[index]) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFill()
                case .failure:
                    Color(white: 0.14).onAppear { index += 1 }
                default:
                    Color(white: 0.14)
                }
            }
            .id(index)
        } else {
            RemoteImage(url: nil, placeholder: placeholder)
        }
    }
}

/// Thin progress bar for partly watched items.
struct ProgressStrip: View {
    let fraction: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Rectangle().fill(Color.white.opacity(0.25))
                Rectangle().fill(Theme.accent).frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: 4)
    }
}

/// 2:3 poster that opens a detail page, with the title underneath.
/// `width` nil fills the grid column.
struct PosterCard<Value: Hashable>: View {
    let value: Value
    let title: String
    var subtitle: String? = nil
    let imageURL: URL?
    var progress: Double? = nil
    var width: CGFloat? = nil

    var body: some View {
        NavigationLink(value: value) {
            VStack(alignment: .leading, spacing: 6) {
                Color.clear
                    .aspectRatio(2.0 / 3.0, contentMode: .fit)
                    .overlay { RemoteImage(url: imageURL, placeholder: title) }
                    .overlay(alignment: .bottom) {
                        if let progress, progress > 0 { ProgressStrip(fraction: progress) }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(.white.opacity(0.08)))
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                if let subtitle {
                    Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
            }
            .frame(width: width)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// 16:9 card with the title over a gradient — Continue Watching.
struct WideCard: View {
    let title: String
    let subtitle: String?
    /// Tried in order: a still from where you stopped, then artwork.
    let imageURLs: [URL]
    let progress: Double?
    let width: CGFloat

    var body: some View {
        Color.clear
            .frame(width: width, height: width * 9 / 16)
            .overlay { FallbackImage(urls: imageURLs, placeholder: title) }
            .overlay { LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom) }
            .overlay(alignment: .bottomLeading) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).font(.subheadline.weight(.semibold)).lineLimit(1)
                    if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                    if let progress { ProgressStrip(fraction: progress).clipShape(Capsule()) }
                }
                .padding(12)
            }
            .overlay {
                Image(systemName: "play.fill")
                    .font(.title3)
                    .frame(width: 46, height: 46)
                    .glassEffect(.regular, in: .circle)
                    .offset(y: -10)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// A titled horizontal row of cards.
struct Shelf<Content: View>: View {
    let title: String
    let margin: CGFloat
    let content: Content

    init(_ title: String, margin: CGFloat, @ViewBuilder content: () -> Content) {
        self.title = title
        self.margin = margin
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.title3.weight(.bold))
                .padding(.horizontal, margin)
            ScrollView(.horizontal) {
                LazyHStack(alignment: .top, spacing: 12) { content }
                    .padding(.horizontal, margin)
            }
            .scrollIndicators(.hidden)
        }
    }
}

/// Round profile picture, or the first letter on a gradient (orange for Streamlings).
struct ProfileAvatar: View {
    let profile: Profile
    var size: CGFloat = 80
    @EnvironmentObject private var session: Session

    var body: some View {
        ZStack {
            LinearGradient(
                colors: profile.isKids ? [Theme.streamling, Color(red: 0.98, green: 0.34, blue: 0.03)] : [Theme.accent, Theme.purple],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
            Text(String(profile.name.prefix(1)).uppercased())
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundStyle(.white)
            if let url = session.imageURL(profile.avatarPath) {
                RemotePicture(url: url, maxPixelSize: size * 3)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

/// The title's logo artwork, or the title as text if there isn't one.
struct TitleLogoView: View {
    let url: URL?
    let title: String
    var maxWidth: CGFloat = 320
    var maxHeight: CGFloat = 110
    var fontSize: CGFloat = 34

    var body: some View {
        if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                        .frame(maxWidth: maxWidth, maxHeight: maxHeight, alignment: .leading)
                        .shadow(color: .black.opacity(0.6), radius: 10)
                        .accessibilityLabel(title)
                case .failure:
                    titleText
                default:
                    Color.clear.frame(width: maxWidth * 0.6, height: maxHeight * 0.6)
                }
            }
        } else {
            titleText
        }
    }

    private var titleText: some View {
        Text(title)
            .font(.system(size: fontSize, weight: .bold))
            .lineLimit(2)
            .minimumScaleFactor(0.7)
            .shadow(radius: 8)
    }
}

/// Small rounded label, e.g. content rating or "Ends at 8:00 PM".
struct Pill: View {
    let text: String
    var color: Color = .white

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .glassEffect(.regular, in: .capsule)
    }
}

/// "Cast" row: round headshots with names.
struct CastRow: View {
    let cast: [CastMember]
    let metrics: Metrics
    @EnvironmentObject private var session: Session

    var body: some View {
        Shelf("Cast", margin: metrics.margin) {
            ForEach(cast) { person in
                VStack(spacing: 8) {
                    ZStack {
                        Circle().fill(Color(white: 0.16))
                        if let url = session.imageURL(person.profilePath) {
                            AsyncImage(url: url) { image in
                                image.resizable().scaledToFill()
                            } placeholder: {
                                Color.clear
                            }
                        } else {
                            Image(systemName: "person.fill").font(.title).foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: metrics.castSize, height: metrics.castSize)
                    .clipShape(Circle())
                    Text(person.name).font(.caption.weight(.semibold)).lineLimit(1)
                    if let character = person.character, !character.isEmpty {
                        Text(character).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .frame(width: metrics.castSize + 24)
            }
        }
    }
}

extension View {
    /// Where poster links lead, for any NavigationStack that shows movies or shows.
    func mediaDestinations() -> some View {
        navigationDestination(for: Movie.self) { MovieDetailView(movie: $0) }
            .navigationDestination(for: Show.self) { ShowDetailView(show: $0) }
    }

    /// The profile picture top-right, opening Profile & Settings.
    func accountButton() -> some View {
        modifier(AccountButton())
    }
}

private struct AccountButton: ViewModifier {
    @EnvironmentObject private var session: Session
    @State private var showAccount = false

    func body(content: Content) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAccount = true } label: {
                        if let profile = session.profile {
                            ProfileAvatar(profile: profile, size: 30)
                        } else {
                            Image(systemName: "person.crop.circle")
                        }
                    }
                    .accessibilityLabel("Profile and settings")
                }
            }
            .sheet(isPresented: $showAccount) {
                NavigationStack { AccountView() }
                    .environmentObject(session)
            }
    }
}
