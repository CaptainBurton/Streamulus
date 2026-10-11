package com.streamulus.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.streamulus.android.R
import com.streamulus.android.data.CastMember
import com.streamulus.android.data.Profile
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.theme.Brand

/** Sizes for phones (compact width) and tablets / wide windows. */
data class Metrics(val wide: Boolean) {
    val margin: Dp get() = if (wide) 28.dp else 16.dp
    val heroHeight: Dp get() = if (wide) 600.dp else 500.dp
    val detailHeaderHeight: Dp get() = if (wide) 440.dp else 290.dp
    val posterWidth: Dp get() = if (wide) 150.dp else 112.dp
    val wideCardWidth: Dp get() = if (wide) 340.dp else 264.dp
    val gridMinimum: Dp get() = if (wide) 140.dp else 104.dp
    val genreTileMinimum: Dp get() = if (wide) 230.dp else 160.dp
    val castSize: Dp get() = if (wide) 92.dp else 70.dp
    val stillWidth: Dp get() = if (wide) 210.dp else 140.dp
    /** Button rows don't stretch across a whole tablet. */
    val buttonRowMaxWidth: Dp get() = if (wide) 520.dp else Dp.Infinity
}

val LocalMetrics = compositionLocalOf { Metrics(wide = false) }

/** Remote image that fills its box, with a dark placeholder (and optional text) until it loads. */
@Composable
fun RemoteImage(
    url: String?,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    contentScale: ContentScale = ContentScale.Crop,
) {
    var loaded by remember(url) { mutableStateOf(false) }
    Box(modifier.background(Brand.Placeholder), contentAlignment = Alignment.Center) {
        if (!loaded && placeholder != null) PlaceholderText(placeholder)
        if (url != null) {
            AsyncImage(
                model = url,
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = contentScale,
                onSuccess = { loaded = true },
            )
        }
    }
}

/** Tries each URL in turn until one loads (e.g. a still frame, then artwork). */
@Composable
fun FallbackImage(urls: List<String>, modifier: Modifier = Modifier, placeholder: String? = null) {
    var index by remember(urls) { mutableIntStateOf(0) }
    var loaded by remember(urls) { mutableStateOf(false) }
    Box(modifier.background(Brand.Placeholder), contentAlignment = Alignment.Center) {
        if (!loaded && placeholder != null) PlaceholderText(placeholder)
        if (index < urls.size) {
            AsyncImage(
                model = urls[index],
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Crop,
                onSuccess = { loaded = true },
                onError = { index++ },
            )
        }
    }
}

@Composable
private fun PlaceholderText(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = Brand.Secondary,
        textAlign = TextAlign.Center,
        maxLines = 3,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(8.dp),
    )
}

/** Thin progress bar for partly watched items. */
@Composable
fun ProgressStrip(fraction: Double, modifier: Modifier = Modifier) {
    val f = fraction.coerceIn(0.0, 1.0).toFloat()
    Box(modifier.fillMaxWidth().height(4.dp).background(Color.White.copy(alpha = 0.25f))) {
        Box(Modifier.fillMaxWidth(f).height(4.dp).background(Brand.Accent))
    }
}

/** 2:3 poster with the title underneath. `width` null fills the grid column. */
@Composable
fun PosterCard(
    title: String,
    subtitle: String?,
    imageUrl: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    progress: Double? = null,
    width: Dp? = null,
) {
    Column(
        modifier.then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth())
            .clip(RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
        verticalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(2f / 3f)
                .clip(RoundedCornerShape(10.dp))
                .border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(10.dp)),
        ) {
            RemoteImage(imageUrl, Modifier.fillMaxSize(), placeholder = title)
            if (progress != null && progress > 0) ProgressStrip(progress, Modifier.align(Alignment.BottomCenter))
        }
        Text(title, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (subtitle != null) {
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = Brand.Secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(2.dp))
    }
}

/** 16:9 card with the title over a gradient — Continue Watching. */
@Composable
fun WideCard(
    title: String,
    subtitle: String?,
    imageUrls: List<String>,
    progress: Double?,
    width: Dp,
    onClick: () -> Unit,
) {
    Box(
        Modifier.width(width).aspectRatio(16f / 9f)
            .clip(RoundedCornerShape(12.dp))
            .clickable(onClick = onClick),
    ) {
        FallbackImage(imageUrls, Modifier.fillMaxSize(), placeholder = title)
        Box(Modifier.fillMaxSize().background(Brush.verticalGradient(0.45f to Color.Transparent, 1f to Color.Black.copy(alpha = 0.88f))))
        Box(
            Modifier.align(Alignment.Center).padding(bottom = 18.dp).size(46.dp)
                .clip(CircleShape).background(Color.Black.copy(alpha = 0.45f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.PlayArrow, contentDescription = "Play", tint = Color.White)
        }
        Column(Modifier.align(Alignment.BottomStart).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (progress != null) ProgressStrip(progress, Modifier.clip(CircleShape))
        }
    }
}

/** A titled horizontal row of cards. */
@Composable
fun Shelf(title: String, content: LazyListScope.() -> Unit) {
    val m = LocalMetrics.current
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = m.margin))
        LazyRow(contentPadding = PaddingValues(horizontal = m.margin), horizontalArrangement = Arrangement.spacedBy(12.dp), content = content)
    }
}

/** Round profile picture, or the first letter on a gradient (orange for Streamlings). */
@Composable
fun ProfileAvatar(profile: Profile, size: Dp, modifier: Modifier = Modifier) {
    val session = LocalSession.current
    val colors = if (profile.isKids) listOf(Brand.Streamling, Brand.StreamlingDeep) else listOf(Brand.Accent, Brand.Purple)
    Box(
        modifier.size(size).clip(CircleShape).background(Brush.linearGradient(colors, start = Offset.Zero, end = Offset.Infinite)),
        contentAlignment = Alignment.Center,
    ) {
        Text(profile.name.take(1).uppercase(), color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.42f).sp)
        session.imageUrl(profile.avatarPath)?.let { url ->
            AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

/** The title's logo artwork, or the title as text if there isn't one. */
@Composable
fun TitleLogo(url: String?, title: String, maxWidth: Dp, maxHeight: Dp, fontSize: TextUnit) {
    var failed by remember(url) { mutableStateOf(url == null) }
    if (failed) {
        Text(
            title,
            fontSize = fontSize,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.headlineLarge.copy(shadow = androidx.compose.ui.graphics.Shadow(Color.Black.copy(alpha = 0.6f), blurRadius = 16f)),
        )
    } else {
        AsyncImage(
            model = url,
            contentDescription = title,
            modifier = Modifier.widthIn(max = maxWidth).heightIn(max = maxHeight),
            contentScale = ContentScale.Fit,
            alignment = Alignment.CenterStart,
            onError = { failed = true },
        )
    }
}

/** Small rounded label, e.g. content rating or "Ends at 8:00 PM". */
@Composable
fun Pill(text: String, color: Color = Color.White) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        fontWeight = FontWeight.SemiBold,
        color = color,
        modifier = Modifier.clip(CircleShape).background(Color.White.copy(alpha = 0.12f)).padding(horizontal = 10.dp, vertical = 4.dp),
    )
}

/** "Cast" row: round headshots with names. */
@Composable
fun CastRow(cast: List<CastMember>) {
    val session = LocalSession.current
    val m = LocalMetrics.current
    Shelf("Cast") {
        items(cast, key = { it.id }) { person ->
            Column(Modifier.width(m.castSize + 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(m.castSize).clip(CircleShape).background(Brand.Placeholder), contentAlignment = Alignment.Center) {
                    val url = session.imageUrl(person.profilePath)
                    if (url != null) {
                        AsyncImage(model = url, contentDescription = null, modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                    } else {
                        Icon(Icons.Filled.Person, contentDescription = null, tint = Brand.Secondary, modifier = Modifier.size(m.castSize / 2))
                    }
                }
                Text(person.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                person.character?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = Brand.Secondary, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
                }
            }
        }
    }
}

/** The Streamulus logo and/or wordmark, following Admin › Settings › Branding. */
@Composable
fun BrandMark(size: Dp, modifier: Modifier = Modifier) {
    val session = LocalSession.current
    val branding = session.branding
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(size * 0.35f)) {
        if (branding.showLogo) {
            val custom = session.imageUrl(branding.logoUrl)
            if (custom != null) {
                AsyncImage(model = custom, contentDescription = "Streamulus", modifier = Modifier.size(size * 1.35f), contentScale = ContentScale.Fit)
            } else {
                Image(painterResource(R.drawable.streamulus_logo), contentDescription = "Streamulus", modifier = Modifier.size(size * 1.35f))
            }
        }
        if (branding.showText) {
            Text(
                "STREAMULUS",
                fontSize = size.value.sp,
                fontWeight = FontWeight.Black,
                maxLines = 1,
                style = MaterialTheme.typography.titleLarge.copy(brush = Brand.LogoGradient),
            )
        }
    }
}

/** Page title bar: back arrow, title, and actions (usually your profile picture). */
@Composable
fun TopBar(
    title: String?,
    onBack: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    leading: (@Composable () -> Unit)? = null,
    actions: @Composable () -> Unit = {},
) {
    Row(
        modifier.fillMaxWidth().statusBarsPadding().heightIn(min = 56.dp).padding(horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back") }
        } else {
            Spacer(Modifier.width(12.dp))
        }
        Box(Modifier.weight(1f)) {
            if (leading != null) leading()
            else if (title != null) Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        actions()
        Spacer(Modifier.width(8.dp))
    }
}

/** Your profile picture, top-right on every tab: opens Profile & Settings. */
@Composable
fun AccountButton() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val profile = session.profile ?: return
    Box(
        Modifier.padding(4.dp).size(40.dp).clip(CircleShape).clickable { navigator.push(Screen.Account) },
        contentAlignment = Alignment.Center,
    ) {
        ProfileAvatar(profile, 32.dp, Modifier.shadow(4.dp, CircleShape))
    }
}

/** Loading spinner, an error, or an empty message — centred over a list while it has nothing to show. */
@Composable
fun BoxScope.ListStatus(loading: Boolean, error: String?, isEmpty: Boolean, emptyText: String) {
    if (!isEmpty) return
    Column(
        Modifier.align(Alignment.Center).padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        when {
            loading -> CircularProgressIndicator()
            error != null -> {
                Text("Couldn't load", style = MaterialTheme.typography.titleMedium)
                Text(error, color = Brand.Secondary, textAlign = TextAlign.Center)
            }
            else -> Text(emptyText, color = Brand.Secondary, textAlign = TextAlign.Center)
        }
    }
}

/** A QR code, drawn crisply at any size (black on white, so cameras read it). */
@Composable
fun QrCode(text: String, modifier: Modifier = Modifier) {
    val matrix = remember(text) {
        runCatching {
            QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 1))
        }.getOrNull()
    }
    Canvas(modifier.background(Color.White)) {
        val bits = matrix ?: return@Canvas
        val cell = minOf(size.width / bits.width, size.height / bits.height)
        val left = (size.width - cell * bits.width) / 2
        val top = (size.height - cell * bits.height) / 2
        for (y in 0 until bits.height) {
            for (x in 0 until bits.width) {
                if (bits.get(x, y)) {
                    drawRect(Color.Black, topLeft = Offset(left + x * cell, top + y * cell), size = Size(cell + 0.5f, cell + 0.5f))
                }
            }
        }
    }
}
