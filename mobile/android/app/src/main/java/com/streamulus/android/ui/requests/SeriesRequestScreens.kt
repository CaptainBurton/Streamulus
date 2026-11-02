package com.streamulus.android.ui.requests

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.streamulus.android.R
import com.streamulus.android.data.FilmResult
import com.streamulus.android.data.SeasonRequestEpisode
import com.streamulus.android.data.Show
import com.streamulus.android.data.ShowRequestDetail
import com.streamulus.android.data.ShowRequestSeason
import com.streamulus.android.data.TVEpisodeProgress
import com.streamulus.android.data.TVProgress
import com.streamulus.android.data.TVSeasonProgress
import com.streamulus.android.data.obj
import com.streamulus.android.data.objects
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.ListStatus
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.RemoteImage
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.components.openInAppBrowser
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.roundToInt

/** What the request dialog is asking for: a film, a whole series, or one season. */
data class Ask(val film: FilmResult, val scope: String? = null, val season: Int? = null)

/** "4 Jul 2019" from "2019-07-04". */
internal fun shortDate(value: String?): String {
    val v = value?.take(10) ?: return ""
    return runCatching {
        val d = java.time.LocalDate.parse(v)
        d.format(java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy"))
    }.getOrDefault(v)
}

/**
 * A series that isn't (all) on the server: backdrop and poster, years, seasons,
 * rating, genres, synopsis, cast, trailer — and its seasons: how much of each
 * is on Streamulus, with Request Entire Series, or (once the show is here)
 * Request Season. Tap a season to see its episodes. Like the website and iPhone.
 */
@Composable
fun SeriesRequestScreen(tmdbId: Int, title: String) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var show by remember { mutableStateOf<ShowRequestDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf<Ask?>(null) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var opened by remember { mutableStateOf<Int?>(null) }
    val episodes = remember { mutableStateMapOf<Int, List<SeasonRequestEpisode>>() }

    LaunchedEffect(tmdbId, reload) {
        attempt({ error = it }) { show = session.getObject("/api/requests/show/$tmdbId").obj("show")?.let(ShowRequestDetail::from) }
    }

    fun send(scopeName: String, season: Int?, note: String) {
        scope.launch {
            attempt({ message = it to true }) {
                val response = session.post("/api/requests", buildJsonObject {
                    put("mediaType", "tv")
                    put("tmdbId", tmdbId)
                    put("scope", scopeName)
                    season?.let { put("season", it) }
                    put("note", note)
                })
                asking = null
                message = (if (response["joined"]?.toString() == "true") "Added you — you'll hear when it's ready too" else "Requested — you'll get an email when an admin decides") to false
                reload++
            }
        }
    }

    fun openSeason(n: Int) {
        opened = if (opened == n) null else n
        if (episodes[n] == null) scope.launch {
            attempt({}) { episodes[n] = session.getObject("/api/requests/show/$tmdbId/season/$n").objects("episodes").map(SeasonRequestEpisode::from) }
        }
    }

    fun watch(showId: Int) {
        scope.launch {
            attempt({ message = it to true }) {
                session.getObject("/api/tv/$showId/details").obj("show")?.let(Show::from)?.let { navigator.push(Screen.ShowDetail(it)) }
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(show?.show?.title ?: title, onBack = { navigator.pop() })
        Box(Modifier.weight(1f)) {
            val s = show
            if (s != null) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    Box(Modifier.fillMaxWidth().height(if (m.wide) 380.dp else 260.dp)) {
                        RemoteImage(s.backdropUrl ?: s.show.posterUrl, Modifier.fillMaxSize())
                        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.3f), Color.Transparent, Brand.Background.copy(alpha = 0.9f), Brand.Background))))
                        Row(
                            Modifier.align(Alignment.BottomStart).padding(horizontal = m.margin).offset(y = 30.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            RemoteImage(
                                s.show.posterUrl,
                                Modifier.width(if (m.wide) 140.dp else 104.dp).height(if (m.wide) 210.dp else 156.dp).clip(RoundedCornerShape(12.dp))
                                    .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(12.dp)),
                                placeholder = s.show.title,
                            )
                            Column(Modifier.padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                    Icon(painterResource(R.drawable.ic_requests_series), contentDescription = null, tint = Brand.Accent, modifier = Modifier.size(12.dp))
                                    Text("SERIES", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.ExtraBold, color = Brand.Accent)
                                }
                                Text(s.show.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                Text(facts(s), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.8f))
                                s.show.rating?.takeIf { it > 0 }?.let {
                                    Text("★ %.1f".format(it) + if (s.networks.isNotEmpty()) "  ·  ${s.networks.joinToString(", ")}" else "", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.8f))
                                }
                            }
                        }
                    }
                    Column(Modifier.padding(start = m.margin, end = m.margin, top = 46.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                        message?.let { (text, isError) -> Banner(text, isError) }
                        s.onServerShowId?.let { id ->
                            OutlinedButton(onClick = { watch(id) }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("On Streamulus — Watch")
                            }
                        }
                        val state = s.show.request
                        when {
                            state != null -> {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    StatusPill(state.status, state.label)
                                    Text(if (state.mine) "You've asked for the whole series" else "Someone has asked for the whole series", color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.bodyMedium)
                                }
                                if (!state.mine) Button(onClick = { send("series", null, "") }, modifier = Modifier.fillMaxWidth()) { Text("Me Too — Tell Me When It's Ready") }
                            }
                            s.canRequestSeries -> Button(onClick = { asking = Ask(s.show, "series") }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Filled.Add, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text(if (s.onServerShowId == null) "Request Entire Series" else "Request All Missing Seasons")
                            }
                        }
                        s.trailerUrl?.let { url ->
                            OutlinedButton(onClick = { if (!openInAppBrowser(context, url)) runCatching { uriHandler.openUri(url) } }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Watch Trailer")
                            }
                        }
                        s.tagline?.let { Text("“$it”", style = MaterialTheme.typography.titleMedium, fontStyle = FontStyle.Italic, color = Color.White.copy(alpha = 0.85f)) }
                        if (s.genres.isNotEmpty()) {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                s.genres.forEach { g ->
                                    Text(g, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 12.dp, vertical = 6.dp))
                                }
                            }
                        }
                        s.show.overview?.takeIf { it.isNotBlank() }?.let { overview ->
                            Section("Synopsis") { Text(overview, style = MaterialTheme.typography.bodyLarge, color = Color.White.copy(alpha = 0.88f)) }
                        }
                        Section("Seasons") {
                            if (s.onServerShowId == null) {
                                Text("Single seasons can be asked for once the show is on Streamulus — request the whole series to get started.",
                                    style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
                            }
                            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = 0.05f))) {
                                s.seasons.forEachIndexed { i, season ->
                                    if (i > 0) HorizontalDivider(color = Color.White.copy(alpha = 0.08f))
                                    SeasonRow(
                                        season, onServer = s.onServerShowId != null, open = opened == season.season, episodes = episodes[season.season],
                                        onToggle = { openSeason(season.season) },
                                        onRequest = { asking = Ask(s.show, "season", season.season) },
                                        onJoin = { st -> send(st.scope ?: "season", st.season, "") },
                                    )
                                }
                            }
                        }
                        if (s.creators.isNotEmpty()) Text("Created by ${s.creators.joinToString(", ")}", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.7f))
                        if (s.cast.isNotEmpty()) {
                            Section("Cast") {
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                    s.cast.forEach { c ->
                                        Column(Modifier.width(84.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            RemoteImage(c.profileUrl, Modifier.size(72.dp).clip(CircleShape), placeholder = c.name.take(1))
                                            Text(c.name, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                            c.character?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = Brand.Secondary, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            } else {
                ListStatus(loading = error == null, error = error, isEmpty = true, emptyText = "")
            }
        }
    }

    asking?.let { ask ->
        AskDialog(ask, onCancel = { asking = null }, onSend = { note -> send(ask.scope ?: "series", ask.season, note) })
    }
}

private fun facts(s: ShowRequestDetail): String {
    val first = s.firstAirDate?.take(4)
    val last = s.lastAirDate?.take(4)
    return listOfNotNull(
        first?.let { if (s.status == "Returning Series") "$it–" else if (last != null && last != it) "$it–$last" else it },
        s.numberOfSeasons.takeIf { it > 0 }?.let { "$it season${if (it == 1) "" else "s"}" },
        s.certification,
        when (s.status) { "Returning Series" -> "Still running"; "Ended" -> "Ended"; else -> null },
    ).joinToString(" · ")
}

@Composable
private fun SeasonRow(
    season: ShowRequestSeason, onServer: Boolean, open: Boolean, episodes: List<SeasonRequestEpisode>?,
    onToggle: () -> Unit, onRequest: () -> Unit, onJoin: (com.streamulus.android.data.FilmRequestState) -> Unit,
) {
    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).clickable(onClick = onToggle), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RemoteImage(season.posterUrl, Modifier.width(42.dp).height(63.dp).clip(RoundedCornerShape(6.dp)), placeholder = season.season.toString())
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                Text(season.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Text(
                    listOfNotNull(season.year?.toString(), "${season.episodeCount} episode${if (season.episodeCount == 1) "" else "s"}",
                        if (season.aired < season.episodeCount) (if (season.aired > 0) "${season.aired} aired so far" else "not aired yet") else null).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall, color = Brand.Secondary,
                )
                if (onServer && season.aired > 0) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        LinearProgressIndicator(
                            progress = { season.onServer.toFloat() / season.aired.coerceAtLeast(1) },
                            color = if (season.complete) Brand.Success else Brand.Accent, modifier = Modifier.width(110.dp),
                        )
                        Text("${season.onServer} of ${season.aired} on Streamulus", style = MaterialTheme.typography.labelSmall, color = Brand.Secondary)
                    }
                }
            }
            Icon(if (open) Icons.Filled.KeyboardArrowDown else Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.White.copy(alpha = 0.5f))
        }
        val state = season.request
        when {
            season.complete -> StatusPill("available", "On Streamulus")
            state != null -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatusPill(state.status, if (state.scope == "series") "Whole series asked for" else state.label)
                if (!state.mine) OutlinedButton(onClick = { onJoin(state) }) { Text("Me Too") }
            }
            season.canRequest -> Button(onClick = onRequest) {
                Icon(Icons.Filled.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Request Season")
            }
        }
        if (open) {
            if (episodes == null) Text("Loading episodes…", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
            else episodes.forEach { e ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("E%02d".format(e.episode), style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.45f), modifier = Modifier.width(32.dp))
                    Text(e.title ?: "Episode ${e.episode}", style = MaterialTheme.typography.bodyMedium, color = if (e.aired) Color.White else Color.White.copy(alpha = 0.45f), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(
                        if (e.onServer) "On Streamulus" else if (e.aired) shortDate(e.airDate) else "Airs ${shortDate(e.airDate)}",
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold,
                        color = if (e.onServer) Brand.Success else Color.White.copy(alpha = 0.5f),
                    )
                }
            }
        }
    }
}

// ── A series request's checklist ─────────────────────────────────────────────

private fun episodeColor(state: String): Color = when (state) {
    "ready" -> Brand.Success
    "downloading" -> Brand.Accent
    "importing", "adding" -> Color(0xFFB48CFF)
    "searching" -> Color(0xFFFFD166)
    "failed" -> Color(0xFFFF6B6B)
    "unaired" -> Color.White.copy(alpha = 0.4f)
    "waiting" -> Color(0xFF8FA8FF)
    else -> Color(0xFFFF8C42)
}

/**
 * How a series request is getting on: episodes ready, then each season (ready
 * of total, a bar, what's going on) — open one to see its episodes ticked off,
 * downloading (with a filling ring and %), moving in, not found, or not aired
 * yet. Seasons with downloads open by themselves until you open or close one.
 */
@Composable
internal fun TVChecklist(tv: TVProgress, scope: String?) {
    val chosen = remember { mutableStateMapOf<Int, Boolean>() }
    fun isOpen(s: TVSeasonProgress) = chosen[s.season] ?: (scope == "season" || tv.seasons.size == 1 || s.active > 0)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            val all by animateFloatAsState(tv.progress.toFloat().coerceIn(0f, 1f), tween(800), label = "all")
            LinearProgressIndicator(progress = { all }, color = if (tv.total > 0 && tv.ready == tv.total) Brand.Success else Brand.Accent, modifier = Modifier.weight(1f))
            Text("${tv.ready} of ${tv.total} episode${if (tv.total == 1) "" else "s"} ready", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.White.copy(alpha = 0.04f))
            .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(14.dp))) {
            tv.seasons.forEachIndexed { i, s ->
                if (i > 0) HorizontalDivider(color = Color.White.copy(alpha = 0.08f))
                val open = isOpen(s)
                Row(
                    Modifier.fillMaxWidth().clickable { chosen[s.season] = !open }.padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(Icons.Filled.KeyboardArrowRight, contentDescription = null, tint = Color.White.copy(alpha = 0.5f), modifier = Modifier.size(18.dp).rotate(if (open) 90f else 0f))
                    Text("Season ${s.season}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    Text("${s.ready}/${s.total}", style = MaterialTheme.typography.labelSmall, color = Brand.Secondary)
                    LinearProgressIndicator(progress = { s.progress.toFloat().coerceIn(0f, 1f) }, color = if (s.total > 0 && s.ready == s.total) Brand.Success else Brand.Accent, modifier = Modifier.weight(1f))
                    val (text, color) = when {
                        s.total > 0 && s.ready == s.total -> (if (s.unaired > 0) "Aired ready" else "All ready") to Brand.Success
                        s.active > 0 -> "${s.active} downloading" to Brand.Accent
                        s.missing > 0 -> "${s.missing} not found" to Color(0xFFFF8C42)
                        s.waiting > 0 -> "Waiting for the finale" to episodeColor("waiting")
                        s.total == 0 && s.unaired > 0 -> "Not aired yet" to Color.White.copy(alpha = 0.5f)
                        else -> "${s.ready} of ${s.total}" to Brand.Secondary
                    }
                    Text(text, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = color)
                }
                if (open) {
                    Column(Modifier.padding(start = 40.dp, end = 12.dp, bottom = 8.dp)) {
                        s.episodes.forEach { e -> EpisodeRow(e) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EpisodeRow(e: TVEpisodeProgress) {
    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        EpisodeMark(e.state, e.progress)
        Text("E%02d".format(e.episode), style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.45f), modifier = Modifier.width(30.dp))
        Text(e.title ?: "Episode ${e.episode}", style = MaterialTheme.typography.bodyMedium, color = if (e.state == "unaired") Color.White.copy(alpha = 0.45f) else Color.White,
            maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Text(
            when (e.state) {
                "ready" -> "Ready"
                "downloading" -> "${(e.progress * 100).roundToInt()}%"
                "importing", "adding" -> "Moving in"
                "searching" -> "Searching"
                "failed" -> "Problem"
                "unaired" -> e.airDate?.let { "Airs ${shortDate(it)}" } ?: "Not aired yet"
                "waiting" -> "After the finale"
                else -> "Not found yet"
            },
            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = episodeColor(e.state),
        )
    }
}

/** A tick when ready, a ring filling as it downloads, an outline otherwise. */
@Composable
private fun EpisodeMark(state: String, progress: Double) {
    val shown by animateFloatAsState(progress.toFloat().coerceIn(0f, 1f), tween(600), label = "ring")
    val color = episodeColor(state)
    Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
        when (state) {
            "ready" -> {
                Box(Modifier.size(18.dp).clip(CircleShape).background(color))
                Icon(Icons.Filled.Check, contentDescription = null, tint = Color.Black, modifier = Modifier.size(12.dp))
            }
            "downloading" -> Canvas(Modifier.size(18.dp)) {
                val stroke = 2.5.dp.toPx()
                val inset = stroke / 2
                val arcSize = Size(size.width - stroke, size.height - stroke)
                drawArc(Color.White.copy(alpha = 0.12f), 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(stroke))
                drawArc(color, -90f, 360f * shown, false, Offset(inset, inset), arcSize, style = Stroke(stroke, cap = StrokeCap.Round))
            }
            else -> Box(Modifier.size(18.dp).border(2.dp, color, CircleShape))
        }
    }
}
