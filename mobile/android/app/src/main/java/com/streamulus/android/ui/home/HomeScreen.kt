package com.streamulus.android.ui.home

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamulus.android.data.ContinueItem
import com.streamulus.android.data.Fmt
import com.streamulus.android.data.MediaType
import com.streamulus.android.data.Movie
import com.streamulus.android.data.Session
import com.streamulus.android.data.Show
import com.streamulus.android.data.StreamingService
import com.streamulus.android.data.WatchProgress
import com.streamulus.android.data.int
import com.streamulus.android.data.obj
import com.streamulus.android.data.objects
import com.streamulus.android.player.play
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.AccountButton
import com.streamulus.android.ui.components.BrandMark
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.Pill
import com.streamulus.android.ui.components.PosterCard
import com.streamulus.android.ui.components.RemoteImage
import com.streamulus.android.ui.components.Shelf
import com.streamulus.android.ui.components.TitleLogo
import com.streamulus.android.ui.components.WideCard
import com.streamulus.android.ui.services.ServiceTile
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private class HomeData(val featured: Movie?, val rotateSeconds: Int, val continueItems: List<ContinueItem>, val services: List<StreamingService>, val movies: List<Movie>, val shows: List<Show>)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val m = LocalMetrics.current
    val scope = rememberCoroutineScope()
    val cached = session.memory["home"] as? HomeData
    var featured by remember { mutableStateOf(cached?.featured) }
    var rotateSeconds by remember { mutableIntStateOf(cached?.rotateSeconds ?: 120) }
    var continueItems by remember { mutableStateOf(cached?.continueItems ?: emptyList()) }
    var services by remember { mutableStateOf(cached?.services ?: emptyList()) }
    var movies by remember { mutableStateOf(cached?.movies ?: emptyList()) }
    var shows by remember { mutableStateOf(cached?.shows ?: emptyList()) }
    var loaded by remember { mutableStateOf(cached != null) }
    var refreshing by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

    suspend fun load() {
        // Each row on its own, so one failed request doesn't empty the others.
        runCatching { session.getObject("/api/stream/continue-watching").objects("items").map(ContinueItem::from) }.onSuccess { continueItems = it }
        runCatching { session.getObject("/api/services").objects("services").map(StreamingService::from) }.onSuccess { services = it }
        runCatching { session.getObject("/api/movies/recent").objects("movies").map(Movie::from) }.onSuccess { movies = it }
        runCatching { session.getObject("/api/tv/recent").objects("shows").map(Show::from) }.onSuccess { shows = it }
        if (featured == null) {
            runCatching { session.getObject("/api/movies/featured") }.onSuccess { response ->
                featured = response.obj("movie")?.let(Movie::from)
                response.int("rotateSeconds")?.takeIf { it > 0 }?.let { rotateSeconds = it }
            }
        }
        loaded = true
        session.memory["home"] = HomeData(featured, rotateSeconds, continueItems, services, movies, shows)
    }

    // Reload when the player closes (Continue Watching) or the profile changes.
    LaunchedEffect(session.playbackGeneration, session.profile) { load() }
    // A different featured movie every rotateSeconds (Admin › Settings › Home Page).
    LaunchedEffect(featured?.id, rotateSeconds) {
        val current = featured?.id ?: return@LaunchedEffect
        delay(rotateSeconds * 1000L)
        val response = runCatching { session.getObject("/api/movies/featured", mapOf("exclude" to current.toString())) }.getOrNull() ?: return@LaunchedEffect
        response.int("rotateSeconds")?.takeIf { it > 0 }?.let { rotateSeconds = it }
        response.obj("movie")?.let(Movie::from)?.takeIf { it.id != current }?.let { featured = it }
    }

    Box(Modifier.fillMaxSize()) {
        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                scope.launch {
                    refreshing = true
                    load()
                    refreshing = false
                }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                item(key = "hero") {
                    val movie = featured
                    if (movie != null) {
                        Crossfade(targetState = movie, animationSpec = tween(900), label = "featured") { shown ->
                            FeaturedBanner(shown, session) { start ->
                                context.play(MediaType.Movie, shown.id, start, shown.title)
                            }
                        }
                    } else {
                        Box(Modifier.fillMaxWidth().statusBarsPadding().height(if (loaded) 64.dp else 220.dp), contentAlignment = Alignment.Center) {
                            if (!loaded) CircularProgressIndicator()
                        }
                    }
                }
                if (continueItems.isNotEmpty()) {
                    item(key = "continue") {
                        Shelf("Continue Watching") {
                            items(continueItems, key = { it.key }) { item ->
                                val type = if (item.type == "movie") MediaType.Movie else MediaType.Episode
                                WideCard(
                                    title = item.title,
                                    subtitle = item.subtitle,
                                    imageUrls = listOfNotNull(
                                        session.stillUrl(item.type, item.mediaId, item.position),
                                        session.imageUrl(item.backdropPath),
                                        session.imageUrl(item.posterPath),
                                    ),
                                    progress = item.duration?.takeIf { it > 0 }?.let { item.position.toDouble() / it },
                                    width = m.wideCardWidth,
                                    onClick = { context.play(type, item.mediaId, item.position, item.title, item.subtitle) },
                                )
                            }
                        }
                    }
                }
                // Netflix, Disney+… (Admin › Streaming Services), just under Continue Watching.
                if (services.isNotEmpty()) {
                    item(key = "services") {
                        Shelf("Streaming Services") {
                            items(services, key = { it.id }) { service ->
                                ServiceTile(service, m.serviceTileWidth) { navigator.push(Screen.Service(service)) }
                            }
                        }
                    }
                }
                if (movies.isNotEmpty()) {
                    item(key = "movies") {
                        Shelf("Recently Added Movies") {
                            items(movies, key = { it.id }) { movie ->
                                PosterCard(movie.title, movie.year?.toString(), session.imageUrl(movie.posterPath), { navigator.push(Screen.MovieDetail(movie)) }, width = m.posterWidth)
                            }
                        }
                    }
                }
                if (shows.isNotEmpty()) {
                    item(key = "shows") {
                        Shelf("Recently Added Shows") {
                            items(shows, key = { it.id }) { show ->
                                PosterCard(show.title, show.year, session.imageUrl(show.posterPath), { navigator.push(Screen.ShowDetail(show)) }, width = m.posterWidth)
                            }
                        }
                    }
                }
                if (loaded && featured == null && continueItems.isEmpty() && movies.isEmpty() && shows.isEmpty()) {
                    item(key = "empty") {
                        Column(Modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("Nothing here yet", style = MaterialTheme.typography.titleLarge)
                            Text("Add a library in Streamulus on the web.", color = Brand.Secondary)
                        }
                    }
                }
                item(key = "end") { Spacer(Modifier.height(24.dp)) }
            }
        }

        // Pinned at the top (doesn't move when the page is pulled down): logo and profile picture.
        Row(
            Modifier.fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent)))
                .statusBarsPadding().padding(start = m.margin, end = 8.dp, top = 6.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            BrandMark(18.dp)
            Spacer(Modifier.weight(1f))
            AccountButton()
        }
    }
}

/** Netflix-style banner: artwork, title logo, Play and More Info. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun FeaturedBanner(movie: Movie, session: Session, onPlay: (Int) -> Unit) {
    val m = LocalMetrics.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxWidth().height(m.heroHeight)) {
        RemoteImage(session.imageUrl(movie.backdropPath ?: movie.posterPath), Modifier.fillMaxSize())
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.45f),
                    0.22f to Color.Transparent,
                    0.45f to Color.Transparent,
                    0.82f to Brand.Background.copy(alpha = 0.85f),
                    1f to Brand.Background,
                ),
            ),
        )
        Column(
            Modifier.align(Alignment.BottomStart).padding(horizontal = m.margin).padding(bottom = 4.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TitleLogo(session.imageUrl(movie.logoPath), movie.title, if (m.wide) 420.dp else 280.dp, if (m.wide) 150.dp else 100.dp, if (m.wide) 40.sp else 30.sp)
            FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                movie.year?.let { Text(it.toString(), color = Brand.Secondary) }
                movie.duration?.takeIf { it > 0 }?.let { Text(Fmt.runtime(it), color = Brand.Secondary) }
                movie.contentRating?.let { Pill(it) }
            }
            if (m.wide && !movie.overview.isNullOrBlank()) {
                Text(movie.overview, maxLines = 3, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 620.dp))
            }
            Row(Modifier.widthIn(max = 440.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Button(
                    onClick = {
                        // Resume if it's part watched, otherwise start from the beginning.
                        scope.launch {
                            val progress = runCatching { WatchProgress.from(session.getObject("/api/stream/progress/movie/${movie.id}")) }.getOrNull()
                            onPlay(progress?.takeIf { !it.completed && it.position > 10 }?.position ?: 0)
                        }
                    },
                    modifier = Modifier.weight(1f),
                ) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null)
                    Text(" Play")
                }
                FilledTonalButton(onClick = { navigator.push(Screen.MovieDetail(movie)) }, modifier = Modifier.weight(1f)) {
                    Icon(Icons.Filled.Info, contentDescription = null)
                    Text(" More Info")
                }
            }
        }
    }
}
