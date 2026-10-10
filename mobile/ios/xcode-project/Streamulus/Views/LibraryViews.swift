import SwiftUI

struct MovieLibraryView: View {
    @EnvironmentObject private var session: Session
    @State private var movies: [Movie] = []
    @State private var filter = ""
    @State private var loading = true
    @State private var errorText: String?

    private var shown: [Movie] {
        let text = filter.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? movies : movies.filter { $0.title.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        LibraryGrid(
            items: shown,
            title: { $0.title },
            subtitle: { $0.year.map { String($0) } },
            imageURL: { session.imageURL($0.posterPath) },
            progress: { movie in
                guard movie.watchPosition > 10, !movie.watchCompleted, let duration = movie.duration, duration > 0 else { return nil }
                return Double(movie.watchPosition) / Double(duration)
            }
        )
        .overlay { LibraryStatus(loading: loading, errorText: errorText, isEmpty: movies.isEmpty, emptyText: "No movies yet") }
        .navigationTitle("Movies")
        .searchable(text: $filter, prompt: "Filter movies")
        .accountButton()
        .mediaDestinations()
        .refreshable { await load() }
        .task(id: session.profile) { await load() }
    }

    private func load() async {
        do {
            let response: MoviesResponse = try await session.get("/api/movies", query: [
                URLQueryItem(name: "sort", value: "title"),
                URLQueryItem(name: "order", value: "ASC"),
                URLQueryItem(name: "limit", value: "5000"),
            ])
            movies = response.movies
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        loading = false
    }
}

struct ShowLibraryView: View {
    @EnvironmentObject private var session: Session
    @State private var shows: [Show] = []
    @State private var filter = ""
    @State private var loading = true
    @State private var errorText: String?

    private var shown: [Show] {
        let text = filter.trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? shows : shows.filter { $0.title.localizedCaseInsensitiveContains(text) }
    }

    var body: some View {
        LibraryGrid(
            items: shown,
            title: { $0.title },
            subtitle: { show in
                show.totalEpisodes > 0 && show.watchedEpisodes >= show.totalEpisodes ? "Watched" : show.year
            },
            imageURL: { session.imageURL($0.posterPath) }
        )
        .overlay { LibraryStatus(loading: loading, errorText: errorText, isEmpty: shows.isEmpty, emptyText: "No TV shows yet") }
        .navigationTitle("TV Shows")
        .searchable(text: $filter, prompt: "Filter shows")
        .accountButton()
        .mediaDestinations()
        .refreshable { await load() }
        .task(id: session.profile) { await load() }
    }

    private func load() async {
        do {
            let response: ShowsResponse = try await session.get("/api/tv", query: [
                URLQueryItem(name: "sort", value: "title"),
                URLQueryItem(name: "order", value: "ASC"),
                URLQueryItem(name: "limit", value: "5000"),
            ])
            shows = response.shows
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        loading = false
    }
}

struct LibraryStatus: View {
    let loading: Bool
    let errorText: String?
    let isEmpty: Bool
    let emptyText: String

    var body: some View {
        if loading && isEmpty {
            ProgressView()
        } else if let errorText, isEmpty {
            ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(errorText))
        } else if isEmpty {
            ContentUnavailableView(emptyText, systemImage: "film.stack")
        }
    }
}

/// A–Z poster grid grouped under letters, with an index down the right edge
/// you can tap or drag along (like Contacts).
struct LibraryGrid<Item: Identifiable & Hashable>: View where Item.ID == Int {
    let items: [Item]
    let title: (Item) -> String
    let subtitle: (Item) -> String?
    let imageURL: (Item) -> URL?
    var progress: (Item) -> Double? = { _ in nil }
    /// Shown above the grid, scrolling with it (e.g. a genre's filter).
    var header: AnyView? = nil

    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var bubble: String?
    @State private var bubbleTask: Task<Void, Never>?

    struct LetterGroup: Identifiable {
        let letter: String
        var items: [Item]
        var id: String { letter }
    }

    /// Each letter once ("#" first, then A–Z), titles sorted ignoring The / A / An.
    private var groups: [LetterGroup] {
        var byLetter: [String: [Item]] = [:]
        for item in items { byLetter[Self.indexLetter(title(item)), default: []].append(item) }
        return byLetter.keys
            .sorted { $0 == "#" ? $1 != "#" : ($1 == "#" ? false : $0 < $1) }
            .map { letter in
                LetterGroup(letter: letter, items: byLetter[letter, default: []].sorted {
                    Self.sortKey(title($0)).localizedCaseInsensitiveCompare(Self.sortKey(title($1))) == .orderedAscending
                })
            }
    }

    static func sortKey(_ title: String) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespaces)
        for article in ["The ", "A ", "An "] where trimmed.count > article.count && trimmed.hasPrefix(article) {
            return String(trimmed.dropFirst(article.count))
        }
        return trimmed
    }

    /// "Élite" → E, "'Salem's Lot" → S, "2 Fast 2 Furious" → #.
    static func indexLetter(_ title: String) -> String {
        let folded = sortKey(title).folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US"))
        let start = folded.drop { !$0.isLetter && !$0.isNumber }
        guard let first = start.uppercased().first, first.isASCII, first.isLetter else { return "#" }
        return String(first)
    }

    var body: some View {
        let groups = self.groups
        let m = Metrics(sizeClass)
        let showIndex = groups.count > 1
        ScrollViewReader { proxy in
            ScrollView {
                if let header { header }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: m.gridMinimum), spacing: 12, alignment: .top)],
                          alignment: .leading, spacing: 18) {
                    ForEach(groups) { group in
                        Section {
                            ForEach(group.items) { item in
                                PosterCard(value: item, title: title(item), subtitle: subtitle(item),
                                           imageURL: imageURL(item), progress: progress(item))
                            }
                        } header: {
                            Text(group.letter)
                                .font(.headline.weight(.heavy))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 6)
                                .id("letter-\(group.letter)")
                        }
                    }
                }
                .padding(.leading, m.margin)
                .padding(.trailing, showIndex ? 30 : m.margin)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.immediately)
            .overlay(alignment: .trailing) {
                if showIndex {
                    GeometryReader { geo in
                        AlphabetIndex(letters: groups.map(\.letter), maxHeight: geo.size.height - 24) { letter in
                            proxy.scrollTo("letter-\(letter)", anchor: .top)
                            flash(letter)
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
                    }
                    .frame(width: 30)
                    .padding(.trailing, 2)
                }
            }
            .overlay {
                if let bubble {
                    Text(bubble)
                        .font(.system(size: 56, weight: .heavy))
                        .frame(width: 104, height: 104)
                        .glassEffect(.regular, in: .rect(cornerRadius: 24))
                        .transition(.opacity.combined(with: .scale(scale: 0.9)))
                        .allowsHitTesting(false)
                }
            }
            .animation(.easeOut(duration: 0.15), value: bubble)
        }
        .background(Theme.background)
    }

    private func flash(_ letter: String) {
        bubble = letter
        bubbleTask?.cancel()
        bubbleTask = Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            if !Task.isCancelled { bubble = nil }
        }
    }
}

/// Letters down the right edge: tap one, or drag along them.
struct AlphabetIndex: View {
    let letters: [String]
    let maxHeight: CGFloat
    let onSelect: (String) -> Void
    @State private var current: String?

    var body: some View {
        let row = max(9, min(16, maxHeight / CGFloat(max(letters.count, 1))))
        VStack(spacing: 0) {
            ForEach(letters, id: \.self) { letter in
                Text(letter)
                    .font(.system(size: min(11, row * 0.75), weight: .bold))
                    .foregroundStyle(letter == current ? Theme.accent : .secondary)
                    .frame(width: 24, height: row)
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let index = Int((value.location.y - 6) / row)
                    guard letters.indices.contains(index) else { return }
                    let letter = letters[index]
                    if letter != current {
                        current = letter
                        UISelectionFeedbackGenerator().selectionChanged()
                        onSelect(letter)
                    }
                }
                .onEnded { _ in current = nil }
        )
        .accessibilityElement()
        .accessibilityLabel("Index")
        .accessibilityAdjustableAction { direction in
            let index = letters.firstIndex(of: current ?? letters[0]) ?? 0
            let next = direction == .increment ? min(index + 1, letters.count - 1) : max(index - 1, 0)
            current = letters[next]
            onSelect(letters[next])
        }
    }
}
