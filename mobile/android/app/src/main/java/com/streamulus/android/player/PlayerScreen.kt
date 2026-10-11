package com.streamulus.android.player

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cast
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ClosedCaption
import androidx.compose.material.icons.filled.Forward10
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PictureInPictureAlt
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Replay10
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.ClosedCaption
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.streamulus.android.data.Fmt
import com.streamulus.android.data.NextEpisode
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.delay
import kotlin.math.ceil

/**
 * The player's controls: tap to show / hide them, double-tap the left or right
 * side to skip 10 s, drag the progress bar to seek; subtitles, Cast, Picture in
 * Picture and Up Next for episodes.
 */
@Composable
fun PlayerScreen(
    controller: PlaybackController,
    inPictureInPicture: Boolean,
    canPictureInPicture: Boolean,
    onPictureInPicture: () -> Unit,
    onPlayingChanged: (Boolean) -> Unit,
    onClose: () -> Unit,
) {
    var controlsVisible by remember { mutableStateOf(true) }
    var pokes by remember { mutableIntStateOf(0) }
    var scrubbing by remember { mutableStateOf(false) }
    var skipHint by remember { mutableStateOf<Pair<Boolean, Int>?>(null) } // forward?, id
    val showControls = !inPictureInPicture && (controlsVisible || !controller.isPlaying || scrubbing || controller.pendingSeek != null)

    fun poke() {
        controlsVisible = true
        pokes++
    }

    // Hide the controls 3.5 s after the last touch while playing.
    LaunchedEffect(pokes, controller.isPlaying, scrubbing) {
        delay(3500)
        if (controller.isPlaying && !scrubbing) controlsVisible = false
    }
    LaunchedEffect(controller.isPlaying) { onPlayingChanged(controller.isPlaying) }
    LaunchedEffect(skipHint) {
        if (skipHint != null) {
            delay(600)
            skipHint = null
        }
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (controller.casting) {
            CastingPanel(controller.castDeviceName, controller.title)
        } else {
            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { context ->
                    PlayerView(context).apply {
                        useController = false
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        setShutterBackgroundColor(android.graphics.Color.BLACK)
                        player = controller.exo
                    }
                },
            )
        }

        if (!inPictureInPicture) {
            // Tap: show/hide controls. Double-tap left / right: back / forward 10 s.
            Row(Modifier.fillMaxSize()) {
                listOf(false, true).forEach { forward ->
                    Box(
                        Modifier.weight(1f).fillMaxHeight().pointerInput(forward) {
                            detectTapGestures(
                                onTap = {
                                    if (showControls && controller.isPlaying) controlsVisible = false else poke()
                                },
                                onDoubleTap = {
                                    controller.skip(if (forward) 10.0 else -10.0)
                                    skipHint = forward to (skipHint?.second ?: 0) + 1
                                    poke()
                                },
                            )
                        },
                    )
                }
            }
        }

        skipHint?.let { (forward, _) ->
            Box(
                Modifier.align(if (forward) Alignment.CenterEnd else Alignment.CenterStart).padding(horizontal = 60.dp)
                    .size(84.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.5f)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(if (forward) Icons.Filled.Forward10 else Icons.Filled.Replay10, contentDescription = null, tint = Color.White, modifier = Modifier.size(40.dp))
            }
        }

        if (controller.isBuffering && controller.errorText == null && !controller.casting) {
            CircularProgressIndicator(Modifier.align(Alignment.Center).size(52.dp), color = Color.White)
        }

        if (controller.subtitleLines.isNotEmpty()) {
            Column(
                Modifier.align(Alignment.BottomCenter).padding(horizontal = 16.dp)
                    .padding(bottom = if (inPictureInPicture) 6.dp else if (showControls) 120.dp else 28.dp)
                    .widthIn(max = 900.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                controller.subtitleLines.forEach { line ->
                    Text(
                        line,
                        color = Color.White,
                        style = if (inPictureInPicture) MaterialTheme.typography.labelSmall else MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Color.Black.copy(alpha = 0.6f)).padding(horizontal = 10.dp, vertical = 3.dp),
                    )
                }
            }
        }

        AnimatedVisibility(showControls, enter = fadeIn(), exit = fadeOut(), modifier = Modifier.fillMaxSize()) {
            Controls(
                controller = controller,
                canPictureInPicture = canPictureInPicture,
                onPictureInPicture = onPictureInPicture,
                onClose = {
                    controller.stop()
                    onClose()
                },
                onScrubbing = { scrubbing = it; poke() },
                onTouch = ::poke,
            )
        }

        val next = controller.upNext
        AnimatedVisibility(
            visible = controller.showUpNext && next != null && !inPictureInPicture,
            enter = slideInHorizontally { it } + fadeIn(),
            exit = slideOutHorizontally { it } + fadeOut(),
            modifier = Modifier.align(Alignment.BottomEnd).safeDrawingPadding().padding(end = 16.dp, bottom = if (showControls) 130.dp else 24.dp),
        ) {
            if (next != null) UpNextCard(controller, next)
        }

        controller.errorText?.let { message ->
            ErrorPanel(message, Modifier.align(Alignment.Center), onClose = {
                controller.stop()
                onClose()
            })
        }
    }
}

@Composable
private fun Controls(
    controller: PlaybackController,
    canPictureInPicture: Boolean,
    onPictureInPicture: () -> Unit,
    onClose: () -> Unit,
    onScrubbing: (Boolean) -> Unit,
    onTouch: () -> Unit,
) {
    Box(Modifier.fillMaxSize()) {
        // Top: close, title, subtitles, Cast, Picture in Picture.
        Row(
            Modifier.fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.7f), Color.Transparent)))
                .safeDrawingPadding().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) { Icon(Icons.Filled.Close, contentDescription = "Close", tint = Color.White) }
            Column(Modifier.weight(1f).padding(horizontal = 4.dp)) {
                Text(controller.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis)
                controller.subtitle?.let {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.7f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (controller.subtitleTracks.isNotEmpty()) SubtitlesMenu(controller, onTouch)
            if (controller.castAvailable) CastButton()
            if (canPictureInPicture && !controller.casting) {
                IconButton(onClick = onPictureInPicture) { Icon(Icons.Filled.PictureInPictureAlt, contentDescription = "Picture in Picture", tint = Color.White) }
            }
        }

        // Centre: back 10, play / pause, forward 10.
        Row(
            Modifier.align(Alignment.Center),
            horizontalArrangement = Arrangement.spacedBy(36.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundButton(Icons.Filled.Replay10, "Back 10 seconds", 56.dp) { controller.skip(-10.0); onTouch() }
            RoundButton(if (controller.isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow, if (controller.isPlaying) "Pause" else "Play", 76.dp) {
                controller.togglePlay()
                onTouch()
            }
            RoundButton(Icons.Filled.Forward10, "Forward 10 seconds", 56.dp) { controller.skip(10.0); onTouch() }
        }

        // Bottom: progress bar and times.
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.75f))))
                .safeDrawingPadding().padding(horizontal = 20.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Scrubber(controller, onScrubbing)
            val shown = controller.pendingSeek ?: controller.position
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(Fmt.clock(shown.toInt()), style = MaterialTheme.typography.labelMedium, color = Color.White)
                Spacer(Modifier.weight(1f))
                if (controller.duration > 0) {
                    val left = maxOf(0.0, controller.duration - shown).toInt()
                    Text("-${Fmt.clock(left)}  ·  Ends at ${Fmt.endsAt(left)}", style = MaterialTheme.typography.labelMedium, color = Color.White.copy(alpha = 0.8f))
                }
            }
        }
    }
}

@Composable
private fun RoundButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, size: androidx.compose.ui.unit.Dp, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.size(size).clip(CircleShape).background(Color.Black.copy(alpha = 0.4f)),
    ) {
        Icon(icon, contentDescription = label, tint = Color.White, modifier = Modifier.size(size * 0.55f))
    }
}

/** Drag anywhere along the bar (or tap); the knob follows and the seek happens on release. */
@Composable
private fun Scrubber(controller: PlaybackController, onScrubbing: (Boolean) -> Unit) {
    var dragging by remember { mutableStateOf(false) }
    val duration = controller.duration
    Box(
        Modifier.fillMaxWidth().height(30.dp)
            .pointerInput(duration) {
                detectTapGestures { offset ->
                    if (duration > 0) controller.seek((offset.x / size.width).coerceIn(0f, 1f) * duration)
                }
            }
            .pointerInput(duration) {
                detectHorizontalDragGestures(
                    onDragStart = { offset ->
                        if (duration > 0) {
                            dragging = true
                            onScrubbing(true)
                            controller.seek((offset.x / size.width).coerceIn(0f, 1f) * duration, commit = false)
                        }
                    },
                    onDragEnd = {
                        if (dragging) controller.seek(controller.pendingSeek ?: controller.position)
                        dragging = false
                        onScrubbing(false)
                    },
                    onDragCancel = {
                        dragging = false
                        onScrubbing(false)
                    },
                    onHorizontalDrag = { change, _ ->
                        if (duration > 0) controller.seek((change.position.x / size.width).coerceIn(0f, 1f) * duration, commit = false)
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        val shown = controller.pendingSeek ?: controller.position
        val played = if (duration > 0) (controller.position / duration).coerceIn(0.0, 1.0).toFloat() else 0f
        val loaded = if (duration > 0) (controller.buffered / duration).coerceIn(0.0, 1.0).toFloat() else 0f
        val knob = if (duration > 0) (shown / duration).coerceIn(0.0, 1.0).toFloat() else 0f
        Canvas(Modifier.fillMaxWidth().height(24.dp)) {
            val bar = if (dragging) 8.dp.toPx() else 5.dp.toPx()
            val top = (size.height - bar) / 2
            val radius = CornerRadius(bar / 2, bar / 2)
            drawRoundRect(Color.White.copy(alpha = 0.25f), Offset(0f, top), Size(size.width, bar), radius)
            drawRoundRect(Color.White.copy(alpha = 0.4f), Offset(0f, top), Size(size.width * maxOf(loaded, played), bar), radius)
            drawRoundRect(Brand.Accent, Offset(0f, top), Size(size.width * played, bar), radius)
            val knobRadius = if (dragging) 11.dp.toPx() else 7.dp.toPx()
            drawCircle(Color.White, knobRadius, Offset(size.width * knob, size.height / 2))
        }
    }
}

@Composable
private fun SubtitlesMenu(controller: PlaybackController, onTouch: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true; onTouch() }) {
            Icon(
                if (controller.selectedSubtitle == null) Icons.Outlined.ClosedCaption else Icons.Filled.ClosedCaption,
                contentDescription = "Subtitles",
                tint = Color.White,
            )
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text("Off") },
                leadingIcon = { if (controller.selectedSubtitle == null) Icon(Icons.Filled.Check, null) else Spacer(Modifier.width(24.dp)) },
                onClick = { controller.selectSubtitle(null); open = false },
            )
            controller.subtitleTracks.forEach { track ->
                DropdownMenuItem(
                    text = { Text(track.label + if (controller.subtitleLoading && controller.selectedSubtitle == track.id) " (loading…)" else "") },
                    leadingIcon = { if (controller.selectedSubtitle == track.id) Icon(Icons.Filled.Check, null) else Spacer(Modifier.width(24.dp)) },
                    onClick = { controller.selectSubtitle(track); open = false },
                )
            }
        }
    }
}

@Composable
private fun UpNextCard(controller: PlaybackController, next: NextEpisode) {
    val fraction = (controller.remaining / controller.upNextSeconds).coerceIn(0.0, 1.0).toFloat()
    Surface(shape = RoundedCornerShape(22.dp), color = Color(0xEE1C1C1E), modifier = Modifier.width(300.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("UP NEXT", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Black, color = Brand.Accent)
                Spacer(Modifier.weight(1f))
                Text("${ceil(controller.remaining).toInt()}s", style = MaterialTheme.typography.labelSmall, color = Brand.Secondary)
            }
            Text(next.label, style = MaterialTheme.typography.titleSmall, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Box(Modifier.fillMaxWidth().height(4.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.2f))) {
                Box(Modifier.fillMaxWidth(fraction).height(4.dp).background(Brand.Accent))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Button(onClick = { controller.playNextNow() }) {
                    Icon(Icons.Filled.PlayArrow, contentDescription = null)
                    Text("Play Now")
                }
                FilledTonalButton(onClick = { controller.dismissUpNext() }) { Text("Hide") }
            }
        }
    }
}

@Composable
private fun CastingPanel(deviceName: String?, title: String) {
    Column(
        Modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
    ) {
        Icon(Icons.Filled.Cast, contentDescription = null, tint = Brand.Accent, modifier = Modifier.size(56.dp))
        Text(title, style = MaterialTheme.typography.titleLarge, color = Color.White, textAlign = TextAlign.Center)
        Text("Playing on ${deviceName ?: "your Cast device"}", color = Brand.Secondary, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ErrorPanel(message: String, modifier: Modifier, onClose: () -> Unit) {
    Surface(shape = RoundedCornerShape(26.dp), color = Color(0xF21C1C1E), modifier = modifier.padding(24.dp).widthIn(max = 420.dp)) {
        Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(Icons.Filled.Warning, contentDescription = null, tint = Brand.Streamling, modifier = Modifier.size(40.dp))
            Text("This video couldn't be played", style = MaterialTheme.typography.titleMedium, color = Color.White)
            Text(message, style = MaterialTheme.typography.bodyMedium, color = Brand.Secondary, textAlign = TextAlign.Center)
            Button(onClick = onClose) { Text("Close") }
        }
    }
}
