package com.streamulus.android.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Movie
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Tv
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshots.SnapshotStateList
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.vector.ImageVector
import com.streamulus.android.data.Movie
import com.streamulus.android.data.Session
import com.streamulus.android.data.Show

/** The tabs: a bottom bar on phones, a navigation rail on tablets. */
enum class Tab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Movies("Movies", Icons.Filled.Movie),
    Shows("TV Shows", Icons.Filled.Tv),
    Genres("Genres", Icons.Filled.GridView),
    Search("Search", Icons.Filled.Search),
}

/** A page opened on top of a tab. */
sealed interface Screen {
    data class MovieDetail(val movie: Movie) : Screen
    data class ShowDetail(val show: Show) : Screen
    data class Genre(val name: String) : Screen
    data object Account : Screen
    data object ApproveSignIn : Screen
    data object AvatarPicker : Screen
    data object Feedback : Screen
    data class FeedbackThread(val id: Int) : Screen
}

/** One open page, with a unique key for its saved state (scroll position etc.). */
data class Entry(val id: Long, val screen: Screen)

/** Each tab keeps its own stack of pages, like the iPhone app's navigation stacks. */
class Navigator {
    var tab by mutableStateOf(Tab.Home)
        private set
    private val stacks: Map<Tab, SnapshotStateList<Entry>> = Tab.entries.associateWith { mutableStateListOf() }
    private var nextId = 1L

    val stack: SnapshotStateList<Entry> get() = stacks.getValue(tab)

    fun push(screen: Screen) {
        stack.add(Entry(nextId++, screen))
    }

    /** Back: the previous page, or false when the tab is already at its start. */
    fun pop(): Boolean {
        if (stack.isEmpty()) return false
        stack.removeAt(stack.lastIndex)
        return true
    }

    /** Choosing the tab you're on goes back to its start. */
    fun select(target: Tab) {
        if (target == tab) stack.clear() else tab = target
    }

    fun reset() {
        stacks.values.forEach { it.clear() }
        tab = Tab.Home
    }
}

val LocalSession = staticCompositionLocalOf<Session> { error("No Session provided") }
val LocalNavigator = staticCompositionLocalOf<Navigator> { error("No Navigator provided") }
