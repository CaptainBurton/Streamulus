import SwiftUI

/// Requests (Search › Request a Film): find a film that isn't on the server — by
/// title, actor or director, year or genre — open it to read about it, and ask
/// for it. An admin approves or declines it (you're emailed either way); approved
/// films download by themselves, and My Requests follows them with a progress
/// bar, speed and time left until they're ready to watch.
struct RequestsView: View {
    enum Page: Hashable { case find, mine }
    enum Mode: Hashable { case films, people }

    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var page: Page
    @State private var mode: Mode = .films
    @State private var query: String
    @State private var year: Int?
    @State private var genre: Int?
    @State private var films: [FilmResult] = []
    @State private var people: [PersonResult] = []
    @State private var shownFor: String?
    @State private var searching = false
    @State private var mine: [MovieRequest]?
    @State private var config: RequestsConfig?
    @State private var asking: FilmResult?
    @State private var message: RequestMessage?

    /// `page`: which part to open on; `query`: a search to start with (from Search).
    init(page: Page = .find, query: String = "") {
        _page = State(initialValue: page)
        _query = State(initialValue: query)
    }

    private var refresh: Double { max(1, config?.refreshSeconds ?? 2) }
    private var anyActive: Bool { (mine ?? []).contains { $0.isActive } }
    private var searchKey: String { "\(mode)|\(query.trimmingCharacters(in: .whitespaces))|\(year ?? 0)|\(genre ?? 0)" }
    private var genreName: String? { genre.flatMap { id in config?.genres?.first { $0.id == id }?.name } }

    var body: some View {
        let m = Metrics(sizeClass)
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Picker("Page", selection: $page) {
                    Text("Request a Film").tag(Page.find)
                    Text(mine.map { $0.isEmpty ? "My Requests" : "My Requests · \($0.count)" } ?? "My Requests").tag(Page.mine)
                }
                .pickerStyle(.segmented)

                if let message { RequestBanner(message: message) }

                if config?.open == false {
                    ContentUnavailableView("Requests aren't available", systemImage: "film.stack",
                                           description: Text("Your Streamulus admin hasn't turned requests on."))
                } else if page == .find {
                    findPage(m)
                } else {
                    minePage
                }
            }
            .padding(m.margin)
        }
        .background(Theme.background)
        .navigationTitle("Requests")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always),
                    prompt: mode == .films ? "Search films" : "Search actors and directors")
        .onChange(of: query) { _, _ in if !query.isEmpty { page = .find } }
        .task { await start() }
        .task(id: searchKey) { await search() }
        // Keep following downloads while anything is on the go.
        .task(id: anyActive) {
            guard anyActive else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(refresh * 1_000_000_000))
                if Task.isCancelled { break }
                await loadMine()
            }
        }
        .refreshable { await loadMine(); await search() }
        .sheet(item: $asking) { film in
            AskForFilmSheet(film: film) { note in await send(film, note: note) }
        }
    }

    // MARK: Find

    @ViewBuilder private func findPage(_ m: Metrics) -> some View {
        filterBar
        HStack(spacing: 8) {
            Text(heading).font(.title3.weight(.bold))
            if searching { ProgressView().controlSize(.small) }
        }
        if mode == .people {
            if query.trimmingCharacters(in: .whitespaces).isEmpty {
                hint("person.crop.rectangle.stack", "Search for an actor or director to see all of their films.")
            } else if people.isEmpty && !searching && shownFor != nil {
                hint("person.fill.questionmark", "Nobody found — check the spelling.")
            }
            LazyVStack(spacing: 10) {
                ForEach(people) { person in
                    NavigationLink { PersonView(personId: person.id, name: person.name) } label: { PersonRow(person: person) }
                        .buttonStyle(.plain)
                }
            }
        } else {
            if films.isEmpty && !searching && shownFor != nil {
                hint("magnifyingglass", "No films found — try another spelling, or change the year or genre.")
            }
            FilmGrid(films: films, minimum: m.gridMinimum) { film in act(on: film) }
        }
    }

    private var heading: String {
        let text = query.trimmingCharacters(in: .whitespaces)
        if mode == .people { return text.isEmpty ? "Actors & Directors" : "People matching “\(text)”" }
        if !text.isEmpty { return "Results for “\(text)”" + (year.map { " · \($0)" } ?? "") + (genreName.map { " · \($0)" } ?? "") }
        switch (year, genreName) {
        case let (year?, genre?): return "\(genre) films from \(year)"
        case let (year?, nil): return "Films from \(year)"
        case let (nil, genre?): return "\(genre) films"
        default: return "Popular this week"
        }
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterChip(title: "Films", systemImage: "film", asset: "RequestsFilms", selected: mode == .films) { mode = .films }
                FilterChip(title: "Actors", systemImage: "person.fill", asset: "RequestsActors", selected: mode == .people) { mode = .people }
                if mode == .films {
                    Divider().frame(height: 22).padding(.horizontal, 2)
                    Menu {
                        Picker("Year", selection: $year) {
                            Text("Any year").tag(Int?.none)
                            ForEach(years, id: \.self) { Text(String($0)).tag(Int?.some($0)) }
                        }
                    } label: {
                        FilterChipLabel(title: year.map(String.init) ?? "Year", systemImage: "calendar", selected: year != nil, menu: true)
                    }
                    Menu {
                        Picker("Genre", selection: $genre) {
                            Text("Any genre").tag(Int?.none)
                            ForEach(config?.genres ?? []) { Text($0.name).tag(Int?.some($0.id)) }
                        }
                    } label: {
                        FilterChipLabel(title: genreName ?? "Genre", systemImage: "theatermasks", selected: genre != nil, menu: true)
                    }
                    if year != nil || genre != nil {
                        Button { withAnimation { year = nil; genre = nil } } label: {
                            Image(systemName: "xmark.circle.fill").font(.title3).foregroundStyle(.secondary)
                        }
                        .accessibilityLabel("Clear filters")
                    }
                }
            }
            .padding(.vertical, 2)
        }
    }

    private var years: [Int] {
        let now = Calendar.current.component(.year, from: Date())
        return Array((1920...(now + 1)).reversed())
    }

    private func hint(_ icon: String, _ text: String) -> some View {
        Label(text, systemImage: icon)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 8)
    }

    // MARK: Mine

    @ViewBuilder private var minePage: some View {
        if let mine {
            if mine.isEmpty {
                ContentUnavailableView {
                    Label("No requests yet", systemImage: "film.stack")
                } description: {
                    Text("Ask for a film that isn't on Streamulus — you'll get an email when it's ready.")
                } actions: {
                    Button("Request a Film") { page = .find }.buttonStyle(.glassProminent)
                }
            }
            LazyVStack(spacing: 14) {
                ForEach(mine) { request in
                    RequestCard(request: request) { await cancel(request) }
                }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        }
    }

    // MARK: Loading and asking

    private func start() async {
        config = try? await session.get("/api/requests/config", as: RequestsConfig.self)
        guard config?.open == true else { return }
        await loadMine()
        // Something on the go (e.g. opened from an email): show its progress first.
        if query.isEmpty, (mine ?? []).contains(where: { $0.isActive || $0.status == "available" }) { page = .mine }
    }

    private func loadMine() async {
        guard config?.open != false else { return }
        let response = try? await session.get("/api/requests", as: MyRequestsResponse.self)
        if let response {
            withAnimation(.easeInOut(duration: 0.3)) { mine = response.requests }
        }
    }

    private func search() async {
        let text = query.trimmingCharacters(in: .whitespaces)
        if !text.isEmpty { try? await Task.sleep(nanoseconds: 350_000_000) } // wait until typing pauses
        guard !Task.isCancelled, config?.open != false else { return }
        searching = true
        defer { searching = false }
        do {
            if mode == .people {
                guard !text.isEmpty else { people = []; shownFor = nil; return }
                let response = try await session.get("/api/requests/people", query: [URLQueryItem(name: "q", value: text)], as: PeopleResponse.self)
                guard !Task.isCancelled else { return }
                people = response.people
            } else {
                var items = [URLQueryItem(name: "q", value: text)]
                if let year { items.append(URLQueryItem(name: "year", value: String(year))) }
                if let genre { items.append(URLQueryItem(name: "genre", value: String(genre))) }
                let response = try await session.get("/api/requests/search", query: items, as: FilmSearchResponse.self)
                guard !Task.isCancelled else { return }
                withAnimation(.easeOut(duration: 0.2)) { films = response.results }
            }
            shownFor = searchKey
        } catch {
            if !Task.isCancelled { show(error.localizedDescription, error: true) }
        }
    }

    /// The button under a film: Request (asks for a note), See Progress, or Me Too.
    private func act(on film: FilmResult) {
        if let state = film.request {
            if state.mine { page = .mine } else { Task { await send(film, note: "") } }
        } else {
            asking = film
        }
    }

    private func send(_ film: FilmResult, note: String) async {
        do {
            let response = try await session.post("/api/requests", body: ["tmdbId": film.tmdbId, "note": note], as: CreateRequestResponse.self)
            asking = nil
            show(response.joined == true ? "Someone had already asked for \(film.title) — you'll hear when it's ready too"
                : "Requested \(film.title) — you'll get an email when an admin decides")
            await loadMine()
            await search()
        } catch {
            show(error.localizedDescription, error: true)
        }
    }

    private func cancel(_ request: MovieRequest) async {
        do {
            _ = try await session.delete("/api/requests/\(request.id)", as: CancelRequestResponse.self)
            show("Cancelled your request for \(request.title)")
            await loadMine()
        } catch {
            show(error.localizedDescription, error: true)
        }
    }

    private func show(_ text: String, error: Bool = false) {
        let next = RequestMessage(text: text, error: error)
        withAnimation { message = next }
        Task {
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            withAnimation { if message == next { message = nil } }
        }
    }
}

// MARK: - Shared pieces (also used by the film and person pages)

struct RequestMessage: Equatable {
    let id = UUID()
    let text: String
    let error: Bool
}

struct RequestBanner: View {
    let message: RequestMessage
    var body: some View {
        Label(message.text, systemImage: message.error ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background((message.error ? Color.red : Color.green).opacity(0.22), in: .rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder((message.error ? Color.red : Color.green).opacity(0.45)))
            .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/// What each status looks like.
enum RequestLook {
    static func color(_ status: String) -> Color {
        switch status {
        case "pending": return Theme.streamling
        case "declined", "failed": return .red
        case "not_found", "missing": return .orange
        case "importing", "adding": return .purple
        case "available": return .green
        case "waiting_release": return .indigo
        default: return Theme.accent
        }
    }

    static let steps = ["Requested", "Approved", "Downloading", "Moving in", "Ready"]
    static func step(_ status: String) -> Int {
        switch status {
        case "searching", "waiting_release", "not_found", "missing": return 1
        case "downloading", "failed": return 2
        case "importing", "adding": return 3
        case "available": return 4
        default: return 0
        }
    }
}

struct StatusPill: View {
    let status: String
    let label: String

    var body: some View {
        Text(label.uppercased())
            .font(.caption2.weight(.heavy))
            .foregroundStyle(RequestLook.color(status))
            .lineLimit(1)
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(.black.opacity(0.55), in: Capsule())
            .background(RequestLook.color(status).opacity(0.18), in: Capsule())
            .overlay(Capsule().strokeBorder(RequestLook.color(status).opacity(0.55)))
    }
}

struct FilterChip: View {
    let title: String
    let systemImage: String
    var asset: String? = nil
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: { withAnimation(.snappy) { action() } }) {
            FilterChipLabel(title: title, systemImage: systemImage, asset: asset, selected: selected, menu: false)
        }
        .buttonStyle(.plain)
    }
}

struct FilterChipLabel: View {
    let title: String
    let systemImage: String
    /// An icon from the asset catalog (drawn in the text colour) in place of the SF Symbol.
    var asset: String? = nil
    let selected: Bool
    let menu: Bool

    var body: some View {
        HStack(spacing: 6) {
            if let asset {
                Image(asset).renderingMode(.template).resizable().scaledToFit().frame(height: 15)
            } else {
                Image(systemName: systemImage).font(.footnote.weight(.semibold))
            }
            Text(title).font(.subheadline.weight(.semibold))
            if menu { Image(systemName: "chevron.down").font(.caption2.weight(.bold)).opacity(0.7) }
        }
        .foregroundStyle(selected ? .black : .white)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(selected ? AnyShapeStyle(Color.white) : AnyShapeStyle(Color.white.opacity(0.1)), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.white.opacity(selected ? 0 : 0.15)))
        .contentShape(Capsule())
    }
}

/// Downloading: the real percentage. Searching: a short bar sliding across and
/// out of sight before it starts again. Moving in: a full, gently pulsing bar.
struct RequestProgressBar: View {
    let status: String
    let progress: Double

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.1))
                switch status {
                case "searching":
                    TimelineView(.animation) { context in
                        let cycle = 1.6
                        let t = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: cycle) / cycle
                        let eased = t < 0.5 ? 2 * t * t : 1 - pow(-2 * t + 2, 2) / 2
                        let width = geo.size.width * 0.3
                        Capsule()
                            .fill(LinearGradient(colors: [.clear, Theme.accent, .clear], startPoint: .leading, endPoint: .trailing))
                            .frame(width: width)
                            .offset(x: -width + eased * (geo.size.width + width))
                    }
                case "importing", "adding":
                    PulsingFill()
                default:
                    Capsule()
                        .fill(Theme.logoGradient)
                        .frame(width: geo.size.width * min(max(progress, 0), 1))
                        .animation(.easeInOut(duration: 0.8), value: progress)
                }
            }
            .clipShape(Capsule())
        }
        .frame(height: 8)
    }
}

private struct PulsingFill: View {
    @State private var dim = false
    var body: some View {
        Capsule()
            .fill(Theme.logoGradient)
            .opacity(dim ? 0.55 : 1)
            .onAppear { withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { dim = true } }
    }
}

struct RequestSteps: View {
    let status: String

    var body: some View {
        let at = RequestLook.step(status)
        let problem = ["declined", "not_found", "failed", "missing"].contains(status)
        HStack(spacing: 4) {
            ForEach(Array(RequestLook.steps.enumerated()), id: \.offset) { index, name in
                let done = index < at || (index == at && status == "available")
                let here = index == at && status != "available"
                Circle()
                    .fill(done ? Theme.accent : here ? (problem ? RequestLook.color(status) : Theme.accent) : .clear)
                    .overlay(Circle().strokeBorder(done || here ? (here && problem ? RequestLook.color(status) : Theme.accent) : Color.white.opacity(0.25), lineWidth: 1.5))
                    .frame(width: 7, height: 7)
                if index == at {
                    Text(name).font(.caption2.weight(.semibold)).foregroundStyle(.primary)
                }
                if index < RequestLook.steps.count - 1 {
                    Rectangle().fill(index < at ? Theme.accent.opacity(0.6) : Color.white.opacity(0.12)).frame(width: 10, height: 1.5)
                }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(at + 1) of \(RequestLook.steps.count): \(RequestLook.steps[at])")
    }
}

/// A grid of films: tap a poster to read about the film; the button underneath requests it.
struct FilmGrid: View {
    let films: [FilmResult]
    let minimum: CGFloat
    let action: (FilmResult) -> Void

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: 14, alignment: .top)], alignment: .leading, spacing: 20) {
            ForEach(films) { film in
                FilmCard(film: film) { action(film) }
            }
        }
    }
}

struct FilmCard: View {
    let film: FilmResult
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            NavigationLink {
                FilmDetailView(tmdbId: film.tmdbId, title: film.title)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    Color.clear
                        .aspectRatio(2 / 3, contentMode: .fit)
                        .overlay { RemoteImage(url: film.posterUrl.flatMap(URL.init(string:)), placeholder: film.title) }
                        .clipShape(.rect(cornerRadius: 12))
                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.08)))
                        .shadow(color: .black.opacity(0.5), radius: 8, y: 4)
                        .overlay(alignment: .topLeading) {
                            if let state = film.request {
                                StatusPill(status: state.status, label: state.label ?? state.status).padding(6)
                            }
                        }
                        .overlay(alignment: .bottomTrailing) {
                            if let rating = film.rating, rating > 0 {
                                Label(String(format: "%.1f", rating), systemImage: "star.fill")
                                    .font(.caption2.weight(.bold))
                                    .foregroundStyle(.white)
                                    .padding(.horizontal, 7).padding(.vertical, 3)
                                    .background(.black.opacity(0.65), in: Capsule())
                                    .padding(6)
                            }
                        }
                    Text(film.title).font(.subheadline.weight(.semibold)).foregroundStyle(.white).lineLimit(2)
                    Text([film.year.map(String.init), film.role].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.white.opacity(0.6)).lineLimit(1)
                }
            }
            .buttonStyle(.plain)
            if film.request == nil {
                Button(action: action) { buttonLabel("Request", icon: "plus") }
                    .buttonStyle(.glassProminent)
                    .controlSize(.small)
            } else {
                Button(action: action) { buttonLabel(film.request?.mine == true ? "See Progress" : "Me Too", icon: film.request?.mine == true ? "chart.bar.fill" : "hand.raised.fill") }
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
        }
    }

    private func buttonLabel(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
    }
}

struct PersonRow: View {
    let person: PersonResult

    var body: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(Color.white.opacity(0.08))
                .frame(width: 58, height: 58)
                .overlay {
                    if let url = person.profileUrl.flatMap(URL.init(string:)) {
                        RemoteImage(url: url)
                    } else {
                        Image(systemName: "person.fill").font(.title2).foregroundStyle(.white.opacity(0.4))
                    }
                }
                .clipShape(Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(person.name).font(.headline).foregroundStyle(.white)
                Text([person.department == "Acting" ? "Actor" : person.department, person.knownFor.isEmpty ? nil : person.knownFor.joined(separator: ", ")].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.white.opacity(0.6)).lineLimit(2)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.white.opacity(0.35))
        }
        .padding(12)
        .background(Color.white.opacity(0.06), in: .rect(cornerRadius: 16))
        .contentShape(.rect(cornerRadius: 16))
    }
}

private struct RequestCard: View {
    let request: MovieRequest
    let onCancel: () async -> Void
    @State private var confirmCancel = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            NavigationLink {
                FilmDetailView(tmdbId: request.tmdbId, title: request.title)
            } label: {
                HStack(alignment: .top, spacing: 14) {
                    Color.clear
                        .frame(width: 70, height: 105)
                        .overlay { RemoteImage(url: request.posterUrl.flatMap(URL.init(string:))) }
                        .clipShape(.rect(cornerRadius: 10))
                        .shadow(color: .black.opacity(0.4), radius: 6, y: 3)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(request.title).font(.headline).foregroundStyle(.white).lineLimit(2)
                            if let year = request.year { Text(String(year)).font(.subheadline).foregroundStyle(.white.opacity(0.55)) }
                        }
                        StatusPill(status: request.status, label: request.label)
                        RequestSteps(status: request.status)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.3))
                }
            }
            .buttonStyle(.plain)

            if ["downloading", "searching", "importing", "adding"].contains(request.status) {
                HStack(spacing: 10) {
                    RequestProgressBar(status: request.status, progress: request.progress ?? 0)
                    if request.status == "downloading" {
                        Text("\(Int(((request.progress ?? 0) * 100).rounded()))%")
                            .font(.subheadline.weight(.bold).monospacedDigit())
                            .foregroundStyle(Theme.accent)
                    }
                }
            }
            if let detail = request.detail {
                Text(detail).font(.subheadline).foregroundStyle(["not_found", "failed", "missing"].contains(request.status) ? .orange : .white.opacity(0.75))
            }
            if request.status == "pending" {
                Text("Waiting for an admin to approve it — you'll get an email either way.").font(.subheadline).foregroundStyle(.white.opacity(0.7))
            }
            if request.status == "declined" {
                DeclineNote(by: request.decidedBy, note: request.declineReason)
            }
            HStack(spacing: 10) {
                Text(request.mine == false ? "Asked for by \(request.requestedBy ?? "someone")" : "You asked\((request.others ?? 0) > 0 ? " · and \(request.others!) other\(request.others == 1 ? "" : "s")" : "")")
                    .font(.caption).foregroundStyle(.white.opacity(0.45))
                Spacer()
                if request.status == "available", let movieId = request.movieId {
                    NavigationLink {
                        RequestedMovieView(movieId: movieId)
                    } label: {
                        Label("Watch Now", systemImage: "play.fill").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.glassProminent)
                }
                if request.status == "pending" {
                    Button("Cancel Request", role: .destructive) { confirmCancel = true }
                        .font(.subheadline)
                        .buttonStyle(.glass)
                }
            }
        }
        .padding(16)
        .background(request.status == "available" ? Color.green.opacity(0.08) : Color.white.opacity(0.06), in: .rect(cornerRadius: 20))
        .overlay(RoundedRectangle(cornerRadius: 20).strokeBorder(request.status == "available" ? Color.green.opacity(0.35) : Color.white.opacity(0.08)))
        .confirmationDialog("Cancel your request for \(request.title)?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel Request", role: .destructive) { Task { await onCancel() } }
        }
    }
}

/// Why a request was declined, in the admin's words.
struct DeclineNote: View {
    let by: String?
    let note: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(note == nil ? "Not approved\(by.map { " by \($0)" } ?? "")" : "Note from \(by ?? "the admin")",
                  systemImage: note == nil ? "xmark.circle.fill" : "text.bubble.fill")
                .font(.caption.weight(.bold))
                .foregroundStyle(Color(red: 1, green: 0.55, blue: 0.55))
            if let note {
                Text(note).font(.subheadline).foregroundStyle(.white)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color.red.opacity(0.14), in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.red.opacity(0.35)))
    }
}

/// The film page for a request that's ready (fetched by its id).
struct RequestedMovieView: View {
    let movieId: Int
    @EnvironmentObject private var session: Session
    @State private var movie: Movie?
    @State private var failed = false

    var body: some View {
        Group {
            if let movie {
                MovieDetailView(movie: movie)
            } else if failed {
                ContentUnavailableView("Couldn't open the film", systemImage: "exclamationmark.triangle")
            } else {
                ProgressView()
            }
        }
        .task {
            do { movie = try await session.get("/api/movies/\(movieId)", as: MovieEnvelope.self).movie } catch { failed = true }
        }
    }
}
