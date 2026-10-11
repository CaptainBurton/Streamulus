package com.streamulus.android.ui.library

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamulus.android.data.Movie
import com.streamulus.android.data.Show
import com.streamulus.android.data.objects
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.AccountButton
import com.streamulus.android.ui.components.ListStatus
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.PosterCard
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.Normalizer

private val libraryQuery = mapOf("sort" to "title", "order" to "ASC", "limit" to "5000")

@Composable
fun MoviesScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    @Suppress("UNCHECKED_CAST")
    var movies by remember { mutableStateOf(session.memory["movies"] as? List<Movie>) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(session.profile, session.playbackGeneration) {
        attempt({ error = it }) {
            val loaded = session.getObject("/api/movies", libraryQuery).objects("movies").map(Movie::from)
            movies = loaded
            session.memory["movies"] = loaded
            error = null
        }
    }

    val text = filter.trim()
    val shown = (movies ?: emptyList()).let { all -> if (text.isEmpty()) all else all.filter { it.title.contains(text, ignoreCase = true) } }
    LibraryPage("Movies", filter, { filter = it }, "Filter movies") {
        LibraryGrid(
            items = shown,
            key = { "m${it.id}" },
            title = { it.title },
            subtitle = { it.year?.toString() },
            imageUrl = { session.imageUrl(it.posterPath) },
            progress = { movie ->
                val duration = movie.duration ?: 0
                if (movie.watchPosition > 10 && !movie.watchCompleted && duration > 0) movie.watchPosition.toDouble() / duration else null
            },
            onClick = { navigator.push(Screen.MovieDetail(it)) },
        )
        ListStatus(loading = movies == null, error = error, isEmpty = movies.isNullOrEmpty(), emptyText = "No movies yet")
    }
}

@Composable
fun ShowsScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    @Suppress("UNCHECKED_CAST")
    var shows by remember { mutableStateOf(session.memory["shows"] as? List<Show>) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by rememberSaveable { mutableStateOf("") }

    LaunchedEffect(session.profile, session.playbackGeneration) {
        attempt({ error = it }) {
            val loaded = session.getObject("/api/tv", libraryQuery).objects("shows").map(Show::from)
            shows = loaded
            session.memory["shows"] = loaded
            error = null
        }
    }

    val text = filter.trim()
    val shown = (shows ?: emptyList()).let { all -> if (text.isEmpty()) all else all.filter { it.title.contains(text, ignoreCase = true) } }
    LibraryPage("TV Shows", filter, { filter = it }, "Filter shows") {
        LibraryGrid(
            items = shown,
            key = { "s${it.id}" },
            title = { it.title },
            subtitle = { show -> if (show.totalEpisodes > 0 && show.watchedEpisodes >= show.totalEpisodes) "Watched" else show.year },
            imageUrl = { session.imageUrl(it.posterPath) },
            onClick = { navigator.push(Screen.ShowDetail(it)) },
        )
        ListStatus(loading = shows == null, error = error, isEmpty = shows.isNullOrEmpty(), emptyText = "No TV shows yet")
    }
}

@Composable
private fun LibraryPage(title: String, filter: String, onFilter: (String) -> Unit, prompt: String, content: @Composable androidx.compose.foundation.layout.BoxScope.() -> Unit) {
    val m = LocalMetrics.current
    Column(Modifier.fillMaxSize()) {
        TopBar(title) { AccountButton() }
        OutlinedTextField(
            value = filter,
            onValueChange = onFilter,
            placeholder = { Text(prompt) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (filter.isNotEmpty()) IconButton(onClick = { onFilter("") }) { Icon(Icons.Filled.Close, contentDescription = "Clear") }
            },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().padding(horizontal = m.margin).padding(bottom = 8.dp),
        )
        Box(Modifier.weight(1f).fillMaxWidth(), content = content)
    }
}

/** Titles sorted ignoring The / A / An, grouped under letters ("#" first, then A–Z). */
private class LetterGroup<T>(val letter: String, val items: List<T>)

private fun sortKey(title: String): String {
    val trimmed = title.trim()
    for (article in listOf("The ", "A ", "An ")) {
        if (trimmed.length > article.length && trimmed.startsWith(article)) return trimmed.substring(article.length)
    }
    return trimmed
}

/** "Élite" → E, "'Salem's Lot" → S, "2 Fast 2 Furious" → #. */
private fun indexLetter(title: String): String {
    val folded = Normalizer.normalize(sortKey(title), Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "")
    val first = folded.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar() ?: return "#"
    return if (first in 'A'..'Z') first.toString() else "#"
}

/**
 * A–Z poster grid grouped under letters, with an index down the right edge you
 * can tap or drag along. `header` scrolls with the grid (e.g. a genre's filter).
 */
@Composable
fun <T> LibraryGrid(
    items: List<T>,
    key: (T) -> String,
    title: (T) -> String,
    subtitle: (T) -> String?,
    imageUrl: (T) -> String?,
    onClick: (T) -> Unit,
    progress: (T) -> Double? = { null },
    header: (@Composable () -> Unit)? = null,
) {
    val m = LocalMetrics.current
    val state = rememberLazyGridState()
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    var bubble by remember { mutableStateOf<String?>(null) }

    val groups = remember(items) {
        items.groupBy { indexLetter(title(it)) }
            .toSortedMap(compareBy<String> { if (it == "#") 0 else 1 }.thenBy { it })
            .map { (letter, group) -> LetterGroup(letter, group.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { sortKey(title(it)) })) }
    }
    // Where each letter's heading is in the grid.
    val letterIndex = remember(groups, header != null) {
        var index = if (header != null) 1 else 0
        groups.associate { group -> (group.letter to index).also { index += 1 + group.items.size } }
    }
    val showIndex = groups.size > 1

    LaunchedEffect(bubble) {
        if (bubble != null) {
            delay(700)
            bubble = null
        }
    }

    Box(Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Adaptive(m.gridMinimum),
            state = state,
            contentPadding = PaddingValues(start = m.margin, end = if (showIndex) 30.dp else m.margin, bottom = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (header != null) item(key = "header", span = { GridItemSpan(maxLineSpan) }) { header() }
            groups.forEach { group ->
                item(key = "letter-${group.letter}", span = { GridItemSpan(maxLineSpan) }) {
                    Text(group.letter, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black, color = Brand.Secondary, modifier = Modifier.padding(top = 6.dp))
                }
                items(group.items, key = key) { item ->
                    PosterCard(title(item), subtitle(item), imageUrl(item), { onClick(item) }, progress = progress(item))
                }
            }
        }

        if (showIndex) {
            AlphabetIndex(
                letters = groups.map { it.letter },
                modifier = Modifier.align(Alignment.CenterEnd).fillMaxHeight().width(28.dp).padding(vertical = 8.dp),
            ) { letter ->
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                bubble = letter
                letterIndex[letter]?.let { scope.launch { state.scrollToItem(it) } }
            }
        }

        AnimatedVisibility(bubble != null, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.align(Alignment.Center)) {
            Box(Modifier.size(104.dp).clip(RoundedCornerShape(24.dp)).background(Brand.Card.copy(alpha = 0.92f)), contentAlignment = Alignment.Center) {
                Text(bubble ?: "", fontSize = 52.sp, fontWeight = FontWeight.Black)
            }
        }
    }
}

/** Letters down the right edge: tap one, or drag along them. */
@Composable
private fun AlphabetIndex(letters: List<String>, modifier: Modifier, onSelect: (String) -> Unit) {
    var current by remember { mutableStateOf<String?>(null) }
    fun pick(y: Float, height: Int) {
        if (letters.isEmpty() || height <= 0) return
        val index = ((y / height) * letters.size).toInt().coerceIn(0, letters.size - 1)
        val letter = letters[index]
        if (letter != current) {
            current = letter
            onSelect(letter)
        }
    }
    Column(
        modifier
            .pointerInput(letters) {
                detectTapGestures { offset ->
                    current = null
                    pick(offset.y, size.height)
                    current = null
                }
            }
            .pointerInput(letters) {
                detectVerticalDragGestures(
                    onDragStart = { offset -> pick(offset.y, size.height) },
                    onDragEnd = { current = null },
                    onDragCancel = { current = null },
                    onVerticalDrag = { change, _ -> pick(change.position.y, size.height) },
                )
            },
        verticalArrangement = Arrangement.SpaceEvenly,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        letters.forEach { letter ->
            Text(
                letter,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = if (letter == current) Brand.Accent else Brand.Secondary,
            )
        }
    }
}
