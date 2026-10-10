import SwiftUI

/// Liquid Glass tab bar: a floating bar on iPhone that shrinks as you scroll,
/// and on iPad a tab bar that can turn into a sidebar. Search is the separate
/// search tab; Profile & Settings is the picture top-right on every page.
struct MainTabView: View {
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var player: PlayerPresenter
    @State private var selection: AppTab = .home

    enum AppTab: Hashable { case home, movies, shows, genres, search }

    var body: some View {
        TabView(selection: $selection) {
            Tab("Home", systemImage: "house.fill", value: AppTab.home) {
                NavigationStack { HomeView() }
            }
            Tab("Movies", systemImage: "film.fill", value: AppTab.movies) {
                NavigationStack { MovieLibraryView() }
            }
            Tab("TV Shows", systemImage: "tv.fill", value: AppTab.shows) {
                NavigationStack { ShowLibraryView() }
            }
            Tab("Genres", systemImage: "square.grid.2x2.fill", value: AppTab.genres) {
                NavigationStack { GenresView() }
            }
            Tab(value: AppTab.search, role: .search) {
                NavigationStack { SearchView() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .fullScreenCover(item: $player.request) { request in
            PlayerView(request: request, session: session, onClose: { player.request = nil })
        }
    }
}
