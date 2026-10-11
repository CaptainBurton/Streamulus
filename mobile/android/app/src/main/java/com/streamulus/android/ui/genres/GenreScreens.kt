package com.streamulus.android.ui.genres

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.streamulus.android.data.GenreSummary
import com.streamulus.android.data.MediaItem
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
import com.streamulus.android.ui.components.RemoteImage
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.library.LibraryGrid
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.delay

/** Genre tiles: the admin's image or a random title's banner art. */
@Composable
fun GenresScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    @Suppress("UNCHECKED_CAST")
    var genres by remember { mutableStateOf(session.memory["genres"] as? List<GenreSummary>) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(session.profile) {
        attempt({ error = it }) {
            val loaded = session.getObject("/api/genres").objects("genres").map(GenreSummary::from)
            genres = loaded
            session.memory["genres"] = loaded
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Genres") { AccountButton() }
        Box(Modifier.weight(1f)) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(m.genreTileMinimum),
                contentPadding = PaddingValues(start = m.margin, end = m.margin, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(genres ?: emptyList(), key = { it.name }) { genre ->
                    GenreTile(genre) { navigator.push(Screen.Genre(genre.name)) }
                }
            }
            ListStatus(loading = genres == null, error = error, isEmpty = genres.isNullOrEmpty(), emptyText = "No genres yet")
        }
    }
}

@Composable
private fun GenreTile(genre: GenreSummary, onClick: () -> Unit) {
    val session = LocalSession.current
    val counts = listOfNotNull(
        genre.movieCount.takeIf { it > 0 }?.let { "$it movie${if (it == 1) "" else "s"}" },
        genre.showCount.takeIf { it > 0 }?.let { "$it show${if (it == 1) "" else "s"}" },
    ).joinToString(" · ")
    Box(
        Modifier.fillMaxWidth().aspectRatio(16f / 9f).clip(RoundedCornerShape(14.dp))
            .background(Brush.linearGradient(listOf(Color(0xFF1A2940), Color(0xFF291A3B))))
            .clickable(onClick = onClick),
    ) {
        RemoteImage(session.imageUrl(genre.imageUrl), Modifier.fillMaxSize())
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.4f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.85f))))
        Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
            Text(genre.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Black, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (counts.isNotEmpty()) Text(counts, style = MaterialTheme.typography.labelSmall, color = Brand.Secondary, maxLines = 1)
        }
    }
}

private enum class GenreFilter(val label: String) { All("All"), Movies("Movies"), Shows("TV Shows") }

/** A genre's titles with an All / Movies / TV Shows switch above the A–Z grid. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GenreDetailScreen(name: String) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    var movies by remember { mutableStateOf<List<Movie>?>(null) }
    var shows by remember { mutableStateOf<List<Show>>(emptyList()) }
    var filter by rememberSaveable { mutableStateOf(GenreFilter.All) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(name, session.profile) {
        attempt({ error = it }) {
            // Plain name: the request builder encodes the path itself.
            val response = session.getObject("/api/genres/$name")
            shows = response.objects("shows").map(Show::from)
            movies = response.objects("movies").map(Movie::from)
        }
    }

    val allMovies = movies ?: emptyList()
    val items: List<MediaItem> =
        (if (filter == GenreFilter.Shows) emptyList() else allMovies.map { MediaItem.MovieItem(it) }) +
            (if (filter == GenreFilter.Movies) emptyList() else shows.map { MediaItem.ShowItem(it) })
    fun count(f: GenreFilter) = when (f) {
        GenreFilter.All -> allMovies.size + shows.size
        GenreFilter.Movies -> allMovies.size
        GenreFilter.Shows -> shows.size
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(name, onBack = { navigator.pop() })
        Box(Modifier.weight(1f)) {
            LibraryGrid(
                items = items,
                key = { it.key },
                title = { it.title },
                subtitle = { item ->
                    when (item) {
                        is MediaItem.MovieItem -> listOfNotNull("Movie", item.movie.year?.toString()).joinToString(" · ")
                        is MediaItem.ShowItem -> listOfNotNull("TV Show", item.show.year).joinToString(" · ")
                    }
                },
                imageUrl = { item ->
                    when (item) {
                        is MediaItem.MovieItem -> session.imageUrl(item.movie.posterPath)
                        is MediaItem.ShowItem -> session.imageUrl(item.show.posterPath)
                    }
                },
                onClick = { item ->
                    when (item) {
                        is MediaItem.MovieItem -> navigator.push(Screen.MovieDetail(item.movie))
                        is MediaItem.ShowItem -> navigator.push(Screen.ShowDetail(item.show))
                    }
                },
                header = {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
                        GenreFilter.entries.forEachIndexed { index, option ->
                            SegmentedButton(
                                selected = filter == option,
                                onClick = { filter = option },
                                shape = SegmentedButtonDefaults.itemShape(index, GenreFilter.entries.size),
                            ) { Text("${option.label} (${count(option)})", maxLines = 1) }
                        }
                    }
                },
            )
            ListStatus(loading = movies == null, error = error, isEmpty = movies == null || (allMovies.isEmpty() && shows.isEmpty()), emptyText = "Nothing in $name")
        }
    }
}

/** The search tab: movies and shows by title (English titles too). */
@Composable
fun SearchScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    var query by rememberSaveable { mutableStateOf("") }
    var movies by remember { mutableStateOf<List<Movie>>(emptyList()) }
    var shows by remember { mutableStateOf<List<Show>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    val text = query.trim()

    LaunchedEffect(text) {
        if (text.isEmpty()) {
            movies = emptyList()
            shows = emptyList()
            return@LaunchedEffect
        }
        delay(300) // wait until typing pauses
        searching = true
        val params = mapOf("search" to text, "limit" to "60")
        movies = runCatching { session.getObject("/api/movies", params).objects("movies").map(Movie::from) }.getOrDefault(emptyList())
        shows = runCatching { session.getObject("/api/tv", params).objects("shows").map(Show::from) }.getOrDefault(emptyList())
        searching = false
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Search") { AccountButton() }
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            placeholder = { Text("Movies and TV shows") },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear") }
            },
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.fillMaxWidth().padding(horizontal = m.margin).padding(bottom = 8.dp),
        )
        Box(Modifier.weight(1f)) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(m.gridMinimum),
                contentPadding = PaddingValues(start = m.margin, end = m.margin, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                if (movies.isNotEmpty()) {
                    item(key = "movies-title", span = { GridItemSpan(maxLineSpan) }) { ResultsTitle("Movies") }
                    items(movies, key = { "m${it.id}" }) { movie ->
                        PosterCard(movie.title, movie.year?.toString(), session.imageUrl(movie.posterPath), { navigator.push(Screen.MovieDetail(movie)) })
                    }
                }
                if (shows.isNotEmpty()) {
                    item(key = "shows-title", span = { GridItemSpan(maxLineSpan) }) { ResultsTitle("TV Shows") }
                    items(shows, key = { "s${it.id}" }) { show ->
                        PosterCard(show.title, show.year, session.imageUrl(show.posterPath), { navigator.push(Screen.ShowDetail(show)) })
                    }
                }
            }
            when {
                text.isEmpty() -> ListStatus(loading = false, error = null, isEmpty = true, emptyText = "Find movies and TV shows by title.")
                !searching && movies.isEmpty() && shows.isEmpty() -> ListStatus(loading = false, error = null, isEmpty = true, emptyText = "No results for “$text”")
            }
        }
    }
}

@Composable
private fun ResultsTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp))
}
