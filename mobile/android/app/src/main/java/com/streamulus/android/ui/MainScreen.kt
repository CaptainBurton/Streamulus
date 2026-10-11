package com.streamulus.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.streamulus.android.ui.account.AccountScreen
import com.streamulus.android.ui.account.ApproveSignInScreen
import com.streamulus.android.ui.account.AvatarPickerScreen
import com.streamulus.android.ui.account.FeedbackScreen
import com.streamulus.android.ui.account.FeedbackThreadScreen
import com.streamulus.android.ui.components.BrandMark
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.detail.MovieDetailScreen
import com.streamulus.android.ui.detail.ShowDetailScreen
import com.streamulus.android.ui.genres.GenreDetailScreen
import com.streamulus.android.ui.genres.GenresScreen
import com.streamulus.android.ui.genres.SearchScreen
import com.streamulus.android.ui.home.HomeScreen
import com.streamulus.android.ui.library.MoviesScreen
import com.streamulus.android.ui.library.ShowsScreen
import com.streamulus.android.ui.theme.Brand

/** The signed-in app: tabs (bottom bar on phones, rail on tablets), each with its own pages. */
@Composable
fun MainScreen() {
    val session = LocalSession.current
    val navigator = remember(session.profile?.id) { Navigator() }
    val wide = LocalMetrics.current.wide

    BackHandler(enabled = navigator.stack.isNotEmpty() || navigator.tab != Tab.Home) {
        if (!navigator.pop()) navigator.select(Tab.Home)
    }

    CompositionLocalProvider(LocalNavigator provides navigator) {
        if (wide) {
            Row(Modifier.fillMaxSize()) {
                NavigationRail(containerColor = Brand.Background, header = {
                    Column(Modifier.statusBarsPadding().padding(top = 12.dp)) { BrandMark(12.dp) }
                }) {
                    Spacer(Modifier.height(12.dp))
                    Tab.entries.forEach { tab ->
                        NavigationRailItem(
                            selected = navigator.tab == tab,
                            onClick = { navigator.select(tab) },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                        )
                    }
                }
                Box(Modifier.weight(1f).fillMaxHeight()) { PageHost(navigator) }
            }
        } else {
            Column(Modifier.fillMaxSize()) {
                Box(Modifier.weight(1f)) { PageHost(navigator) }
                NavigationBar(containerColor = Brand.Background.copy(alpha = 0.96f)) {
                    Tab.entries.forEach { tab ->
                        NavigationBarItem(
                            selected = navigator.tab == tab,
                            onClick = { navigator.select(tab) },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label, maxLines = 1) },
                        )
                    }
                }
            }
        }
    }
}

/** Shows the top page of the current tab, keeping each page's scroll position when you come back. */
@Composable
private fun PageHost(navigator: Navigator) {
    val holder = rememberSaveableStateHolder()
    val top = navigator.stack.lastOrNull()
    val key = top?.let { "page-${it.id}" } ?: "tab-${navigator.tab.name}"
    val depth = navigator.stack.size

    // Forget the saved state of pages that have been closed.
    val knownKeys = remember { mutableSetOf<String>() }
    val openKeys = navigator.stack.map { "page-${it.id}" }.toSet()
    LaunchedEffect(openKeys) {
        knownKeys.filterNot { it in openKeys }.forEach { holder.removeState(it) }
        knownKeys.clear()
        knownKeys.addAll(openKeys)
    }

    AnimatedContent(
        targetState = Triple(key, top, depth),
        transitionSpec = {
            val forward = targetState.third > initialState.third
            if (initialState.first.startsWith("tab-") && targetState.first.startsWith("tab-")) {
                fadeIn() togetherWith fadeOut()
            } else if (forward) {
                (slideInHorizontally { it / 3 } + fadeIn()) togetherWith (slideOutHorizontally { -it / 6 } + fadeOut())
            } else {
                (slideInHorizontally { -it / 6 } + fadeIn()) togetherWith (slideOutHorizontally { it / 3 } + fadeOut())
            }
        },
        label = "pages",
    ) { (pageKey, entry, _) ->
        holder.SaveableStateProvider(pageKey) {
            if (entry == null) TabRoot(navigator.tab) else Page(entry.screen)
        }
    }
}

@Composable
private fun TabRoot(tab: Tab) {
    when (tab) {
        Tab.Home -> HomeScreen()
        Tab.Movies -> MoviesScreen()
        Tab.Shows -> ShowsScreen()
        Tab.Genres -> GenresScreen()
        Tab.Search -> SearchScreen()
    }
}

@Composable
private fun Page(screen: Screen) {
    when (screen) {
        is Screen.MovieDetail -> MovieDetailScreen(screen.movie)
        is Screen.ShowDetail -> ShowDetailScreen(screen.show)
        is Screen.Genre -> GenreDetailScreen(screen.name)
        Screen.Account -> AccountScreen()
        Screen.ApproveSignIn -> ApproveSignInScreen()
        Screen.AvatarPicker -> AvatarPickerScreen()
        Screen.Feedback -> FeedbackScreen()
        is Screen.FeedbackThread -> FeedbackThreadScreen(screen.id)
    }
}
