import SwiftUI

/// Requests (Search › Request a Film): find a film that isn't on the server and
/// ask for it. An admin approves or declines it (you're emailed either way);
/// approved films download by themselves, and My Requests follows them — with
/// a progress bar, speed and time left — until they're ready to watch.
struct RequestsView: View {
    enum Page: Hashable { case find, mine }

    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var page: Page
    @State private var query: String
    @State private var films: [FilmResult] = []
    @State private var searchedFor: String?
    @State private var searching = false
    @State private var mine: [MovieRequest]?
    @State private var config: RequestsConfig?
    @State private var asking: FilmResult?
    @State private var message: (text: String, error: Bool)?

    /// `page`: which part to open on; `query`: a search to start with (from Search).
    init(page: Page = .find, query: String = "") {
        _page = State(initialValue: page)
        _query = State(initialValue: query)
    }

    private var refresh: Double { max(1, config?.refreshSeconds ?? 2) }
    private var anyActive: Bool { (mine ?? []).contains { $0.isActive } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Page", selection: $page) {
                    Text("Request a Film").tag(Page.find)
                    Text(mine.map { $0.isEmpty ? "My Requests" : "My Requests · \($0.count)" } ?? "My Requests").tag(Page.mine)
                }
                .pickerStyle(.segmented)

                if let message {
                    Label(message.text, systemImage: message.error ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(message.error ? .red : .green)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                        .glassEffect(.regular.tint((message.error ? Color.red : Color.green).opacity(0.15)), in: .rect(cornerRadius: 12))
                        .transition(.opacity)
                }

                if config?.open == false {
                    ContentUnavailableView("Requests aren't available", systemImage: "film.stack",
                                           description: Text("Your Streamulus admin hasn't turned requests on."))
                } else if page == .find {
                    findPage
                } else {
                    minePage
                }
            }
            .padding(Metrics(sizeClass).margin)
        }
        .background(Theme.background)
        .navigationTitle("Requests")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search for a film")
        .onChange(of: query) { _, _ in if !query.isEmpty { page = .find } }
        .task { await start() }
        .task(id: query) { await search() }
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
            NavigationStack {
                AskForFilmSheet(film: film) { note in await send(film, note: note) }
            }
            .presentationDetents([.medium, .large])
        }
    }

    // MARK: Find

    @ViewBuilder private var findPage: some View {
        let text = query.trimmingCharacters(in: .whitespaces)
        HStack {
            Text(searchedFor.map { $0.isEmpty ? "Popular this week" : "Results for “\($0)”" } ?? " ")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
            if searching { ProgressView().controlSize(.small) }
        }
        if films.isEmpty && !searching && searchedFor != nil {
            ContentUnavailableView(text.isEmpty ? "Nothing to show" : "No films found", systemImage: "magnifyingglass",
                                   description: Text("Try another spelling, or add the year."))
        }
        LazyVGrid(columns: [GridItem(.adaptive(minimum: Metrics(sizeClass).gridMinimum), spacing: 12, alignment: .top)], alignment: .leading, spacing: 18) {
            ForEach(films) { film in
                FilmCard(film: film) {
                    if let state = film.request {
                        if state.mine { page = .mine } else { Task { await send(film, note: "") } }
                    } else {
                        asking = film
                    }
                }
            }
        }
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
            ForEach(mine) { request in
                RequestCard(request: request) { await cancel(request) }
            }
        } else {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
        }
    }

    // MARK: Loading

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
            let response = try await session.get("/api/requests/search", query: [URLQueryItem(name: "q", value: text)], as: FilmSearchResponse.self)
            guard !Task.isCancelled else { return }
            films = response.results
            searchedFor = response.query ?? text
        } catch {
            if !Task.isCancelled { show(error.localizedDescription, error: true) }
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
        withAnimation { message = (text, error) }
        Task {
            try? await Task.sleep(nanoseconds: 4_500_000_000)
            withAnimation { if message?.text == text { message = nil } }
        }
    }
}

// MARK: - Pieces

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
            .font(.caption2.weight(.bold))
            .foregroundStyle(RequestLook.color(status))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(RequestLook.color(status).opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(RequestLook.color(status).opacity(0.4)))
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

private struct FilmCard: View {
    let film: FilmResult
    let action: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Color.clear
                .aspectRatio(2 / 3, contentMode: .fit)
                .overlay { RemoteImage(url: film.posterUrl.flatMap(URL.init(string:)), placeholder: film.title) }
                .clipShape(.rect(cornerRadius: 10))
                .overlay(alignment: .topLeading) {
                    if let state = film.request {
                        StatusPill(status: state.status, label: state.label ?? state.status).padding(6)
                    }
                }
            Text(film.title).font(.subheadline.weight(.semibold)).lineLimit(2)
            Text([film.year.map(String.init), film.rating.flatMap { $0 > 0 ? String(format: "★ %.1f", $0) : nil }].compactMap { $0 }.joined(separator: " · "))
                .font(.caption).foregroundStyle(.secondary)
            if film.request == nil {
                Button(action: action) { buttonLabel("Request") }
                    .buttonStyle(.glassProminent)
                    .controlSize(.small)
            } else {
                Button(action: action) { buttonLabel(film.request?.mine == true ? "See Progress" : "Me Too") }
                    .buttonStyle(.glass)
                    .controlSize(.small)
            }
        }
    }

    private func buttonLabel(_ text: String) -> some View {
        Text(text).font(.subheadline.weight(.semibold)).frame(maxWidth: .infinity)
    }
}

private struct RequestCard: View {
    let request: MovieRequest
    let onCancel: () async -> Void
    @State private var confirmCancel = false

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Color.clear
                .frame(width: 66, height: 99)
                .overlay { RemoteImage(url: request.posterUrl.flatMap(URL.init(string:))) }
                .clipShape(.rect(cornerRadius: 8))
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(request.title).font(.headline).lineLimit(2)
                    if let year = request.year { Text(String(year)).font(.subheadline).foregroundStyle(.secondary) }
                }
                StatusPill(status: request.status, label: request.label)
                RequestSteps(status: request.status)
                if ["downloading", "searching", "importing", "adding"].contains(request.status) {
                    HStack(spacing: 10) {
                        RequestProgressBar(status: request.status, progress: request.progress ?? 0)
                        if request.status == "downloading" {
                            Text("\(Int(((request.progress ?? 0) * 100).rounded()))%")
                                .font(.caption.weight(.bold).monospacedDigit())
                                .foregroundStyle(Theme.accent)
                        }
                    }
                }
                if let detail = request.detail {
                    Text(detail).font(.footnote).foregroundStyle(["not_found", "failed", "missing"].contains(request.status) ? .orange : .secondary)
                }
                if request.status == "pending" {
                    Text("Waiting for an admin to approve it — you'll get an email either way.").font(.footnote).foregroundStyle(.secondary)
                }
                if request.status == "declined" {
                    Text("Not approved\(request.decidedBy.map { " by \($0)" } ?? "").\(request.declineReason.map { " “\($0)”" } ?? "")")
                        .font(.footnote).foregroundStyle(.red.opacity(0.85))
                }
                Text(request.mine == false ? "Asked for by \(request.requestedBy ?? "someone")" : "You asked\((request.others ?? 0) > 0 ? " · and \(request.others!) other\(request.others == 1 ? "" : "s")" : "")")
                    .font(.caption).foregroundStyle(.tertiary)
                HStack {
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
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .glassEffect(.regular.tint(request.status == "available" ? Color.green.opacity(0.1) : .clear), in: .rect(cornerRadius: 16))
        .confirmationDialog("Cancel your request for \(request.title)?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel Request", role: .destructive) { Task { await onCancel() } }
        }
    }
}

/// The film page for a request that's ready (fetched by its id).
private struct RequestedMovieView: View {
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

private struct AskForFilmSheet: View {
    let film: FilmResult
    let send: (String) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var sending = false

    var body: some View {
        Form {
            Section {
                HStack(alignment: .top, spacing: 14) {
                    Color.clear
                        .frame(width: 72, height: 108)
                        .overlay { RemoteImage(url: film.posterUrl.flatMap(URL.init(string:))) }
                        .clipShape(.rect(cornerRadius: 8))
                    VStack(alignment: .leading, spacing: 6) {
                        Text(film.title).font(.headline)
                        if let year = film.year { Text(String(year)).foregroundStyle(.secondary) }
                        if let overview = film.overview { Text(overview).font(.footnote).foregroundStyle(.secondary).lineLimit(4) }
                    }
                }
            }
            Section {
                TextField("e.g. the 2021 version, please", text: $note, axis: .vertical)
                    .lineLimit(2...4)
            } header: {
                Text("A note for the admin · optional")
            } footer: {
                Text("You'll get an email when an admin approves or declines it, and again when it's ready to watch.")
            }
        }
        .navigationTitle("Request")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(sending ? "Sending…" : "Send") {
                    sending = true
                    Task {
                        await send(String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500)))
                        sending = false
                    }
                }
                .disabled(sending)
            }
        }
    }
}
