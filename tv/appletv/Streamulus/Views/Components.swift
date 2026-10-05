import SwiftUI
import UIKit

struct Logo: View {
    var size: CGFloat = 72

    var body: some View {
        Text("STREAMULUS")
            .font(.system(size: size, weight: .heavy))
            .foregroundStyle(Theme.logoGradient)
    }
}

/// Remote image that fills its frame, with a dark placeholder while loading.
struct RemoteImage: View {
    let url: URL?
    var placeholder: String? = nil

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().scaledToFill()
            case .failure, .empty:
                ZStack {
                    Color(white: 0.14)
                    if let placeholder {
                        Text(placeholder)
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(16)
                    }
                }
            @unknown default:
                Color(white: 0.14)
            }
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
        .frame(height: 8)
    }
}

/// 2:3 poster that opens a detail page, with the title underneath.
struct PosterLink<Value: Hashable>: View {
    let value: Value
    let title: String
    var subtitle: String? = nil
    let imageURL: URL?
    var progress: Double? = nil
    var width: CGFloat = 250

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            NavigationLink(value: value) {
                ZStack(alignment: .bottom) {
                    RemoteImage(url: imageURL, placeholder: title)
                    if let progress, progress > 0 { ProgressStrip(fraction: progress) }
                }
                .frame(width: width, height: width * 1.5)
                .clipped()
            }
            .buttonStyle(.card)

            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).lineLimit(1)
                if let subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(width: width, alignment: .leading)
        }
    }
}

/// 16:9 card with title over a gradient — Continue Watching.
struct WideCard: View {
    let title: String
    let subtitle: String?
    /// Tried in order: a still from where you stopped, then artwork.
    let imageURLs: [URL]
    let progress: Double?
    var width: CGFloat = 480

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            FallbackImage(urls: imageURLs)
            LinearGradient(colors: [.clear, .black.opacity(0.85)], startPoint: .center, endPoint: .bottom)
            VStack(alignment: .leading, spacing: 6) {
                Text(title).font(.headline).lineLimit(1)
                if let subtitle { Text(subtitle).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                if let progress { ProgressStrip(fraction: progress).clipShape(Capsule()) }
            }
            .padding(20)
        }
        .frame(width: width, height: width * 9 / 16)
        .clipped()
    }
}

/// A titled horizontal row of cards.
struct Shelf<Content: View>: View {
    let title: String
    let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 80)
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 40) { content }
                    .padding(.horizontal, 80)
                    .padding(.vertical, 30)
            }
            .scrollClipDisabled()
            // Up/down from any card reaches the next row (or the buttons above),
            // even when nothing focusable is directly above or below it.
            .focusSection()
        }
    }
}

/// Round profile picture, or the first letter on a gradient (orange for Streamlings).
struct ProfileAvatar: View {
    let profile: Profile
    var size: CGFloat = 200
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
                // Plays GIF profile pictures (AsyncImage only shows the first frame).
                AnimatedRemoteImage(url: url, maxPixelSize: size * 2)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }
}

/// Full-bleed artwork fading into the background.
struct Backdrop: View {
    let url: URL?

    var body: some View {
        ZStack {
            RemoteImage(url: url)
            LinearGradient(colors: [Theme.background.opacity(0.2), Theme.background], startPoint: .top, endPoint: .bottom)
            LinearGradient(colors: [Theme.background.opacity(0.9), .clear], startPoint: .leading, endPoint: .trailing)
        }
        .ignoresSafeArea()
    }
}

/// Apple Music–style background: the artwork, heavily blurred and darkened,
/// crossfading when it changes. The image is shrunk to a tiny thumbnail and
/// scaled back up, which softens it cheaply, so only a light blur is needed.
struct BlurredArtBackground: View {
    let url: URL?
    @State private var shown: UIImage?
    @State private var shownURL: URL?

    private static let cache = NSCache<NSURL, UIImage>()

    var body: some View {
        ZStack {
            Theme.background
            if let shown {
                Image(uiImage: shown)
                    .resizable()
                    .interpolation(.high)
                    .scaledToFill()
                    .blur(radius: 40, opaque: true)
                    .saturation(1.2)
                    .opacity(0.6)
                    .id(shownURL)
                    .transition(.opacity)
            }
            // Keep posters and text readable on bright artwork.
            LinearGradient(colors: [.black.opacity(0.35), .black.opacity(0.7)], startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
        .task(id: url) {
            guard let url, url != shownURL else { return }
            let image = await Self.thumbnail(url)
            guard !Task.isCancelled, let image else { return }
            withAnimation(.easeInOut(duration: 0.6)) {
                shown = image
                shownURL = url
            }
        }
    }

    private static func thumbnail(_ url: URL) async -> UIImage? {
        if let cached = cache.object(forKey: url as NSURL) { return cached }
        let result = try? await URLSession.shared.data(from: url)
        guard let result, let full = UIImage(data: result.0) else { return nil }
        let size = CGSize(width: 48, height: 72)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            full.draw(in: CGRect(origin: .zero, size: size))
        }
        cache.setObject(small, forKey: url as NSURL)
        return small
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
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .glassEffect(.regular, in: .capsule)
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
                case .empty:
                    Color(white: 0.14)
                @unknown default:
                    Color(white: 0.14)
                }
            }
            .id(index)
        } else {
            RemoteImage(url: nil, placeholder: placeholder)
        }
    }
}

/// The title's logo artwork, or the title as text if there isn't one.
struct TitleLogoView: View {
    let url: URL?
    let title: String
    var maxWidth: CGFloat = 820
    var maxHeight: CGFloat = 230
    var fontSize: CGFloat = 66

    var body: some View {
        if let url {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                        .frame(maxWidth: maxWidth, maxHeight: maxHeight, alignment: .leading)
                        .shadow(color: .black.opacity(0.6), radius: 16)
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
        Text(title).font(.system(size: fontSize, weight: .bold)).lineLimit(2).shadow(radius: 10)
    }
}

/// Poster for the Movies / TV Shows grids, `width` wide (2:3).
struct GridPoster<Value: Hashable>: View {
    let value: Value
    let title: String
    var subtitle: String? = nil
    let imageURL: URL?
    var progress: Double? = nil
    let width: CGFloat
    var onFocus: (() -> Void)? = nil
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: value) {
                ZStack(alignment: .bottom) {
                    RemoteImage(url: imageURL, placeholder: title)
                    if let progress, progress > 0 { ProgressStrip(fraction: progress) }
                }
                .frame(width: width, height: width * 1.5)
                .clipped()
            }
            .buttonStyle(.card)
            .focused($isFocused)
            .onChange(of: isFocused) { _, focused in
                if focused { onFocus?() }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.caption).lineLimit(1)
                if let subtitle { Text(subtitle).font(.caption2).foregroundStyle(.secondary).lineLimit(1) }
            }
            .frame(width: width, alignment: .leading)
        }
    }
}

/// Main action button (Play, Resume, More Info, Mark as Watched…), one look for all:
/// prominent = accent fill with dark text; otherwise Liquid Glass with white text;
/// focused = white fill with dark text, a little larger. (The system glass styles
/// tinted labels cyan, which showed as cyan-on-white when focused.)
struct ActionButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        ActionButton(configuration: configuration, prominent: prominent)
    }
}

private struct ActionButton: View {
    let configuration: ButtonStyleConfiguration
    let prominent: Bool
    @Environment(\.isFocused) private var isFocused
    @Environment(\.isEnabled) private var isEnabled

    private var fill: Color {
        if isFocused { return .white }
        return prominent ? Theme.accent : .clear
    }

    var body: some View {
        configuration.label
            .font(.body.weight(.semibold))
            .foregroundStyle(isFocused || prominent ? Color.black : Color.white)
            .padding(.horizontal, 36)
            .padding(.vertical, 18)
            .background(Capsule().fill(fill))
            .glassEffect(.regular, in: .capsule)
            .scaleEffect(configuration.isPressed ? 1.02 : (isFocused ? 1.06 : 1))
            .shadow(color: .black.opacity(isFocused ? 0.45 : 0), radius: 18, y: 8)
            .opacity(isEnabled ? 1 : 0.5)
            .animation(.easeOut(duration: 0.18), value: isFocused)
    }
}

/// Small capsule button (player Up Next card). Prominent: accent fill; otherwise a
/// dim fill. Focused: white fill, dark text, a little larger.
struct CompactButtonStyle: ButtonStyle {
    var prominent = false

    func makeBody(configuration: Configuration) -> some View {
        CompactButton(configuration: configuration, prominent: prominent)
    }
}

private struct CompactButton: View {
    let configuration: ButtonStyleConfiguration
    let prominent: Bool
    @Environment(\.isFocused) private var isFocused

    var body: some View {
        configuration.label
            .font(.caption.weight(.bold))
            .foregroundStyle(isFocused || prominent ? Color.black : Color.white)
            .padding(.horizontal, 22)
            .padding(.vertical, 10)
            .background(Capsule().fill(isFocused ? Color.white : (prominent ? Theme.accent : Color.white.opacity(0.15))))
            .scaleEffect(configuration.isPressed ? 1.0 : (isFocused ? 1.06 : 1))
            .shadow(color: .black.opacity(isFocused ? 0.45 : 0), radius: 12, y: 6)
            .animation(.easeOut(duration: 0.15), value: isFocused)
    }
}

/// "Cast" row: round headshots with names.
struct CastShelf: View {
    let cast: [CastMember]
    @EnvironmentObject private var session: Session

    var body: some View {
        Shelf("Cast") {
            ForEach(cast) { person in
                VStack(spacing: 12) {
                    // Focusable so the row can be browsed and scrolled to with the remote.
                    Button {} label: {
                        ZStack {
                            Circle().fill(Color(white: 0.16))
                            if let url = session.imageURL(person.profilePath) {
                                AsyncImage(url: url) { image in
                                    image.resizable().scaledToFill()
                                } placeholder: {
                                    Color.clear
                                }
                            } else {
                                Image(systemName: "person.fill").font(.system(size: 60)).foregroundStyle(.secondary)
                            }
                        }
                        .frame(width: 170, height: 170)
                        .clipShape(Circle())
                    }
                    .buttonStyle(AvatarButtonStyle())
                    Text(person.name).font(.caption.weight(.semibold)).lineLimit(1)
                    if let character = person.character, !character.isEmpty {
                        Text(character).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                .frame(width: 200)
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
}
