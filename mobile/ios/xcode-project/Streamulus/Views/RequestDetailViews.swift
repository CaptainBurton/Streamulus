import SwiftUI

// MARK: - A film's page (Requests)

/// Everything about a film that isn't on the server (or is, or has been asked
/// for): backdrop and poster, year, running time, rating, genres, synopsis,
/// director and cast (tap a person for all their films), the trailer, and the
/// Request button.
struct FilmDetailView: View {
    let tmdbId: Int
    let title: String

    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var film: FilmDetail?
    @State private var failed: String?
    @State private var asking = false
    @State private var message: RequestMessage?
    @State private var trailer: BrowserPage?
    @State private var showWholeSynopsis = false

    var body: some View {
        let m = Metrics(sizeClass)
        ScrollView {
            if let film {
                VStack(alignment: .leading, spacing: 0) {
                    header(film, m)
                    VStack(alignment: .leading, spacing: 22) {
                        if let message { RequestBanner(message: message) }
                        actions(film)
                        if let tagline = film.tagline {
                            Text("“\(tagline)”").font(.title3.italic()).foregroundStyle(.white.opacity(0.85))
                        }
                        if !film.genres.isEmpty { genreChips(film.genres) }
                        if let overview = film.overview, !overview.isEmpty {
                            section("Synopsis") {
                                Text(overview)
                                    .font(.body)
                                    .foregroundStyle(.white.opacity(0.88))
                                    .lineSpacing(3)
                                    .lineLimit(showWholeSynopsis ? nil : 6)
                                if overview.count > 320 {
                                    Button(showWholeSynopsis ? "Less" : "More") { withAnimation { showWholeSynopsis.toggle() } }
                                        .font(.subheadline.weight(.semibold))
                                }
                            }
                        }
                        if !film.directors.isEmpty {
                            section(film.directors.count == 1 ? "Director" : "Directors") {
                                ForEach(film.directors) { director in
                                    NavigationLink { PersonView(personId: director.id, name: director.name) } label: {
                                        Label(director.name, systemImage: "video.fill")
                                            .font(.body.weight(.semibold))
                                            .foregroundStyle(Theme.accent)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        if !film.cast.isEmpty { cast(film.cast) }
                        if let original = film.originalTitle {
                            Text("Original title: \(original)").font(.footnote).foregroundStyle(.white.opacity(0.5))
                        }
                    }
                    .padding(.horizontal, m.margin)
                    .padding(.top, 18)
                    .padding(.bottom, 40)
                }
            } else if let failed {
                ContentUnavailableView("Couldn't load this film", systemImage: "exclamationmark.triangle", description: Text(failed))
                    .padding(.top, 120)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 160)
            }
        }
        .background(Theme.background)
        .ignoresSafeArea(edges: .top)
        .navigationTitle(film?.title ?? title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(isPresented: $asking) {
            if let film {
                AskForFilmSheet(film: film.asResult) { note in await send(note: note) }
            }
        }
        .inAppBrowser($trailer)
    }

    // MARK: Pieces

    private func header(_ film: FilmDetail, _ m: Metrics) -> some View {
        ZStack(alignment: .bottomLeading) {
            Color.clear
                .frame(height: m.regular ? 420 : 300)
                .overlay { RemoteImage(url: (film.backdropUrl ?? film.posterUrl).flatMap(URL.init(string:))) }
                .clipped()
                .overlay {
                    LinearGradient(stops: [
                        .init(color: .black.opacity(0.45), location: 0),
                        .init(color: .clear, location: 0.35),
                        .init(color: Theme.background.opacity(0.85), location: 0.8),
                        .init(color: Theme.background, location: 1),
                    ], startPoint: .top, endPoint: .bottom)
                }
            HStack(alignment: .bottom, spacing: 16) {
                Color.clear
                    .frame(width: m.regular ? 150 : 108, height: m.regular ? 225 : 162)
                    .overlay { RemoteImage(url: film.posterUrl.flatMap(URL.init(string:)), placeholder: film.title) }
                    .clipShape(.rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.15)))
                    .shadow(color: .black.opacity(0.6), radius: 14, y: 8)
                VStack(alignment: .leading, spacing: 6) {
                    Text(film.title)
                        .font(m.regular ? .largeTitle.weight(.heavy) : .title.weight(.heavy))
                        .foregroundStyle(.white)
                        .lineLimit(3)
                        .minimumScaleFactor(0.7)
                    Text(facts(film)).font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.75))
                    if let rating = film.rating, rating > 0 {
                        HStack(spacing: 4) {
                            Image(systemName: "star.fill").foregroundStyle(.yellow)
                            Text(String(format: "%.1f", rating)).fontWeight(.bold).foregroundStyle(.white)
                            if let votes = film.voteCount, votes > 0 {
                                Text("· \(votes.formatted(.number.notation(.compactName))) ratings").foregroundStyle(.white.opacity(0.6))
                            }
                        }
                        .font(.subheadline)
                    }
                }
                .padding(.bottom, 4)
            }
            .padding(.horizontal, m.margin)
            .offset(y: 24)
        }
        .padding(.bottom, 24)
    }

    private func facts(_ film: FilmDetail) -> String {
        var parts: [String] = []
        if let year = film.year { parts.append(String(year)) }
        if let runtime = film.runtime, runtime > 0 { parts.append(runtime >= 60 ? "\(runtime / 60)h \(runtime % 60)m" : "\(runtime)m") }
        if let certification = film.certification { parts.append(certification) }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func actions(_ film: FilmDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let movieId = film.movieId {
                NavigationLink { RequestedMovieView(movieId: movieId) } label: {
                    Label("On Streamulus — Watch", systemImage: "play.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            } else if let state = film.request {
                HStack(spacing: 10) {
                    StatusPill(status: state.status, label: state.label ?? state.status)
                    Text(state.mine ? "You've asked for this film" : "Someone has already asked for this film")
                        .font(.subheadline).foregroundStyle(.white.opacity(0.75))
                }
                if !state.mine {
                    Button { Task { await send(note: "") } } label: {
                        Label("Me Too — Tell Me When It's Ready", systemImage: "hand.raised.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                }
            } else {
                Button { asking = true } label: {
                    Label("Request This Film", systemImage: "plus.circle.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
            if let trailerInfo = film.trailer, let url = URL(string: trailerInfo.url) {
                Button { trailer = BrowserPage(url: url) } label: {
                    Label("Watch Trailer", systemImage: "play.rectangle.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
            }
        }
    }

    private func genreChips(_ genres: [String]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(genres, id: \.self) { genre in
                    Text(genre)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(Color.white.opacity(0.1), in: Capsule())
                }
            }
        }
    }

    private func cast(_ people: [FilmCredit]) -> some View {
        section("Cast") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(people) { person in
                        NavigationLink { PersonView(personId: person.id, name: person.name) } label: {
                            VStack(spacing: 6) {
                                Circle()
                                    .fill(Color.white.opacity(0.08))
                                    .frame(width: 76, height: 76)
                                    .overlay {
                                        if let url = person.profileUrl.flatMap(URL.init(string:)) {
                                            RemoteImage(url: url)
                                        } else {
                                            Image(systemName: "person.fill").font(.title).foregroundStyle(.white.opacity(0.35))
                                        }
                                    }
                                    .clipShape(Circle())
                                Text(person.name).font(.caption.weight(.semibold)).foregroundStyle(.white).lineLimit(2).multilineTextAlignment(.center)
                                if let character = person.character, !character.isEmpty {
                                    Text(character).font(.caption2).foregroundStyle(.white.opacity(0.55)).lineLimit(2).multilineTextAlignment(.center)
                                }
                            }
                            .frame(width: 86)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(.title3.weight(.bold)).foregroundStyle(.white)
            content()
        }
    }

    // MARK: Loading and asking

    private func load() async {
        do {
            film = try await session.get("/api/requests/film/\(tmdbId)", as: FilmDetailResponse.self).film
        } catch {
            failed = error.localizedDescription
        }
    }

    private func send(note: String) async {
        do {
            let response = try await session.post("/api/requests", body: ["tmdbId": tmdbId, "note": note], as: CreateRequestResponse.self)
            asking = false
            let next = RequestMessage(text: response.joined == true ? "Added you — you'll hear when it's ready too" : "Requested — you'll get an email when an admin decides", error: false)
            withAnimation { message = next }
            await load()
        } catch {
            withAnimation { message = RequestMessage(text: error.localizedDescription, error: true) }
        }
    }
}

extension FilmDetail {
    /// For the request sheet.
    var asResult: FilmResult {
        FilmResult(tmdbId: tmdbId, title: title, year: year, overview: overview, posterUrl: posterUrl, rating: rating, request: request, role: nil)
    }
}

// MARK: - A person's page

/// An actor's (or director's) page: photo, a little about them, and every film of
/// theirs that isn't on the server yet — tap one to read about it or request it.
struct PersonView: View {
    let personId: Int
    let name: String

    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var page: PersonPageResponse?
    @State private var failed: String?
    @State private var asking: FilmResult?
    @State private var message: RequestMessage?
    @State private var showWholeBio = false

    var body: some View {
        let m = Metrics(sizeClass)
        ScrollView {
            if let page {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .center, spacing: 18) {
                        Circle()
                            .fill(Color.white.opacity(0.08))
                            .frame(width: 112, height: 112)
                            .overlay {
                                if let url = page.person.profileUrl.flatMap(URL.init(string:)) {
                                    RemoteImage(url: url)
                                } else {
                                    Image(systemName: "person.fill").font(.largeTitle).foregroundStyle(.white.opacity(0.35))
                                }
                            }
                            .clipShape(Circle())
                            .overlay(Circle().strokeBorder(Color.white.opacity(0.15)))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(page.person.name).font(.title.weight(.heavy)).foregroundStyle(.white)
                            if let department = page.person.department {
                                Text(department == "Acting" ? "Actor" : department == "Directing" ? "Director" : department)
                                    .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                            }
                            if let born = born(page.person) {
                                Text(born).font(.footnote).foregroundStyle(.white.opacity(0.6))
                            }
                        }
                    }
                    if let bio = page.person.biography, !bio.isEmpty {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(bio).font(.subheadline).foregroundStyle(.white.opacity(0.85)).lineSpacing(2).lineLimit(showWholeBio ? nil : 4)
                            if bio.count > 220 {
                                Button(showWholeBio ? "Less" : "More") { withAnimation { showWholeBio.toggle() } }.font(.subheadline.weight(.semibold))
                            }
                        }
                    }
                    if let message { RequestBanner(message: message) }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Films to request").font(.title3.weight(.bold)).foregroundStyle(.white)
                        if page.onServer > 0 {
                            Label("\(page.onServer) of their films \(page.onServer == 1 ? "is" : "are") already on Streamulus", systemImage: "checkmark.circle.fill")
                                .font(.footnote).foregroundStyle(.green.opacity(0.85))
                        }
                    }
                    if page.films.isEmpty {
                        Text("Everything of theirs is already on Streamulus.").font(.subheadline).foregroundStyle(.white.opacity(0.6))
                    }
                    FilmGrid(films: page.films, minimum: m.gridMinimum) { film in
                        if let state = film.request {
                            if !state.mine { Task { await send(film, note: "") } }
                        } else {
                            asking = film
                        }
                    }
                }
                .padding(m.margin)
            } else if let failed {
                ContentUnavailableView("Couldn't load", systemImage: "exclamationmark.triangle", description: Text(failed)).padding(.top, 80)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 120)
            }
        }
        .background(Theme.background)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $asking) { film in
            AskForFilmSheet(film: film) { note in await send(film, note: note) }
        }
    }

    private func born(_ person: PersonDetail) -> String? {
        guard let birthday = person.birthday else { return person.placeOfBirth.map { "From \($0)" } }
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        let date = parser.date(from: birthday)
        var text = "Born \(date?.formatted(date: .long, time: .omitted) ?? birthday)"
        if let place = person.placeOfBirth { text += " · \(place)" }
        if let deathday = person.deathday { text += " · Died \(parser.date(from: deathday)?.formatted(date: .long, time: .omitted) ?? deathday)" }
        return text
    }

    private func load() async {
        do {
            page = try await session.get("/api/requests/person/\(personId)", as: PersonPageResponse.self)
        } catch {
            failed = error.localizedDescription
        }
    }

    private func send(_ film: FilmResult, note: String) async {
        do {
            let response = try await session.post("/api/requests", body: ["tmdbId": film.tmdbId, "note": note], as: CreateRequestResponse.self)
            asking = nil
            withAnimation {
                message = RequestMessage(text: response.joined == true ? "Added you to the request for \(film.title)" : "Requested \(film.title) — you'll get an email when an admin decides", error: false)
            }
            await load()
        } catch {
            withAnimation { message = RequestMessage(text: error.localizedDescription, error: true) }
        }
    }
}

// MARK: - The request sheet

/// Confirming a request: the film (poster, year, rating, synopsis), an optional
/// note for the admin, and Send. A solid dark sheet — the see-through glass of a
/// half-height sheet let the bright posters behind wash it out.
struct AskForFilmSheet: View {
    let film: FilmResult
    let send: (String) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var sending = false
    @FocusState private var noteFocused: Bool

    var body: some View {
        ZStack(alignment: .top) {
            Theme.background.ignoresSafeArea()
            // The poster, blurred, as a soft glow behind the top of the sheet.
            Color.clear
                .frame(height: 260)
                .overlay { RemoteImage(url: film.posterUrl.flatMap(URL.init(string:))) }
                .blur(radius: 50)
                .opacity(0.45)
                .overlay(LinearGradient(colors: [.clear, Theme.background], startPoint: .top, endPoint: .bottom))
                .clipped()
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack(alignment: .top, spacing: 16) {
                        Color.clear
                            .frame(width: 104, height: 156)
                            .overlay { RemoteImage(url: film.posterUrl.flatMap(URL.init(string:)), placeholder: film.title) }
                            .clipShape(.rect(cornerRadius: 12))
                            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.15)))
                            .shadow(color: .black.opacity(0.6), radius: 12, y: 6)
                        VStack(alignment: .leading, spacing: 6) {
                            Text("REQUEST")
                                .font(.caption.weight(.heavy))
                                .tracking(1.5)
                                .foregroundStyle(Theme.accent)
                            Text(film.title)
                                .font(.title2.weight(.heavy))
                                .foregroundStyle(.white)
                                .lineLimit(3)
                            HStack(spacing: 8) {
                                if let year = film.year { Text(String(year)) }
                                if let rating = film.rating, rating > 0 {
                                    Label(String(format: "%.1f", rating), systemImage: "star.fill").labelStyle(.titleAndIcon)
                                }
                            }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.75))
                        }
                    }
                    if let overview = film.overview, !overview.isEmpty {
                        Text(overview)
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.85))
                            .lineSpacing(2)
                            .lineLimit(5)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Note for the admin")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white)
                        TextField("", text: $note, prompt: Text("Optional — e.g. the 2021 version, please").foregroundStyle(.white.opacity(0.4)), axis: .vertical)
                            .lineLimit(2...4)
                            .focused($noteFocused)
                            .foregroundStyle(.white)
                            .padding(14)
                            .background(Color.white.opacity(0.08), in: .rect(cornerRadius: 14))
                            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(noteFocused ? Theme.accent.opacity(0.7) : Color.white.opacity(0.14)))
                    }

                    Label("You'll get an email when it's approved or declined, and again when it's ready to watch.", systemImage: "envelope.fill")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.7))

                    VStack(spacing: 10) {
                        Button {
                            sending = true
                            Task {
                                await send(String(note.trimmingCharacters(in: .whitespacesAndNewlines).prefix(500)))
                                sending = false
                            }
                        } label: {
                            Group {
                                if sending { ProgressView().tint(.white) } else { Label("Send Request", systemImage: "paperplane.fill") }
                            }
                            .font(.headline)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                        }
                        .buttonStyle(.glassProminent)
                        .controlSize(.large)
                        .disabled(sending)

                        Button("Cancel") { dismiss() }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.75))
                            .padding(.vertical, 6)
                    }
                }
                .padding(.horizontal, 22)
                .padding(.top, 26)
                .padding(.bottom, 20)
            }
            .scrollBounceBehavior(.basedOnSize)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .presentationBackground(Theme.background)
        .presentationCornerRadius(28)
        .preferredColorScheme(.dark)
    }
}
