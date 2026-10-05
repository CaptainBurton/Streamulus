import SwiftUI

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
                AsyncImage(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Color.clear
                }
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

/// Poster that fills its grid column (Movies / TV Shows tabs).
struct GridPoster<Value: Hashable>: View {
    let value: Value
    let title: String
    var subtitle: String? = nil
    let imageURL: URL?
    var progress: Double? = nil
    var onFocus: (() -> Void)? = nil
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink(value: value) {
                ZStack(alignment: .bottom) {
                    RemoteImage(url: imageURL, placeholder: title)
                    if let progress, progress > 0 { ProgressStrip(fraction: progress) }
                }
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .frame(maxWidth: .infinity)
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
        }
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
