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
        FilmResult(tmdbId: tmdbId, title: title, year: year, overview: overview, posterUrl: posterUrl, rating: rating, request: request, role: nil, mediaType: nil, showId: nil)
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
    /// A series: "series" (the whole thing) or "season" (with which one).
    var scope: String? = nil
    var season: Int? = nil
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
                            Text(film.isShow ? (scope == "season" ? "REQUEST A SEASON" : "REQUEST A SERIES") : "REQUEST")
                                .font(.caption.weight(.heavy))
                                .tracking(1.5)
                                .foregroundStyle(Theme.accent)
                            Text(film.title)
                                .font(.title2.weight(.heavy))
                                .foregroundStyle(.white)
                                .lineLimit(3)
                            if film.isShow {
                                SeriesTag(text: scope == "season" ? "Season \(season ?? 0)" : film.showId != nil ? "Every missing season" : "The whole series")
                                    .font(.caption.weight(.bold))
                                    .foregroundStyle(Theme.accent)
                                    .padding(.horizontal, 10).padding(.vertical, 4)
                                    .background(Theme.accent.opacity(0.15), in: Capsule())
                                    .overlay(Capsule().strokeBorder(Theme.accent.opacity(0.4)))
                            }
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
                        TextField("", text: $note, prompt: Text(film.isShow ? "Optional — e.g. the original, not the remake" : "Optional — e.g. the 2021 version, please").foregroundStyle(.white.opacity(0.4)), axis: .vertical)
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


// MARK: - A series' page (Requests)

/// A series that isn't (all) on the server: backdrop and poster, years, seasons,
/// rating, genres, synopsis, cast, trailer — and its seasons: how much of each
/// is on Streamulus, with Request Entire Series, or (once the show is here)
/// Request Season. Open a season to see its episodes.
struct ShowRequestView: View {
    let tmdbId: Int
    let title: String

    @EnvironmentObject private var session: Session
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var show: ShowRequestDetail?
    @State private var failed: String?
    @State private var asking: RequestsView.Ask?
    @State private var message: RequestMessage?
    @State private var trailer: BrowserPage?
    @State private var opened: Int?
    @State private var episodes: [Int: [SeasonRequestEpisode]] = [:]
    @State private var showWholeSynopsis = false

    var body: some View {
        let m = Metrics(sizeClass)
        ScrollView {
            if let show {
                VStack(alignment: .leading, spacing: 0) {
                    header(show, m)
                    VStack(alignment: .leading, spacing: 22) {
                        if let message { RequestBanner(message: message) }
                        actions(show)
                        if let tagline = show.tagline {
                            Text("“\(tagline)”").font(.title3.italic()).foregroundStyle(.white.opacity(0.85))
                        }
                        if !show.genres.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 8) {
                                    ForEach(show.genres, id: \.self) { genre in
                                        Text(genre).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                                            .padding(.horizontal, 12).padding(.vertical, 6)
                                            .background(Color.white.opacity(0.1), in: Capsule())
                                    }
                                }
                            }
                        }
                        if let overview = show.overview, !overview.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Synopsis").font(.title3.weight(.bold)).foregroundStyle(.white)
                                Text(overview).font(.body).foregroundStyle(.white.opacity(0.88)).lineSpacing(3).lineLimit(showWholeSynopsis ? nil : 6)
                                if overview.count > 320 {
                                    Button(showWholeSynopsis ? "Less" : "More") { withAnimation { showWholeSynopsis.toggle() } }.font(.subheadline.weight(.semibold))
                                }
                            }
                        }
                        seasons(show)
                        if !show.creators.isEmpty {
                            Text("Created by \(show.creators.map(\.name).joined(separator: ", "))").font(.subheadline).foregroundStyle(.white.opacity(0.7))
                        }
                        if !show.cast.isEmpty { cast(show.cast) }
                    }
                    .padding(.horizontal, m.margin)
                    .padding(.top, 18)
                    .padding(.bottom, 40)
                }
            } else if let failed {
                ContentUnavailableView("Couldn't load this series", systemImage: "exclamationmark.triangle", description: Text(failed))
                    .padding(.top, 120)
            } else {
                ProgressView().frame(maxWidth: .infinity).padding(.top, 160)
            }
        }
        .background(Theme.background)
        .ignoresSafeArea(edges: .top)
        .navigationTitle(show?.title ?? title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task { await load() }
        .sheet(item: $asking) { ask in
            AskForFilmSheet(film: ask.film, scope: ask.scope, season: ask.season) { note in await send(scope: ask.scope ?? "series", season: ask.season, note: note) }
        }
        .inAppBrowser($trailer)
    }

    private func header(_ show: ShowRequestDetail, _ m: Metrics) -> some View {
        ZStack(alignment: .bottomLeading) {
            Color.clear
                .frame(height: m.regular ? 420 : 300)
                .overlay { RemoteImage(url: (show.backdropUrl ?? show.posterUrl).flatMap(URL.init(string:))) }
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
                    .overlay { RemoteImage(url: show.posterUrl.flatMap(URL.init(string:)), placeholder: show.title) }
                    .clipShape(.rect(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.white.opacity(0.15)))
                    .shadow(color: .black.opacity(0.6), radius: 14, y: 8)
                VStack(alignment: .leading, spacing: 6) {
                    SeriesTag(text: "SERIES").font(.caption.weight(.heavy)).foregroundStyle(Theme.accent)
                    Text(show.title)
                        .font(m.regular ? .largeTitle.weight(.heavy) : .title.weight(.heavy))
                        .foregroundStyle(.white)
                        .lineLimit(3)
                        .minimumScaleFactor(0.7)
                    Text(facts(show)).font(.subheadline.weight(.medium)).foregroundStyle(.white.opacity(0.75))
                    if let rating = show.rating, rating > 0 {
                        HStack(spacing: 4) {
                            Image(systemName: "star.fill").foregroundStyle(.yellow)
                            Text(String(format: "%.1f", rating)).fontWeight(.bold).foregroundStyle(.white)
                            if !show.networks.isEmpty { Text("· \(show.networks.joined(separator: ", "))").foregroundStyle(.white.opacity(0.6)) }
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

    private func facts(_ show: ShowRequestDetail) -> String {
        let year = { (date: String?) -> Int? in date.flatMap { Int($0.prefix(4)) } }
        var parts: [String] = []
        if let first = year(show.firstAirDate) {
            let last = year(show.lastAirDate)
            parts.append(show.status == "Returning Series" ? "\(first)–" : (last.map { $0 != first ? "\(first)–\($0)" : String(first) } ?? String(first)))
        }
        if let n = show.numberOfSeasons { parts.append("\(n) season\(n == 1 ? "" : "s")") }
        if let certification = show.certification { parts.append(certification) }
        if show.status == "Returning Series" { parts.append("Still running") } else if show.status == "Ended" { parts.append("Ended") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func actions(_ show: ShowRequestDetail) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if let onServer = show.onServer {
                NavigationLink { RequestedShowView(showId: onServer.showId) } label: {
                    Label("On Streamulus — Watch", systemImage: "play.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
            }
            if let state = show.request {
                HStack(spacing: 10) {
                    StatusPill(status: state.status, label: state.label ?? state.status)
                    Text(state.mine ? "You've asked for the whole series" : "Someone has asked for the whole series")
                        .font(.subheadline).foregroundStyle(.white.opacity(0.75))
                }
                if !state.mine {
                    Button { Task { await send(scope: "series", season: nil, note: "") } } label: {
                        Label("Me Too — Tell Me When It's Ready", systemImage: "hand.raised.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                    }
                    .buttonStyle(.glassProminent)
                    .controlSize(.large)
                }
            } else if show.canRequestSeries {
                Button { asking = RequestsView.Ask(film: show.asResult, scope: "series", season: nil) } label: {
                    Label(show.onServer == nil ? "Request Entire Series" : "Request All Missing Seasons", systemImage: "plus.circle.fill")
                        .font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
            }
            if let info = show.trailer, let url = URL(string: info.url) {
                Button { trailer = BrowserPage(url: url) } label: {
                    Label("Watch Trailer", systemImage: "play.rectangle.fill").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 4)
                }
                .buttonStyle(.glass)
                .controlSize(.large)
            }
        }
    }

    private func seasons(_ show: ShowRequestDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Seasons").font(.title3.weight(.bold)).foregroundStyle(.white)
            if show.onServer == nil {
                Text("Single seasons can be asked for once the show is on Streamulus — request the whole series to get started.")
                    .font(.subheadline).foregroundStyle(.white.opacity(0.6))
            }
            VStack(spacing: 0) {
                ForEach(Array(show.seasons.enumerated()), id: \.element.id) { index, season in
                    if index > 0 { Divider().overlay(Color.white.opacity(0.08)) }
                    seasonRow(season, show)
                }
            }
            .background(Color.white.opacity(0.05), in: .rect(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.white.opacity(0.08)))
        }
    }

    @ViewBuilder private func seasonRow(_ season: ShowRequestSeason, _ show: ShowRequestDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.snappy) { opened = opened == season.season ? nil : season.season }
                if episodes[season.season] == nil { Task { await loadEpisodes(season.season) } }
            } label: {
                HStack(spacing: 12) {
                    Color.clear
                        .frame(width: 44, height: 66)
                        .overlay { RemoteImage(url: season.posterUrl.flatMap(URL.init(string:)), placeholder: "\(season.season)") }
                        .clipShape(.rect(cornerRadius: 6))
                    VStack(alignment: .leading, spacing: 3) {
                        Text(season.name).font(.headline).foregroundStyle(.white)
                        Text([season.year.map(String.init), "\(season.episodeCount) episode\(season.episodeCount == 1 ? "" : "s")",
                              season.aired < season.episodeCount ? (season.aired > 0 ? "\(season.aired) aired so far" : "not aired yet") : nil]
                            .compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.white.opacity(0.6))
                        if show.onServer != nil, season.aired > 0 {
                            HStack(spacing: 8) {
                                ProgressView(value: Double(season.onServer), total: Double(max(1, season.aired)))
                                    .tint(season.complete ? .green : Theme.accent)
                                    .frame(maxWidth: 140)
                                Text("\(season.onServer) of \(season.aired) on Streamulus").font(.caption2).foregroundStyle(.white.opacity(0.6))
                            }
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.white.opacity(0.35))
                        .rotationEffect(.degrees(opened == season.season ? 90 : 0))
                }
                .contentShape(.rect)
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                if season.complete {
                    StatusPill(status: "available", label: "On Streamulus")
                } else if let state = season.request {
                    StatusPill(status: state.status, label: state.scope == "series" ? "Whole series asked for" : (state.label ?? state.status))
                    if !state.mine {
                        Button("Me Too") { Task { await send(scope: state.scope ?? "season", season: state.season, note: "") } }
                            .buttonStyle(.glass).controlSize(.small)
                    }
                } else if season.canRequest {
                    Button { asking = RequestsView.Ask(film: show.asResult, scope: "season", season: season.season) } label: {
                        Label("Request Season", systemImage: "plus").font(.subheadline.weight(.semibold))
                    }
                    .buttonStyle(.glassProminent).controlSize(.small)
                }
            }

            if opened == season.season {
                if let list = episodes[season.season] {
                    VStack(spacing: 0) {
                        ForEach(list) { e in
                            HStack(spacing: 10) {
                                Text(String(format: "E%02d", e.episode)).font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.45)).frame(width: 34, alignment: .leading)
                                Text(e.title ?? "Episode \(e.episode)").font(.subheadline).foregroundStyle(e.aired ? .white : .white.opacity(0.45)).lineLimit(1)
                                Spacer(minLength: 6)
                                Text(e.onServer ? "On Streamulus" : e.aired ? RequestDates.short(e.airDate) : "Airs \(RequestDates.short(e.airDate))")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(e.onServer ? .green : .white.opacity(0.5))
                            }
                            .padding(.vertical, 7)
                        }
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity)
                }
            }
        }
        .padding(14)
    }

    private func cast(_ people: [FilmCredit]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Cast").font(.title3.weight(.bold)).foregroundStyle(.white)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 14) {
                    ForEach(people) { person in
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
                }
            }
        }
    }

    private func load() async {
        do {
            show = try await session.get("/api/requests/show/\(tmdbId)", as: ShowRequestResponse.self).show
        } catch {
            failed = error.localizedDescription
        }
    }

    private func loadEpisodes(_ season: Int) async {
        let response = try? await session.get("/api/requests/show/\(tmdbId)/season/\(season)", as: SeasonEpisodesResponse.self)
        if let response { episodes[season] = response.episodes }
    }

    private func send(scope: String, season: Int?, note: String) async {
        var body: [String: Any] = ["mediaType": "tv", "tmdbId": tmdbId, "scope": scope, "note": note]
        if let season { body["season"] = season }
        do {
            let response = try await session.post("/api/requests", body: body, as: CreateRequestResponse.self)
            asking = nil
            let text = response.joined == true ? "Added you — you'll hear when it's ready too" : response.already == true ? "You've already asked for this" : "Requested — you'll get an email when an admin decides"
            withAnimation { message = RequestMessage(text: text, error: false) }
            await load()
        } catch {
            withAnimation { message = RequestMessage(text: error.localizedDescription, error: true) }
        }
    }
}

enum RequestDates {
    private static let iso: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    /// "4 Jul 2019" from "2019-07-04" (or an ISO date-time).
    static func short(_ value: String?) -> String {
        guard let value, let date = iso.date(from: String(value.prefix(10))) else { return "" }
        return date.formatted(.dateTime.day().month(.abbreviated).year())
    }
}

/// The series icon, small, beside some text ("Season 2", "SERIES").
struct SeriesTag: View {
    let text: String
    var body: some View {
        HStack(spacing: 5) {
            Image("RequestsSeries").renderingMode(.template).resizable().scaledToFit().frame(height: 10)
            Text(text)
        }
    }
}

// MARK: - A series request's checklist

/// How a series request is getting on: episodes ready, then each season (ready
/// of total, a bar, what's going on) — open one to see its episodes ticked off,
/// downloading (with a filling ring and %), moving in, not found, or not aired
/// yet. Seasons with downloads open by themselves until you open or close one.
struct TVChecklistView: View {
    let tv: TVProgress
    let scope: String?
    @State private var chosen: [Int: Bool] = [:]

    private func isOpen(_ s: TVSeasonProgress) -> Bool {
        chosen[s.season] ?? (scope == "season" || tv.seasons.count == 1 || (s.active ?? 0) > 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ProgressView(value: min(1, max(0, tv.progress ?? 0))).tint(tv.total > 0 && tv.ready == tv.total ? .green : Theme.accent)
                Text("\(tv.ready) of \(tv.total) episode\(tv.total == 1 ? "" : "s") ready")
                    .font(.subheadline.weight(.bold)).foregroundStyle(.white)
                    .fixedSize()
            }
            VStack(spacing: 0) {
                ForEach(Array(tv.seasons.enumerated()), id: \.element.id) { index, s in
                    if index > 0 { Divider().overlay(Color.white.opacity(0.08)) }
                    VStack(alignment: .leading, spacing: 0) {
                        Button { withAnimation(.snappy) { chosen[s.season] = !isOpen(s) } } label: {
                            HStack(spacing: 10) {
                                Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.white.opacity(0.5))
                                    .rotationEffect(.degrees(isOpen(s) ? 90 : 0))
                                Text("Season \(s.season)").font(.subheadline.weight(.bold)).foregroundStyle(.white)
                                Text("\(s.ready ?? 0)/\(s.total ?? 0)").font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.55))
                                ProgressView(value: min(1, max(0, s.progress ?? 0))).tint((s.total ?? 0) > 0 && s.ready == s.total ? .green : Theme.accent)
                                Text(summary(s).text).font(.caption.weight(.bold)).foregroundStyle(summary(s).color).fixedSize()
                            }
                            .padding(.vertical, 10).padding(.horizontal, 12)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        if isOpen(s) {
                            VStack(spacing: 0) {
                                ForEach(s.episodes) { e in episodeRow(e) }
                            }
                            .padding(.leading, 34).padding(.trailing, 12).padding(.bottom, 8)
                        }
                    }
                }
            }
            .background(Color.white.opacity(0.04), in: .rect(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.white.opacity(0.08)))
        }
    }

    private func summary(_ s: TVSeasonProgress) -> (text: String, color: Color) {
        let total = s.total ?? 0, ready = s.ready ?? 0
        if total > 0 && ready == total { return ((s.unaired ?? 0) > 0 ? "Aired ready" : "All ready", .green) }
        if (s.active ?? 0) > 0 { return ("\(s.active!) downloading", Theme.accent) }
        if (s.missing ?? 0) > 0 { return ("\(s.missing!) not found", .orange) }
        if total == 0 && (s.unaired ?? 0) > 0 { return ("Not aired yet", .white.opacity(0.5)) }
        return ("\(ready) of \(total)", .white.opacity(0.6))
    }

    private func episodeRow(_ e: TVEpisodeProgress) -> some View {
        HStack(spacing: 10) {
            EpisodeMark(state: e.state, progress: e.progress ?? 0)
            Text(String(format: "E%02d", e.episode)).font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.45)).frame(width: 30, alignment: .leading)
            Text(e.title ?? "Episode \(e.episode)").font(.subheadline).foregroundStyle(e.state == "unaired" ? .white.opacity(0.45) : .white).lineLimit(1)
            Spacer(minLength: 6)
            Text(stateText(e)).font(.caption.weight(.bold)).foregroundStyle(EpisodeMark.color(e.state))
        }
        .padding(.vertical, 6)
    }

    private func stateText(_ e: TVEpisodeProgress) -> String {
        switch e.state {
        case "ready": return "Ready"
        case "downloading": return "\(Int(((e.progress ?? 0) * 100).rounded()))%"
        case "importing", "adding": return "Moving in"
        case "searching": return "Searching"
        case "failed": return "Problem"
        case "unaired": return e.airDate.map { "Airs \(RequestDates.short($0))" } ?? "Not aired yet"
        default: return "Not found yet"
        }
    }
}

/// An episode's state: a tick when ready, a ring filling as it downloads, an outline otherwise.
struct EpisodeMark: View {
    let state: String
    let progress: Double

    static func color(_ state: String) -> Color {
        switch state {
        case "ready": return .green
        case "downloading": return Theme.accent
        case "importing", "adding": return .purple
        case "searching": return .yellow
        case "failed": return .red
        case "unaired": return .white.opacity(0.4)
        default: return .orange
        }
    }

    var body: some View {
        ZStack {
            switch state {
            case "ready":
                Circle().fill(Color.green)
                Image(systemName: "checkmark").font(.system(size: 10, weight: .heavy)).foregroundStyle(.black)
            case "downloading":
                Circle().stroke(Color.white.opacity(0.12), lineWidth: 2.5)
                Circle().trim(from: 0, to: min(1, max(0, progress))).stroke(Theme.accent, style: StrokeStyle(lineWidth: 2.5, lineCap: .round)).rotationEffect(.degrees(-90))
            default:
                Circle().stroke(Self.color(state), lineWidth: 2)
            }
        }
        .frame(width: 18, height: 18)
        .animation(.easeInOut(duration: 0.6), value: progress)
    }
}

/// A show's page for a request that has episodes ready (fetched by its id).
struct RequestedShowView: View {
    let showId: Int
    @EnvironmentObject private var session: Session
    @State private var show: Show?
    @State private var failed = false

    var body: some View {
        Group {
            if let show {
                ShowDetailView(show: show)
            } else if failed {
                ContentUnavailableView("Couldn't open the show", systemImage: "exclamationmark.triangle")
            } else {
                ProgressView()
            }
        }
        .task {
            do { show = try await session.get("/api/tv/\(showId)/details", as: ShowDetailsResponse.self).show } catch { failed = true }
        }
    }
}
