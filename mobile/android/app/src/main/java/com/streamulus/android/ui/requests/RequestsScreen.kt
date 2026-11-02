package com.streamulus.android.ui.requests

import com.streamulus.android.data.Show
import com.streamulus.android.R
import androidx.compose.ui.res.painterResource
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.streamulus.android.data.FilmResult
import com.streamulus.android.data.Movie
import com.streamulus.android.data.MovieRequest
import com.streamulus.android.data.RequestsConfig
import com.streamulus.android.data.obj
import com.streamulus.android.data.objects
import com.streamulus.android.data.str
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.ListStatus
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.RemoteImage
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.roundToInt
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import com.streamulus.android.data.GenreOption
import com.streamulus.android.data.PersonResult

/**
 * Requests (Search › Request, or Profile & Settings › Requests): find a film or
 * series that isn't on the server and ask for it (a series whole, or one season
 * once the show is on Streamulus). An admin approves or declines it (you're
 * emailed either way); approved ones download by themselves, and My Requests
 * follows them — series episode by episode — until they're ready to watch.
 * Like the iPhone app and the website.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RequestsScreen(startOnMine: Boolean = false, startQuery: String = "") {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    val scope = rememberCoroutineScope()
    var showMine by rememberSaveable { mutableStateOf(startOnMine) }
    var query by rememberSaveable { mutableStateOf(startQuery) }
    var config by remember { mutableStateOf<RequestsConfig?>(null) }
    var films by remember { mutableStateOf<List<FilmResult>>(emptyList()) }
    var people by remember { mutableStateOf<List<PersonResult>>(emptyList()) }
    var mode by rememberSaveable { mutableStateOf("films") } // films | series | people
    val actors = mode == "people"
    var year by rememberSaveable { mutableStateOf<Int?>(null) }
    var genre by rememberSaveable { mutableStateOf<Int?>(null) }
    var searchedFor by remember { mutableStateOf<String?>(null) }
    var searching by remember { mutableStateOf(false) }
    var mine by remember { mutableStateOf<List<MovieRequest>?>(null) }
    var asking by remember { mutableStateOf<Ask?>(null) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) } // text, is error
    var cancelling by remember { mutableStateOf<MovieRequest?>(null) }
    val text = query.trim()

    fun say(textToShow: String, error: Boolean = false) {
        message = textToShow to error
        scope.launch {
            delay(4500)
            if (message?.first == textToShow) message = null
        }
    }

    suspend fun loadMine() {
        attempt({}) { mine = session.getObject("/api/requests").objects("requests").map(MovieRequest::from) }
    }

    suspend fun search() {
        if (actors && text.isEmpty()) { people = emptyList(); searchedFor = null; return }
        searching = true
        attempt({ say(it, error = true) }) {
            if (actors) {
                people = session.getObject("/api/requests/people", mapOf("q" to text)).objects("people").map(PersonResult::from)
            } else {
                val params = buildMap {
                    put("q", text)
                    year?.let { put("year", it.toString()) }
                    genre?.let { put("genre", it.toString()) }
                    if (mode == "series") put("type", "tv")
                }
                films = session.getObject("/api/requests/search", params).objects("results").map(FilmResult::from)
            }
            searchedFor = text
        }
        searching = false
    }

    fun send(film: FilmResult, note: String, scopeName: String? = null, season: Int? = null) {
        val what = if (scopeName == "season") "${film.title} — Season $season" else film.title
        scope.launch {
            attempt({ say(it, error = true) }) {
                val response = session.post("/api/requests", buildJsonObject {
                    put("tmdbId", film.tmdbId)
                    put("note", note)
                    if (film.isShow) {
                        put("mediaType", "tv")
                        put("scope", scopeName ?: "series")
                        season?.let { put("season", it) }
                    }
                })
                asking = null
                say(
                    if (response["joined"]?.toString() == "true") "Someone had already asked for $what — you'll hear when it's ready too"
                    else "Requested $what — you'll get an email when an admin decides",
                )
                loadMine()
                search()
            }
        }
    }

    fun watch(request: MovieRequest) {
        if (request.isShow) {
            val showId = request.showId ?: return
            scope.launch {
                attempt({ say(it, error = true) }) {
                    session.getObject("/api/tv/$showId/details").obj("show")?.let(Show::from)?.let { navigator.push(Screen.ShowDetail(it)) }
                }
            }
            return
        }
        val id = request.movieId ?: return
        scope.launch {
            attempt({ say(it, error = true) }) {
                val movie = session.getObject("/api/movies/$id").obj("movie")?.let(Movie::from)
                if (movie != null) navigator.push(Screen.MovieDetail(movie))
            }
        }
    }

    LaunchedEffect(Unit) {
        config = attempt({}) { RequestsConfig.from(session.getObject("/api/requests/config")) } ?: RequestsConfig(false, 2.0)
        if (config?.films == false && config?.tv == true) mode = "series"
        if (config?.open == true) {
            loadMine()
            // Something on the go: show its progress first.
            if (!startOnMine && text.isEmpty() && mine.orEmpty().any { it.isActive || it.status == "available" }) showMine = true
        }
    }
    LaunchedEffect(text, config?.open, mode, year, genre) {
        if (config?.open != true) return@LaunchedEffect
        if (text.isNotEmpty()) delay(350) // wait until typing pauses
        search()
    }
    // Keep following downloads while anything is on the go, as often as the admin set.
    val anyActive = mine.orEmpty().any { it.isActive }
    val refreshMs = ((config?.refreshSeconds ?: 2.0).coerceAtLeast(1.0) * 1000).toLong()
    LaunchedEffect(anyActive, refreshMs) {
        while (anyActive && isActive) {
            delay(refreshMs)
            loadMine()
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Requests", onBack = { navigator.pop() })
        Box(Modifier.weight(1f)) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(m.gridMinimum),
                contentPadding = PaddingValues(start = m.margin, end = m.margin, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item(key = "pages", span = { GridItemSpan(maxLineSpan) }) {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        SegmentedButton(selected = !showMine, onClick = { showMine = false }, shape = SegmentedButtonDefaults.itemShape(0, 2)) {
                            Text(findLabel(config))
                        }
                        SegmentedButton(selected = showMine, onClick = { showMine = true; scope.launch { loadMine() } }, shape = SegmentedButtonDefaults.itemShape(1, 2)) {
                            Text(mine?.takeIf { it.isNotEmpty() }?.let { "My Requests · ${it.size}" } ?: "My Requests")
                        }
                    }
                }
                message?.let { (msg, error) ->
                    item(key = "message", span = { GridItemSpan(maxLineSpan) }) {
                        Text(
                            msg,
                            color = if (error) Color(0xFFFF6B6B) else Brand.Success,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                                .background((if (error) Color(0xFFFF4444) else Brand.Success).copy(alpha = 0.1f)).padding(12.dp),
                        )
                    }
                }
                if (config?.open == false) {
                    item(key = "closed", span = { GridItemSpan(maxLineSpan) }) {
                        Text("Requests aren't available right now.", color = Brand.Secondary, modifier = Modifier.padding(vertical = 24.dp))
                    }
                } else if (!showMine) {
                    item(key = "search", span = { GridItemSpan(maxLineSpan) }) {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(
                                value = query,
                                onValueChange = { query = it },
                                placeholder = { Text(if (actors) "Search actors and directors" else if (mode == "series") "Search for a series" else "Search for a film") },
                                leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                                trailingIcon = {
                                    if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Filled.Close, contentDescription = "Clear") }
                                },
                                singleLine = true,
                                shape = RoundedCornerShape(14.dp),
                                modifier = Modifier.fillMaxWidth(),
                            )
                            val genres = (if (mode == "series") config?.tvGenres else config?.genres).orEmpty()
                            FilterRow(
                                mode = mode, onMode = { if (it != mode) { mode = it; genre = null; films = emptyList() } },
                                films = config?.films != false, series = config?.tv == true,
                                year = year, onYear = { year = it },
                                genre = genre, onGenre = { genre = it },
                                genres = genres,
                            )
                            val genreName = genres.firstOrNull { it.id == genre }?.name
                            val noun = if (mode == "series") "series" else "films"
                            Text(
                                when {
                                    actors && text.isEmpty() -> "Actors & Directors"
                                    actors -> "People matching “$text”"
                                    text.isNotEmpty() -> "Results for “$text”" + (year?.let { " · $it" } ?: "") + (genreName?.let { " · $it" } ?: "")
                                    year != null && genreName != null -> "$genreName $noun from $year"
                                    year != null -> (if (mode == "series") "Series" else "Films") + " from $year"
                                    genreName != null -> "$genreName $noun"
                                    mode == "series" -> "Popular series this week"
                                    else -> "Popular this week"
                                } + if (searching) " · searching…" else "",
                                style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold,
                            )
                            when {
                                actors && text.isEmpty() -> Text("Search for an actor or director to see all of their films.", color = Brand.Secondary)
                                actors && people.isEmpty() && !searching && searchedFor != null -> Text("Nobody found — check the spelling.", color = Brand.Secondary)
                                !actors && films.isEmpty() && !searching && searchedFor != null -> Text("No $noun found — try another spelling, or change the year or genre.", color = Brand.Secondary)
                            }
                        }
                    }
                    if (actors) {
                        items(people, key = { "p${it.id}" }, span = { GridItemSpan(maxLineSpan) }) { person ->
                            PersonRow(person) { navigator.push(Screen.Person(person.id, person.name)) }
                        }
                    } else {
                        items(films, key = { "${it.mediaType ?: "f"}${it.tmdbId}" }) { film ->
                            val open = { navigator.push(if (film.isShow) Screen.SeriesRequest(film.tmdbId, film.title) else Screen.Film(film.tmdbId, film.title)) }
                            FilmCard(film, onOpen = open) {
                                val state = film.request
                                when {
                                    state == null && film.isShow && film.showId != null -> open() // on Streamulus: choose seasons
                                    state == null -> asking = Ask(film, if (film.isShow) "series" else null)
                                    state.mine -> { showMine = true; scope.launch { loadMine() } }
                                    else -> send(film, "", state.scope, state.season)
                                }
                            }
                        }
                    }
                } else {
                    val list = mine
                    if (list != null && list.isEmpty()) {
                        item(key = "none", span = { GridItemSpan(maxLineSpan) }) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth().padding(vertical = 32.dp)) {
                                Text("You haven't asked for anything yet.", color = Brand.Secondary)
                                Spacer(Modifier.height(12.dp))
                                Button(onClick = { showMine = false }) { Text(findLabel(config)) }
                            }
                        }
                    }
                    items(list.orEmpty(), key = { "r${it.id}" }, span = { GridItemSpan(maxLineSpan) }) { request ->
                        RequestCard(request, onOpen = { navigator.push(if (request.isShow) Screen.SeriesRequest(request.tmdbId, request.title) else Screen.Film(request.tmdbId, request.title)) }, onWatch = { watch(request) }, onCancel = { cancelling = request })
                    }
                }
            }
            if (config == null || (showMine && mine == null)) ListStatus(loading = true, error = null, isEmpty = true, emptyText = "")
        }
    }

    asking?.let { ask ->
        AskDialog(ask, onCancel = { asking = null }, onSend = { note -> send(ask.film, note, ask.scope, ask.season) })
    }
    cancelling?.let { request ->
        AlertDialog(
            onDismissRequest = { cancelling = null },
            title = { Text("Cancel your request for ${request.name}?") },
            confirmButton = {
                TextButton(onClick = {
                    cancelling = null
                    scope.launch {
                        attempt({ say(it, error = true) }) {
                            session.delete("/api/requests/${request.id}")
                            say("Cancelled your request for ${request.name}")
                            loadMine()
                        }
                    }
                }) { Text("Cancel Request", color = Color(0xFFFF6B6B)) }
            },
            dismissButton = { TextButton(onClick = { cancelling = null }) { Text("Keep It") } },
        )
    }
}

// ── Pieces ───────────────────────────────────────────────────────────────────

private fun findLabel(config: RequestsConfig?) = when {
    config?.films != false && config?.tv == true -> "Request"
    config?.tv == true -> "Request a Series"
    else -> "Request a Film"
}

private fun statusColor(status: String): Color = when (status) {
    "pending" -> Brand.Streamling
    "declined", "failed" -> Color(0xFFFF6B6B)
    "not_found", "missing" -> Color(0xFFFF8C42)
    "importing", "adding" -> Color(0xFFB48CFF)
    "available" -> Brand.Success
    "waiting_release" -> Color(0xFF9AA7FF)
    else -> Brand.Accent
}

private val STEPS = listOf("Requested", "Approved", "Downloading", "Moving in", "Ready")
private fun stepOf(status: String) = when (status) {
    "searching", "waiting_release", "not_found", "missing" -> 1
    "downloading", "failed" -> 2
    "importing", "adding" -> 3
    "available" -> 4
    else -> 0
}

@Composable
internal fun StatusPill(status: String, label: String) {
    val color = statusColor(status)
    Text(
        label.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = color,
        maxLines = 1,
        modifier = Modifier.clip(CircleShape).background(color.copy(alpha = 0.14f))
            .border(1.dp, color.copy(alpha = 0.4f), CircleShape).padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
private fun Steps(status: String) {
    val at = stepOf(status)
    val problem = status in setOf("declined", "not_found", "failed", "missing")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        STEPS.forEachIndexed { index, name ->
            val done = index < at || (index == at && status == "available")
            val here = index == at && status != "available"
            val color = if (here && problem) statusColor(status) else Brand.Accent
            Box(
                Modifier.size(8.dp).clip(CircleShape)
                    .background(if (done || here) color else Color.Transparent)
                    .border(1.5.dp, if (done || here) color else Color.White.copy(alpha = 0.25f), CircleShape),
            )
            if (index == at) Text(name, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold)
            if (index < STEPS.lastIndex) {
                Box(Modifier.width(10.dp).height(2.dp).background(if (index < at) Brand.Accent.copy(alpha = 0.6f) else Color.White.copy(alpha = 0.12f)))
            }
        }
    }
}

/**
 * Downloading: the real percentage (easing between updates). Searching: a short
 * bar sliding from fully off the left edge to fully off the right, so it can't be
 * seen jumping back. Moving in: a full, gently pulsing bar.
 */
@Composable
private fun RequestProgressBar(status: String, progress: Double) {
    val transition = rememberInfiniteTransition(label = "request")
    BoxWithConstraints(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.1f))) {
        when (status) {
            "searching" -> {
                val t by transition.animateFloat(0f, 1f, infiniteRepeatable(tween(1600, easing = FastOutSlowInEasing), RepeatMode.Restart), label = "slide")
                val barWidth = maxWidth * 0.3f
                Box(
                    Modifier.width(barWidth).fillMaxHeight()
                        .offset(x = -barWidth + (maxWidth + barWidth) * t)
                        .background(Brush.horizontalGradient(listOf(Color.Transparent, Brand.Accent, Color.Transparent))),
                )
            }
            "importing", "adding" -> {
                val a by transition.animateFloat(1f, 0.55f, infiniteRepeatable(tween(800, easing = LinearEasing), RepeatMode.Reverse), label = "pulse")
                Box(Modifier.fillMaxSize().alpha(a).background(Brand.LogoGradient))
            }
            else -> {
                val shown by animateFloatAsState(progress.toFloat().coerceIn(0f, 1f), tween(800), label = "progress")
                Box(Modifier.fillMaxWidth(shown).fillMaxHeight().clip(CircleShape).background(Brand.LogoGradient))
            }
        }
    }
}

/** A film: tap the poster for its page; the button underneath requests it. */
@Composable
internal fun FilmCard(film: FilmResult, onOpen: () -> Unit, onClick: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Column(Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onOpen), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Box(Modifier.fillMaxWidth().aspectRatio(2f / 3f).clip(RoundedCornerShape(12.dp))) {
                RemoteImage(film.posterUrl, Modifier.fillMaxSize(), placeholder = film.title)
                film.rating?.takeIf { it > 0 }?.let {
                    Text(
                        "★ %.1f".format(it), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold,
                        modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.65f)).padding(horizontal = 7.dp, vertical = 2.dp),
                    )
                }
            }
            film.request?.let { Box(Modifier.padding(top = 2.dp)) { StatusPill(it.status, it.label) } }
                ?: film.showId?.takeIf { film.isShow }?.let { Box(Modifier.padding(top = 2.dp)) { StatusPill("available", "On Streamulus") } }
            Text(film.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                listOfNotNull(film.year?.toString(), film.role).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, maxLines = 1, overflow = TextOverflow.Ellipsis,
            )
        }
        val state = film.request
        if (state == null && film.isShow && film.showId != null) {
            OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text("Seasons") }
        } else if (state == null) {
            Button(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(if (film.isShow) "Request Series" else "Request") }
        } else {
            OutlinedButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) { Text(if (state.mine) "See Progress" else "Me Too") }
        }
    }
}

@Composable
private fun RequestCard(request: MovieRequest, onOpen: () -> Unit, onWatch: () -> Unit, onCancel: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Brand.Card)
            .border(1.dp, if (request.status == "available") Brand.Success.copy(alpha = 0.3f) else Color.White.copy(alpha = 0.06f), RoundedCornerShape(16.dp))
            .clickable(onClick = onOpen)
            .padding(14.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RemoteImage(request.posterUrl, Modifier.width(66.dp).height(99.dp).clip(RoundedCornerShape(8.dp)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(request.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                request.year?.let { Text(it.toString(), color = Brand.Secondary, style = MaterialTheme.typography.bodyMedium) }
            }
            if (request.isShow) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon(painterResource(R.drawable.ic_requests_series), contentDescription = null, tint = Color.White.copy(alpha = 0.7f), modifier = Modifier.size(12.dp))
                    Text(if (request.scope == "season") "Season ${request.season}" else "Entire series", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = Color.White.copy(alpha = 0.75f))
                }
            }
            StatusPill(request.status, request.label)
            Steps(request.status)
            val tv = request.tv
            if (tv != null && tv.seasons.isNotEmpty()) {
                TVChecklist(tv, request.scope)
            } else if (request.status in setOf("downloading", "searching", "importing", "adding")) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Box(Modifier.weight(1f)) { RequestProgressBar(request.status, request.progress ?: 0.0) }
                    if (request.status == "downloading") {
                        Text("${((request.progress ?: 0.0) * 100).roundToInt()}%", color = Brand.Accent, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    }
                }
            }
            request.detail?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = if (request.status in setOf("not_found", "failed", "missing")) Color(0xFFFFB38A) else Brand.Secondary)
            }
            if (request.status == "pending") {
                Text("Waiting for an admin to approve it — you'll get an email either way.", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
            }
            if (request.status == "declined") DeclineNote(request.decidedBy, request.declineReason)
            Text(
                if (!request.mine) "Asked for by ${request.requestedBy ?: "someone"}"
                else "You asked" + if (request.others > 0) " · and ${request.others} other${if (request.others == 1) "" else "s"}" else "",
                style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.4f),
            )
            val showReady = request.isShow && request.showId != null && (request.status == "available" || (request.tv?.ready ?: 0) > 0)
            if ((request.status == "available" && request.movieId != null) || showReady) {
                Button(onClick = onWatch) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (request.isShow && request.status != "available") "Watch What's Ready" else "Watch Now")
                }
            }
            if (request.status == "pending") {
                OutlinedButton(onClick = onCancel) { Text("Cancel Request", color = Color(0xFFFF8080)) }
            }
        }
    }
}

@Composable
internal fun AskDialog(ask: Ask, onCancel: () -> Unit, onSend: (String) -> Unit) {
    val film = ask.film
    var note by rememberSaveable { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(listOfNotNull(film.title, film.year?.toString()).joinToString(" · ")) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (film.isShow) {
                    Row(
                        Modifier.clip(CircleShape).background(Brand.Accent.copy(alpha = 0.15f)).border(1.dp, Brand.Accent.copy(alpha = 0.4f), CircleShape).padding(horizontal = 10.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Icon(painterResource(R.drawable.ic_requests_series), contentDescription = null, tint = Brand.Accent, modifier = Modifier.size(12.dp))
                        Text(
                            if (ask.scope == "season") "Season ${ask.season}" else if (film.showId != null) "Every missing season" else "The whole series",
                            style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Brand.Accent,
                        )
                    }
                }
                film.overview?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, maxLines = 4, overflow = TextOverflow.Ellipsis)
                }
                OutlinedTextField(
                    value = note,
                    onValueChange = { if (it.length <= 500) note = it },
                    label = { Text("A note for the admin · optional") },
                    placeholder = { Text(if (film.isShow) "e.g. the original, not the remake" else "e.g. the 2021 version, please") },
                    minLines = 2,
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("You'll get an email when an admin approves or declines it, and again when it's ready to watch.", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
            }
        },
        confirmButton = {
            Button(enabled = !sending, onClick = { sending = true; onSend(note.trim()) }) { Text(if (sending) "Sending…" else "Send Request") }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
    )
}

/** Films / Series / Actors, and the Year and Genre menus. */
@Composable
private fun FilterRow(
    mode: String, onMode: (String) -> Unit,
    films: Boolean, series: Boolean,
    year: Int?, onYear: (Int?) -> Unit,
    genre: Int?, onGenre: (Int?) -> Unit,
    genres: List<GenreOption>,
) {
    var yearOpen by remember { mutableStateOf(false) }
    var genreOpen by remember { mutableStateOf(false) }
    val thisYear = remember { java.util.Calendar.getInstance().get(java.util.Calendar.YEAR) }
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        if (films) Chip("Films", selected = mode == "films", icon = R.drawable.ic_requests_films) { onMode("films") }
        if (series) Chip("Series", selected = mode == "series", icon = R.drawable.ic_requests_series) { onMode("series") }
        if (films) Chip("Actors", selected = mode == "people", icon = R.drawable.ic_requests_actors) { onMode("people") }
        if (mode != "people") {
            Box {
                Chip(year?.toString() ?: "Year ▾", selected = year != null) { yearOpen = true }
                DropdownMenu(expanded = yearOpen, onDismissRequest = { yearOpen = false }) {
                    DropdownMenuItem(text = { Text("Any year") }, onClick = { onYear(null); yearOpen = false })
                    (thisYear + 1 downTo 1920).forEach { y ->
                        DropdownMenuItem(text = { Text(y.toString()) }, onClick = { onYear(y); yearOpen = false })
                    }
                }
            }
            Box {
                Chip(genres.firstOrNull { it.id == genre }?.name ?: "Genre ▾", selected = genre != null) { genreOpen = true }
                DropdownMenu(expanded = genreOpen, onDismissRequest = { genreOpen = false }) {
                    DropdownMenuItem(text = { Text("Any genre") }, onClick = { onGenre(null); genreOpen = false })
                    genres.forEach { g -> DropdownMenuItem(text = { Text(g.name) }, onClick = { onGenre(g.id); genreOpen = false }) }
                }
            }
            if (year != null || genre != null) {
                TextButton(onClick = { onYear(null); onGenre(null) }) { Text("Clear", color = Brand.Secondary) }
            }
        }
    }
}

@Composable
private fun Chip(text: String, selected: Boolean, icon: Int? = null, onClick: () -> Unit) {
    val color = if (selected) Color.Black else Color.White
    Row(
        Modifier.clip(CircleShape)
            .background(if (selected) Color.White else Color.White.copy(alpha = 0.1f))
            .border(1.dp, if (selected) Color.Transparent else Color.White.copy(alpha = 0.15f), CircleShape)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        if (icon != null) Icon(painterResource(icon), contentDescription = null, tint = color, modifier = Modifier.size(15.dp))
        Text(text, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold, color = color)
    }
}

@Composable
private fun PersonRow(person: PersonResult, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.06f)).clickable(onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        RemoteImage(person.profileUrl, Modifier.size(56.dp).clip(CircleShape), placeholder = person.name.take(1))
        Column(Modifier.weight(1f)) {
            Text(person.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text(
                listOfNotNull(if (person.department == "Acting") "Actor" else person.department, person.knownFor.takeIf { it.isNotEmpty() }?.joinToString(", ")).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Why a request was declined, in the admin's words. */
@Composable
private fun DeclineNote(by: String?, note: String?) {
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFFF4444).copy(alpha = 0.12f))
            .border(1.dp, Color(0xFFFF4444).copy(alpha = 0.35f), RoundedCornerShape(12.dp)).padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            if (note == null) "Not approved" + (by?.let { " by $it" } ?: "") else "Note from ${by ?: "the admin"}",
            style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Color(0xFFFF8A8A),
        )
        note?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Color.White) }
    }
}
