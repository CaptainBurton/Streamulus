package com.streamulus.android.ui.detail

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamulus.android.data.Episode
import com.streamulus.android.data.Fmt
import com.streamulus.android.data.MediaType
import com.streamulus.android.data.Movie
import com.streamulus.android.data.MovieDetails
import com.streamulus.android.data.Session
import com.streamulus.android.data.Show
import com.streamulus.android.data.ShowDetails
import com.streamulus.android.data.WatchProgress
import com.streamulus.android.data.objects
import com.streamulus.android.player.play
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.AccountButton
import com.streamulus.android.ui.components.CastRow
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.Metrics
import com.streamulus.android.ui.components.Pill
import com.streamulus.android.ui.components.PosterCard
import com.streamulus.android.ui.components.ProgressStrip
import com.streamulus.android.ui.components.RemoteImage
import com.streamulus.android.ui.components.Shelf
import com.streamulus.android.ui.components.TitleLogo
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

// ── Shared pieces ────────────────────────────────────────────────────────────

/** Backdrop with a fade into the page and the title logo at the bottom-left. */
@Composable
private fun DetailHeader(backdrop: String?, logo: String?, title: String, m: Metrics) {
    Box(Modifier.fillMaxWidth().height(m.detailHeaderHeight)) {
        RemoteImage(backdrop, Modifier.fillMaxSize())
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    0f to Color.Black.copy(alpha = 0.45f),
                    0.3f to Color.Transparent,
                    0.78f to Brand.Background.copy(alpha = 0.75f),
                    1f to Brand.Background,
                ),
            ),
        )
        Box(Modifier.align(Alignment.BottomStart).padding(horizontal = m.margin)) {
            TitleLogo(logo, title, if (m.wide) 440.dp else 280.dp, if (m.wide) 150.dp else 96.dp, if (m.wide) 40.sp else 30.sp)
        }
    }
}

/** Back arrow and profile picture over the artwork. */
@Composable
private fun FloatingBar(onBack: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.5f), Color.Transparent)))
            .statusBarsPadding().padding(horizontal = 4.dp, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack, modifier = Modifier.clip(CircleShape).background(Color.Black.copy(alpha = 0.35f))) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
        }
        Spacer(Modifier.weight(1f))
        AccountButton()
    }
}

/** One big primary button, then the rest side by side (all in one row on tablets). */
@Composable
private fun ActionButtons(m: Metrics, primary: @Composable RowScope.() -> Unit, secondary: @Composable RowScope.() -> Unit) {
    if (m.wide) {
        Row(Modifier.widthIn(max = m.buttonRowMaxWidth), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            primary()
            secondary()
        }
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth()) { primary() }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { secondary() }
        }
    }
}

@Composable
private fun RowScope.PrimaryButton(text: String, icon: ImageVector, onClick: () -> Unit) {
    Button(onClick = onClick, modifier = Modifier.weight(1f)) {
        Icon(icon, contentDescription = null)
        Text(" $text", maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun RowScope.SecondaryButton(text: String, icon: ImageVector, enabled: Boolean = true, onClick: () -> Unit) {
    FilledTonalButton(onClick = onClick, enabled = enabled, modifier = Modifier.weight(1f)) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Text(" $text", maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

private suspend fun Session.markWatched(mediaType: String, id: Int, watched: Boolean) =
    post("/api/stream/watched", buildJsonObject {
        put("mediaType", mediaType)
        put("mediaId", id)
        put("watched", watched)
    })

// ── Movie ────────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MovieDetailScreen(movie: Movie) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val m = LocalMetrics.current
    val scope = rememberCoroutineScope()
    var details by remember { mutableStateOf<MovieDetails?>(null) }
    var progress by remember { mutableStateOf(WatchProgress.None) }
    var saving by remember { mutableStateOf(false) }

    LaunchedEffect(movie.id, session.profile, session.playbackGeneration) {
        runCatching { MovieDetails.from(session.getObject("/api/movies/${movie.id}/details")) }.getOrNull()?.let { details = it }
        runCatching { WatchProgress.from(session.getObject("/api/stream/progress/movie/${movie.id}")) }.getOrNull()?.let { progress = it }
    }

    val shown = details?.movie ?: movie
    val inProgress = !progress.completed && progress.position > 10
    val remaining = shown.duration?.takeIf { it > 0 }?.let { maxOf(0, it - if (inProgress) progress.position else 0) } ?: 0
    fun play(start: Int) = context.play(MediaType.Movie, movie.id, start, shown.title)

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 30.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            item {
                DetailHeader(session.imageUrl(shown.backdropPath ?: shown.posterPath), session.imageUrl(shown.logoPath), shown.title, m)
            }
            item {
                Column(Modifier.padding(horizontal = m.margin), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        shown.year?.let { Text(it.toString(), color = Brand.Secondary) }
                        shown.duration?.takeIf { it > 0 }?.let { Text(Fmt.runtime(it), color = Brand.Secondary) }
                        shown.contentRating?.let { Pill(it) }
                        shown.rating?.takeIf { it > 0 }?.let { score ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Filled.Star, contentDescription = null, tint = Color(0xFFFFD60A), modifier = Modifier.size(16.dp))
                                Text(" %.1f".format(score), color = Color(0xFFFFD60A))
                            }
                        }
                        if (remaining > 0) Pill((if (inProgress) "${Fmt.runtime(remaining)} left · " else "") + "Ends at ${Fmt.endsAt(remaining)}")
                    }
                    if (shown.genres.isNotEmpty()) Text(shown.genres.joinToString(" · "), color = Brand.Accent, style = MaterialTheme.typography.bodyMedium)

                    ActionButtons(
                        m,
                        primary = {
                            PrimaryButton(if (inProgress) "Resume from ${Fmt.clock(progress.position)}" else "Play", Icons.Filled.PlayArrow) {
                                play(if (inProgress) progress.position else 0)
                            }
                        },
                        secondary = {
                            if (inProgress) SecondaryButton("From Beginning", Icons.Filled.Replay) { play(0) }
                            SecondaryButton(if (progress.completed) "Unwatched" else "Watched", if (progress.completed) Icons.Filled.VisibilityOff else Icons.Filled.Check, enabled = !saving) {
                                scope.launch {
                                    saving = true
                                    val watched = !progress.completed
                                    if (runCatching { session.markWatched("movie", movie.id, watched) }.isSuccess) {
                                        progress = WatchProgress(0, watched)
                                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                                    }
                                    saving = false
                                }
                            }
                        },
                    )

                    shown.overview?.takeIf { it.isNotBlank() }?.let { Text(it, modifier = Modifier.widthIn(max = 760.dp)) }
                    details?.director?.takeIf { it.isNotBlank() }?.let { Text("Directed by $it", color = Brand.Secondary, style = MaterialTheme.typography.bodyMedium) }
                }
            }
            details?.cast?.takeIf { it.isNotEmpty() }?.let { cast -> item { CastRow(cast) } }
            details?.similar?.takeIf { it.isNotEmpty() }?.let { similar ->
                item {
                    Shelf("More Like This") {
                        items(similar, key = { it.id }) { other ->
                            PosterCard(other.title, other.year?.toString(), session.imageUrl(other.posterPath), { navigator.push(Screen.MovieDetail(other)) }, width = m.posterWidth)
                        }
                    }
                }
            }
        }
        FloatingBar(onBack = { navigator.pop() })
    }
}

// ── TV show ──────────────────────────────────────────────────────────────────

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ShowDetailScreen(show: Show) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val m = LocalMetrics.current
    val scope = rememberCoroutineScope()
    var details by remember { mutableStateOf<ShowDetails?>(null) }
    var season by rememberSaveable { mutableStateOf<Int?>(null) }
    var episodes by remember { mutableStateOf<List<Episode>>(emptyList()) }
    var saving by remember { mutableStateOf(false) }
    var reload by remember { mutableIntStateOf(0) }

    suspend fun loadEpisodes() {
        val s = season ?: return
        runCatching { session.getObject("/api/tv/${show.id}/season/$s").objects("episodes").map(Episode::from) }.getOrNull()?.let { episodes = it }
    }

    LaunchedEffect(show.id, session.profile, session.playbackGeneration, reload) {
        val response = runCatching { ShowDetails.from(session.getObject("/api/tv/${show.id}/details")) }.getOrNull() ?: return@LaunchedEffect
        details = response
        if (season == null || response.seasons.none { it.season == season }) {
            // Start on the first season that isn't finished; Specials only if nothing else is left.
            val ordered = response.seasons.filter { it.season > 0 } + response.seasons.filter { it.season == 0 }
            season = (ordered.firstOrNull { it.watchedCount < it.episodeCount } ?: ordered.firstOrNull())?.season
        }
        loadEpisodes()
    }
    LaunchedEffect(season) { loadEpisodes() }

    val shown = details?.show ?: show
    val seasons = details?.seasons ?: emptyList()
    val allWatched = seasons.isNotEmpty() && seasons.all { it.finished }
    val upNext = episodes.firstOrNull { !it.watchCompleted }
    fun play(episode: Episode, fromStart: Boolean = false) = context.play(
        MediaType.Episode, episode.id, if (episode.inProgress && !fromStart) episode.watchPosition else 0,
        shown.title, episode.label + (episode.title?.let { " · $it" } ?: ""),
    )

    Box(Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 30.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                DetailHeader(session.imageUrl(shown.backdropPath ?: shown.posterPath), session.imageUrl(shown.logoPath), shown.title, m)
            }
            item {
                Column(Modifier.padding(horizontal = m.margin), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                        shown.year?.let { Text(it, color = Brand.Secondary) }
                        Text("${seasons.size} season${if (seasons.size == 1) "" else "s"}", color = Brand.Secondary)
                        shown.contentRating?.let { Pill(it) }
                        if (allWatched) Pill("✓ WATCHED", Brand.Success)
                    }
                    if (shown.genres.isNotEmpty()) Text(shown.genres.joinToString(" · "), color = Brand.Accent, style = MaterialTheme.typography.bodyMedium)

                    ActionButtons(
                        m,
                        primary = {
                            if (upNext != null) PrimaryButton("${if (upNext.inProgress) "Resume" else "Play"} ${upNext.label}", Icons.Filled.PlayArrow) { play(upNext) }
                        },
                        secondary = {
                            val first = details?.firstEpisodeId
                            if (details?.started == true && first != null) {
                                SecondaryButton("From Beginning", Icons.Filled.Replay) {
                                    context.play(MediaType.Episode, first, 0, shown.title)
                                }
                            }
                            SecondaryButton(if (allWatched) "Unwatched" else "Watched", if (allWatched) Icons.Filled.VisibilityOff else Icons.Filled.Check, enabled = !saving && seasons.isNotEmpty()) {
                                scope.launch {
                                    saving = true
                                    runCatching { session.markWatched("show", show.id, !allWatched) }
                                    reload++
                                    saving = false
                                }
                            }
                        },
                    )
                    shown.overview?.takeIf { it.isNotBlank() }?.let { Text(it, modifier = Modifier.widthIn(max = 760.dp)) }
                }
            }
            if (seasons.size > 1) {
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = m.margin), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(seasons, key = { it.season }) { s ->
                            FilterChip(
                                selected = s.season == season,
                                onClick = { season = s.season },
                                label = { Text(s.label) },
                                leadingIcon = if (s.finished) ({ Icon(Icons.Filled.CheckCircle, contentDescription = "Watched", modifier = Modifier.size(16.dp)) }) else null,
                            )
                        }
                    }
                }
            }
            items(episodes, key = { "e${it.id}" }) { episode ->
                EpisodeRow(
                    episode = episode,
                    onPlay = { play(episode) },
                    onPlayFromStart = { play(episode, fromStart = true) },
                    onToggleWatched = {
                        scope.launch {
                            runCatching { session.markWatched("episode", episode.id, !episode.watchCompleted) }
                            reload++
                        }
                    },
                )
            }
            details?.cast?.takeIf { it.isNotEmpty() }?.let { cast -> item { CastRow(cast) } }
            details?.similar?.takeIf { it.isNotEmpty() }?.let { similar ->
                item {
                    Shelf("More Like This") {
                        items(similar, key = { it.id }) { other ->
                            PosterCard(other.title, other.year, session.imageUrl(other.posterPath), { navigator.push(Screen.ShowDetail(other)) }, width = m.posterWidth)
                        }
                    }
                }
            }
        }
        FloatingBar(onBack = { navigator.pop() })
    }
}

/** An episode: tap to play (resumes if part watched); long-press for more. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun EpisodeRow(episode: Episode, onPlay: () -> Unit, onPlayFromStart: () -> Unit, onToggleWatched: () -> Unit) {
    val session = LocalSession.current
    val haptics = LocalHapticFeedback.current
    val m = LocalMetrics.current
    var menu by remember { mutableStateOf(false) }
    Box(Modifier.padding(horizontal = m.margin)) {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).combinedClickable(
                onClick = onPlay,
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    menu = true
                },
            ),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(Modifier.width(m.stillWidth).aspectRatio(16f / 9f).clip(RoundedCornerShape(10.dp))) {
                RemoteImage(session.imageUrl(episode.stillPath), Modifier.fillMaxSize(), placeholder = episode.label)
                Box(Modifier.align(Alignment.Center).size(30.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(18.dp))
                }
                val duration = episode.duration ?: 0
                if (episode.inProgress && duration > 0) {
                    ProgressStrip(episode.watchPosition.toDouble() / duration, Modifier.align(Alignment.BottomCenter))
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("${episode.episodeNumber}. ${episode.displayTitle}", style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (episode.watchCompleted) Icon(Icons.Filled.CheckCircle, contentDescription = "Watched", tint = Brand.Success, modifier = Modifier.padding(start = 6.dp).size(16.dp))
                }
                episode.duration?.takeIf { it > 0 }?.let { duration ->
                    // Finished episodes replay from the start; in-progress ones resume.
                    val left = if (episode.inProgress) maxOf(0, duration - episode.watchPosition) else duration
                    Text(
                        (if (episode.inProgress) "${Fmt.runtime(left)} left" else Fmt.runtime(duration)) + " · Ends at ${Fmt.endsAt(left)}",
                        style = MaterialTheme.typography.labelSmall, color = Brand.Secondary,
                    )
                }
                episode.overview?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, maxLines = if (m.wide) 3 else 2, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text(if (episode.inProgress) "Resume" else "Play") }, leadingIcon = { Icon(Icons.Filled.PlayArrow, null) }, onClick = { menu = false; onPlay() })
            if (episode.inProgress) {
                DropdownMenuItem(text = { Text("Play from Beginning") }, leadingIcon = { Icon(Icons.Filled.Replay, null) }, onClick = { menu = false; onPlayFromStart() })
            }
            DropdownMenuItem(
                text = { Text(if (episode.watchCompleted) "Mark as Unwatched" else "Mark as Watched") },
                leadingIcon = { Icon(if (episode.watchCompleted) Icons.Filled.VisibilityOff else Icons.Filled.Check, null) },
                onClick = { menu = false; onToggleWatched() },
            )
        }
    }
}
