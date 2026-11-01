package com.streamulus.android.ui.requests

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.streamulus.android.data.FilmDetail
import com.streamulus.android.data.FilmResult
import com.streamulus.android.data.Movie
import com.streamulus.android.data.PersonPage
import com.streamulus.android.data.obj
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

/**
 * A film on the Requests screen: backdrop and poster, year, running time, age
 * rating, rating, genres, synopsis, director and cast (tap a person for all their
 * films), the trailer, and the Request button.
 */
@Composable
fun FilmDetailScreen(tmdbId: Int, title: String) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    val context = LocalContext.current
    val uriHandler = LocalUriHandler.current
    val scope = rememberCoroutineScope()
    var film by remember { mutableStateOf<FilmDetail?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var wholeSynopsis by remember { mutableStateOf(false) }

    LaunchedEffect(tmdbId, reload) {
        attempt({ error = it }) { film = session.getObject("/api/requests/film/$tmdbId").obj("film")?.let(FilmDetail::from) }
    }

    fun send(note: String) {
        scope.launch {
            attempt({ message = it to true }) {
                val response = session.post("/api/requests", buildJsonObject {
                    put("tmdbId", tmdbId)
                    put("note", note)
                })
                asking = false
                message = (if (response["joined"]?.toString() == "true") "Added you — you'll hear when it's ready too" else "Requested — you'll get an email when an admin decides") to false
                reload++
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(film?.film?.title ?: title, onBack = { navigator.pop() })
        Box(Modifier.weight(1f)) {
            val f = film
            if (f != null) {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                    // Backdrop, fading into the page, with the poster and title over its bottom.
                    Box(Modifier.fillMaxWidth().height(if (m.wide) 380.dp else 260.dp)) {
                        RemoteImage(f.backdropUrl ?: f.film.posterUrl, Modifier.fillMaxSize())
                        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.3f), Color.Transparent, Brand.Background.copy(alpha = 0.9f), Brand.Background))))
                        Row(
                            Modifier.align(Alignment.BottomStart).padding(horizontal = m.margin).offset(y = 30.dp),
                            horizontalArrangement = Arrangement.spacedBy(16.dp),
                            verticalAlignment = Alignment.Bottom,
                        ) {
                            RemoteImage(
                                f.film.posterUrl,
                                Modifier.width(if (m.wide) 140.dp else 104.dp).height(if (m.wide) 210.dp else 156.dp).clip(RoundedCornerShape(12.dp))
                                    .border(1.dp, Color.White.copy(alpha = 0.15f), RoundedCornerShape(12.dp)),
                                placeholder = f.film.title,
                            )
                            Column(Modifier.padding(bottom = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                Text(f.film.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold, maxLines = 3, overflow = TextOverflow.Ellipsis)
                                Text(
                                    listOfNotNull(
                                        f.film.year?.toString(),
                                        f.runtime?.takeIf { it > 0 }?.let { if (it >= 60) "${it / 60}h ${it % 60}m" else "${it}m" },
                                        f.certification,
                                    ).joinToString(" · "),
                                    style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = Color.White.copy(alpha = 0.8f),
                                )
                                f.film.rating?.takeIf { it > 0 }?.let {
                                    Text("★ %.1f".format(it) + if (f.voteCount > 0) "  ·  ${f.voteCount} ratings" else "", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.8f))
                                }
                            }
                        }
                    }
                    Column(Modifier.padding(start = m.margin, end = m.margin, top = 46.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                        message?.let { (text, isError) -> Banner(text, isError) }
                        // What you can do with it.
                        when {
                            f.movieId != null -> Button(onClick = {
                                scope.launch {
                                    attempt({ message = it to true }) {
                                        session.getObject("/api/movies/${f.movieId}").obj("movie")?.let(Movie::from)?.let { navigator.push(Screen.MovieDetail(it)) }
                                    }
                                }
                            }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("On Streamulus — Watch")
                            }
                            f.film.request != null -> {
                                val state = f.film.request
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                    StatusPill(state.status, state.label)
                                    Text(if (state.mine) "You've asked for this film" else "Someone has already asked for this film", color = Color.White.copy(alpha = 0.75f), style = MaterialTheme.typography.bodyMedium)
                                }
                                if (!state.mine) {
                                    Button(onClick = { send("") }, modifier = Modifier.fillMaxWidth()) { Text("Me Too — Tell Me When It's Ready") }
                                }
                            }
                            else -> Button(onClick = { asking = true }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Filled.Add, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Request This Film")
                            }
                        }
                        f.trailerUrl?.let { url ->
                            OutlinedButton(onClick = { if (!openInAppBrowser(context, url)) runCatching { uriHandler.openUri(url) } }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Filled.PlayArrow, contentDescription = null)
                                Spacer(Modifier.width(6.dp))
                                Text("Watch Trailer")
                            }
                        }
                        f.tagline?.let { Text("“$it”", style = MaterialTheme.typography.titleMedium, fontStyle = FontStyle.Italic, color = Color.White.copy(alpha = 0.85f)) }
                        if (f.genres.isNotEmpty()) {
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                f.genres.forEach { g ->
                                    Text(g, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold,
                                        modifier = Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 12.dp, vertical = 6.dp))
                                }
                            }
                        }
                        f.film.overview?.takeIf { it.isNotBlank() }?.let { overview ->
                            Section("Synopsis") {
                                Text(overview, style = MaterialTheme.typography.bodyLarge, color = Color.White.copy(alpha = 0.88f), maxLines = if (wholeSynopsis) Int.MAX_VALUE else 6, overflow = TextOverflow.Ellipsis)
                                if (overview.length > 320) TextButton(onClick = { wholeSynopsis = !wholeSynopsis }) { Text(if (wholeSynopsis) "Less" else "More") }
                            }
                        }
                        if (f.directors.isNotEmpty()) {
                            Section(if (f.directors.size == 1) "Director" else "Directors") {
                                f.directors.forEach { d ->
                                    Text(d.name, color = Brand.Accent, fontWeight = FontWeight.SemiBold, modifier = Modifier.clickable { navigator.push(Screen.Person(d.id, d.name)) }.padding(vertical = 2.dp))
                                }
                            }
                        }
                        if (f.cast.isNotEmpty()) {
                            Section("Cast") {
                                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                    f.cast.forEach { c ->
                                        Column(
                                            Modifier.width(86.dp).clip(RoundedCornerShape(10.dp)).clickable { navigator.push(Screen.Person(c.id, c.name)) },
                                            horizontalAlignment = Alignment.CenterHorizontally,
                                            verticalArrangement = Arrangement.spacedBy(4.dp),
                                        ) {
                                            RemoteImage(c.profileUrl, Modifier.size(76.dp).clip(CircleShape), placeholder = c.name.take(1))
                                            Text(c.name, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, maxLines = 2)
                                            c.character?.takeIf { it.isNotBlank() }?.let {
                                                Text(it, style = MaterialTheme.typography.labelSmall, color = Brand.Secondary, textAlign = TextAlign.Center, maxLines = 2)
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        f.originalTitle?.let { Text("Original title: $it", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary) }
                    }
                }
            }
            if (film == null) ListStatus(loading = error == null, error = error, isEmpty = true, emptyText = "")
        }
    }
    if (asking) film?.let { f -> AskDialog(f.film, onCancel = { asking = false }, onSend = { note -> send(note) }) }
}

/** An actor's (or director's) page: who they are, and their films not on the server yet. */
@Composable
fun PersonScreen(personId: Int, name: String) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    val scope = rememberCoroutineScope()
    var page by remember { mutableStateOf<PersonPage?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var asking by remember { mutableStateOf<FilmResult?>(null) }
    var message by remember { mutableStateOf<Pair<String, Boolean>?>(null) }
    var reload by remember { mutableIntStateOf(0) }
    var wholeBio by remember { mutableStateOf(false) }

    LaunchedEffect(personId, reload) {
        attempt({ error = it }) { page = PersonPage.from(session.getObject("/api/requests/person/$personId")) }
    }

    fun send(film: FilmResult, note: String) {
        scope.launch {
            attempt({ message = it to true }) {
                val response = session.post("/api/requests", buildJsonObject {
                    put("tmdbId", film.tmdbId)
                    put("note", note)
                })
                asking = null
                message = (if (response["joined"]?.toString() == "true") "Added you to the request for ${film.title}" else "Requested ${film.title} — you'll get an email when an admin decides") to false
                reload++
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(name, onBack = { navigator.pop() })
        Box(Modifier.weight(1f)) {
            val p = page
            if (p != null) {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(m.gridMinimum),
                    contentPadding = PaddingValues(start = m.margin, end = m.margin, bottom = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item(key = "about", span = { GridItemSpan(maxLineSpan) }) {
                        Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(18.dp)) {
                                RemoteImage(p.profileUrl, Modifier.size(108.dp).clip(CircleShape).border(1.dp, Color.White.copy(alpha = 0.15f), CircleShape), placeholder = p.name.take(1))
                                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(p.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
                                    p.department?.let {
                                        Text(when (it) { "Acting" -> "Actor"; "Directing" -> "Director"; else -> it }, color = Brand.Accent, fontWeight = FontWeight.SemiBold)
                                    }
                                    listOfNotNull(p.birthday?.let { "Born $it" }, p.placeOfBirth).takeIf { it.isNotEmpty() }?.let {
                                        Text(it.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
                                    }
                                }
                            }
                            p.biography?.takeIf { it.isNotBlank() }?.let { bio ->
                                Column {
                                    Text(bio, style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.85f), maxLines = if (wholeBio) Int.MAX_VALUE else 4, overflow = TextOverflow.Ellipsis)
                                    if (bio.length > 220) TextButton(onClick = { wholeBio = !wholeBio }) { Text(if (wholeBio) "Less" else "More") }
                                }
                            }
                            message?.let { (text, isError) -> Banner(text, isError) }
                            Text("Films to request", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                            if (p.onServer > 0) {
                                Text("✓ ${p.onServer} of their films ${if (p.onServer == 1) "is" else "are"} already on Streamulus", style = MaterialTheme.typography.bodySmall, color = Brand.Success)
                            }
                            if (p.films.isEmpty()) Text("Everything of theirs is already on Streamulus.", color = Brand.Secondary)
                        }
                    }
                    items(p.films, key = { "f${it.tmdbId}" }) { film ->
                        FilmCard(film, onOpen = { navigator.push(Screen.Film(film.tmdbId, film.title)) }) {
                            val state = film.request
                            when {
                                state == null -> asking = film
                                !state.mine -> send(film, "")
                                else -> navigator.push(Screen.Requests(mine = true))
                            }
                        }
                    }
                }
            }
            if (page == null) ListStatus(loading = error == null, error = error, isEmpty = true, emptyText = "")
        }
    }
    asking?.let { film -> AskDialog(film, onCancel = { asking = null }, onSend = { note -> send(film, note) }) }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        content()
    }
}

@Composable
private fun Banner(text: String, isError: Boolean) {
    val color = if (isError) Color(0xFFFF4444) else Brand.Success
    Text(
        text, color = Color.White, style = MaterialTheme.typography.bodyMedium,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(color.copy(alpha = 0.2f))
            .border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(12.dp)).padding(12.dp),
    )
}
