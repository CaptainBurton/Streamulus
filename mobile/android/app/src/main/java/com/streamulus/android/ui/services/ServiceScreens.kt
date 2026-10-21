package com.streamulus.android.ui.services

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.SubcomposeAsyncImage
import com.streamulus.android.data.MediaItem
import com.streamulus.android.data.Movie
import com.streamulus.android.data.Show
import com.streamulus.android.data.StreamingService
import com.streamulus.android.data.obj
import com.streamulus.android.data.objects
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.ListStatus
import com.streamulus.android.ui.components.RemoteImage
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.genres.GenreFilter
import com.streamulus.android.ui.library.LibraryGrid
import com.streamulus.android.ui.theme.Brand
import kotlin.math.min
import kotlin.math.sqrt

/** Behind a service's logo: the same dark glow as the website's tiles. */
private val TileBackground = Brush.radialGradient(
    colors = listOf(Color(0xFF1F2730), Color(0xFF141418)),
    center = Offset(0.5f, 0f),
    radius = 900f,
)

/**
 * Width and height for a logo inside a box, by area rather than by fitting, so a
 * tall logo (HBO Max) and a long one (Crunchyroll) look about the same size.
 */
fun serviceLogoSize(aspect: Double, boxWidth: Dp, boxHeight: Dp, fill: Double = 0.17, maxWidth: Double = 0.78, maxHeight: Double = 0.5): Pair<Dp, Dp> {
    val a = if (aspect > 0) aspect else 3.0
    val area = fill * boxWidth.value * boxHeight.value
    var width = sqrt(area * a)
    var height = width / a
    val shrink = min(1.0, min(maxWidth * boxWidth.value / width, maxHeight * boxHeight.value / height))
    width *= shrink
    height *= shrink
    return width.dp to height.dp
}

/** The service's logo in the Streamulus colours (the server colours the PNG). */
@Composable
fun ServiceLogo(service: StreamingService, width: Dp, height: Dp, modifier: Modifier = Modifier) {
    val session = LocalSession.current
    SubcomposeAsyncImage(
        model = session.imageUrl(service.logoPng),
        contentDescription = service.name,
        contentScale = ContentScale.Fit,
        modifier = modifier.size(width, height),
        error = {
            Box(contentAlignment = Alignment.Center) {
                Text(service.name, fontWeight = FontWeight.Black, fontSize = (height.value * 0.45f).coerceAtLeast(12f).sp, color = Brand.Accent, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
    )
}

/** 16:9 dark tile with a streaming service's logo (the Home row). */
@Composable
fun ServiceTile(service: StreamingService, width: Dp, onClick: () -> Unit) {
    val height = width * 9 / 16
    val (logoWidth, logoHeight) = serviceLogoSize(service.logoAspect, width, height)
    val shape = RoundedCornerShape(14.dp)
    Box(
        Modifier.size(width, height).clip(shape).background(TileBackground)
            .border(1.dp, Color.White.copy(alpha = 0.08f), shape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = "${service.name}, ${service.titleCount} title${if (service.titleCount == 1) "" else "s"}" },
        contentAlignment = Alignment.Center,
    ) {
        ServiceLogo(service, logoWidth, logoHeight)
    }
}

/** One streaming service: its banner and logo, then its movies and shows (All / Movies / TV Shows, A–Z). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServiceDetailScreen(service: StreamingService) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    var shown by remember { mutableStateOf(service) }
    var movies by remember { mutableStateOf<List<Movie>?>(null) }
    var shows by remember { mutableStateOf<List<Show>>(emptyList()) }
    var filter by rememberSaveable { mutableStateOf(GenreFilter.All) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(service.id, session.profile) {
        attempt({ error = it }) {
            val response = session.getObject("/api/services/${service.id}")
            response.obj("service")?.let { shown = StreamingService.from(it) }
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
        TopBar(service.name, onBack = { navigator.pop() })
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
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Banner(shown, if (movies == null) null else count(GenreFilter.All))
                        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
                            GenreFilter.entries.forEachIndexed { index, option ->
                                SegmentedButton(
                                    selected = filter == option,
                                    onClick = { filter = option },
                                    shape = SegmentedButtonDefaults.itemShape(index, GenreFilter.entries.size),
                                ) { Text("${option.label} (${count(option)})", maxLines = 1) }
                            }
                        }
                    }
                },
            )
            ListStatus(loading = movies == null, error = error, isEmpty = movies == null || (allMovies.isEmpty() && shows.isEmpty()), emptyText = "Nothing on ${service.name} yet")
        }
    }
}

/** The service's banner (the admin's, or a title's art) with its logo over it. */
@Composable
private fun Banner(service: StreamingService, titles: Int?) {
    val session = LocalSession.current
    val (logoWidth, logoHeight) = serviceLogoSize(service.logoAspect, 300.dp, 110.dp, fill = 0.3, maxWidth = 0.95, maxHeight = 0.75)
    Box(Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(16.dp)).background(TileBackground)) {
        session.imageUrl(service.bannerUrl)?.let { url ->
            RemoteImage(url, Modifier.fillMaxSize().background(Color.Transparent))
            Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)))
        }
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.35f to Color.Transparent, 1f to Brand.Background.copy(alpha = 0.9f))))
        Column(Modifier.align(Alignment.BottomStart).padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            ServiceLogo(service, logoWidth, logoHeight)
            if (titles != null) {
                Text("$titles title${if (titles == 1) "" else "s"} on ${service.name}", style = MaterialTheme.typography.bodyMedium, color = Brand.Secondary)
            }
        }
    }
}
