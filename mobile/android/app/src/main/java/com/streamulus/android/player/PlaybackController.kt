package com.streamulus.android.player

import android.content.Context
import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.media3.cast.CastPlayer
import androidx.media3.cast.SessionAvailabilityListener
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.google.android.gms.cast.framework.CastContext
import com.streamulus.android.data.MediaType
import com.streamulus.android.data.NextEpisode
import com.streamulus.android.data.Session
import com.streamulus.android.data.SubtitleCue
import com.streamulus.android.data.SubtitleTrack
import com.streamulus.android.data.WebVTT
import com.streamulus.android.data.int
import com.streamulus.android.data.obj
import com.streamulus.android.data.objects
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

/** Something to play. `start` is where to begin, in seconds into the file. */
data class PlayRequest(val type: MediaType, val mediaId: Int, val start: Int, val title: String, val subtitle: String?) {
    fun toIntent(context: Context): Intent = Intent(context, PlayerActivity::class.java)
        .putExtra(TYPE, type.key)
        .putExtra(ID, mediaId)
        .putExtra(START, start)
        .putExtra(TITLE, title)
        .putExtra(SUBTITLE, subtitle)

    companion object {
        private const val TYPE = "type"
        private const val ID = "id"
        private const val START = "start"
        private const val TITLE = "title"
        private const val SUBTITLE = "subtitle"

        fun from(intent: Intent?): PlayRequest? {
            intent ?: return null
            val type = MediaType.entries.firstOrNull { it.key == intent.getStringExtra(TYPE) } ?: return null
            val id = intent.getIntExtra(ID, -1).takeIf { it >= 0 } ?: return null
            return PlayRequest(type, id, intent.getIntExtra(START, 0), intent.getStringExtra(TITLE) ?: "", intent.getStringExtra(SUBTITLE))
        }
    }
}

/** Opens the full-screen player. */
fun Context.play(type: MediaType, id: Int, start: Int, title: String, subtitle: String? = null) {
    startActivity(PlayRequest(type, id, start, title, subtitle).toIntent(this))
}

/**
 * Drives playback for the player screen, the same way as the iPhone app: the
 * position in the whole file (streams can start part-way in), debounced seeking,
 * progress saving, subtitles, Up Next for episodes, a re-encoded retry when a
 * stream can't be played, and moving playback to a Google Cast device.
 */
class PlaybackController(
    context: Context,
    private val session: Session,
    request: PlayRequest,
    private val onFinished: () -> Unit,
) {
    private val prefs = context.getSharedPreferences("streamulus", Context.MODE_PRIVATE)
    private val scope = MainScope()

    val exo: ExoPlayer = ExoPlayer.Builder(context)
        .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(), true)
        .setHandleAudioBecomingNoisy(true)
        .build()

    /** Google Cast, when Google Play services are there. */
    private val castContext: CastContext? = runCatching {
        @Suppress("DEPRECATION")
        CastContext.getSharedInstance(context)
    }.getOrNull()
    private val cast: CastPlayer? = castContext?.let { runCatching { CastPlayer(it) }.getOrNull() }
    val castAvailable: Boolean get() = cast != null

    /** The player in use: this device, or the Cast device. */
    var player: Player by mutableStateOf<Player>(exo)
        private set
    var castDeviceName by mutableStateOf<String?>(null)
        private set
    val casting: Boolean get() = player !== exo

    var title by mutableStateOf(request.title)
        private set
    var subtitle by mutableStateOf(request.subtitle)
        private set
    /** Seconds into the whole file; 0 until known for duration. */
    var position by mutableDoubleStateOf(request.start.toDouble())
        private set
    var duration by mutableDoubleStateOf(0.0)
        private set
    var buffered by mutableDoubleStateOf(request.start.toDouble())
        private set
    var isPlaying by mutableStateOf(false)
        private set
    var isBuffering by mutableStateOf(true)
        private set
    /** Where you're skipping or dragging to (the seek happens once you stop). */
    var pendingSeek by mutableStateOf<Double?>(null)
        private set
    var upNext by mutableStateOf<NextEpisode?>(null)
        private set
    var upNextSeconds by mutableIntStateOf(30)
        private set
    var upNextDismissed by mutableStateOf(false)
    var errorText by mutableStateOf<String?>(null)
        private set

    var subtitleTracks by mutableStateOf<List<SubtitleTrack>>(emptyList())
        private set
    var selectedSubtitle by mutableStateOf<String?>(null)
        private set
    var subtitleLines by mutableStateOf<List<String>>(emptyList())
        private set
    var subtitleLoading by mutableStateOf(false)
        private set

    val remaining: Double get() = max(0.0, duration - position)

    /** The Up Next card: the last `upNextSeconds` of an episode that has a next one. */
    val showUpNext: Boolean get() = upNext != null && !upNextDismissed && duration > 0 && remaining > 0 && remaining <= upNextSeconds

    private var current = request
    private var compat = false
    private var advancing = false
    private var stopped = false
    private var lastSaved = System.currentTimeMillis()
    private var seekJob: Job? = null
    private var cues: List<SubtitleCue> = emptyList()
    private var subtitleMedia: String? = null
    private var subtitleJob: Job? = null

    private fun listenerFor(source: Player) = object : Player.Listener {
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (source === player) this@PlaybackController.isPlaying = isPlaying
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (source !== player) return
            isBuffering = playbackState == Player.STATE_BUFFERING
            if (playbackState == Player.STATE_ENDED) scope.launch { didReachEnd() }
        }

        override fun onPlayerError(error: PlaybackException) {
            if (source === player) itemFailed(error)
        }
    }

    init {
        exo.addListener(listenerFor(exo))
        cast?.let { castPlayer ->
            castPlayer.addListener(listenerFor(castPlayer))
            castPlayer.setSessionAvailabilityListener(object : SessionAvailabilityListener {
                override fun onCastSessionAvailable() = switchTo(castPlayer)
                override fun onCastSessionUnavailable() = switchTo(exo)
            })
            if (castPlayer.isCastSessionAvailable) {
                player = castPlayer
                castDeviceName = deviceName()
            }
        }
        load(request)
        scope.launch {
            while (isActive) {
                tick()
                delay(500)
            }
        }
        // Subtitles need finer timing than the controls.
        scope.launch {
            while (isActive) {
                updateSubtitleLines()
                delay(100)
            }
        }
    }

    // ── Loading ──────────────────────────────────────────────────────────────

    /** Play something else in this player (e.g. chosen while Picture in Picture was showing). */
    fun open(request: PlayRequest) {
        scope.launch { saveProgress() }
        load(request)
    }

    /** `compat`: ask the server to fully re-encode — used to retry a stream that failed. */
    private fun load(request: PlayRequest, compat: Boolean = false) {
        current = request
        this.compat = compat
        // A different title (not a seek or retry of this one): fetch its subtitle tracks.
        val mediaKey = "${request.type.key}-${request.mediaId}"
        if (mediaKey != subtitleMedia) {
            subtitleMedia = mediaKey
            loadSubtitleTracks(request.type, request.mediaId)
        }
        title = request.title
        subtitle = request.subtitle
        position = request.start.toDouble()
        buffered = request.start.toDouble()
        duration = 0.0
        pendingSeek = null
        upNext = null
        upNextDismissed = false
        errorText = null
        advancing = false
        isBuffering = true

        val url = session.streamUrl(request.type, request.mediaId, request.start, compat)
        if (url == null) {
            errorText = "You're signed out — sign in again to play."
            return
        }
        val item = MediaItem.Builder()
            .setUri(url)
            .setMimeType(MimeTypes.APPLICATION_M3U8)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(request.title).setSubtitle(request.subtitle).build())
            .build()
        player.setMediaItem(item, 0)
        player.prepare()
        player.playWhenReady = true

        if (request.type == MediaType.Episode) {
            val id = request.mediaId
            scope.launch { loadUpNext(id) }
        }
    }

    /** Some files can't be streamed as they are; try once more with the server re-encoding everything. */
    private fun itemFailed(error: PlaybackException) {
        if (compat || stopped) {
            errorText = error.message ?: "This video couldn't be played."
            return
        }
        val resumeAt = max(current.start, (pendingSeek ?: position).toInt())
        load(current.copy(start = resumeAt), compat = true)
    }

    /** Moving to or from a Cast device: carry on from the same spot. */
    private fun switchTo(target: Player) {
        if (player === target || stopped) return
        val resumeAt = (pendingSeek ?: position).toInt()
        runCatching { player.stop() }
        player = target
        castDeviceName = if (target === exo) null else deviceName()
        isPlaying = false
        load(current.copy(start = resumeAt), compat)
    }

    private fun deviceName(): String? = runCatching { castContext?.sessionManager?.currentCastSession?.castDevice?.friendlyName }.getOrNull()

    // ── Subtitles ────────────────────────────────────────────────────────────

    private fun loadSubtitleTracks(type: MediaType, id: Int) {
        subtitleJob?.cancel()
        subtitleTracks = emptyList()
        selectedSubtitle = null
        cues = emptyList()
        subtitleLines = emptyList()
        val media = "${type.key}-$id"
        subtitleJob = scope.launch {
            val tracks = runCatching { session.getObject("/api/subtitles/${type.key}/$id").objects("tracks").map(SubtitleTrack::from) }.getOrNull()
            if (tracks == null || subtitleMedia != media) return@launch
            subtitleTracks = tracks
            // Turn on the language used last time, if this title has it.
            val language = prefs.getString(LANGUAGE, null)
            if (language != null && language != "off") {
                val track = tracks.firstOrNull { it.language == language && !it.forced } ?: tracks.firstOrNull { it.language == language }
                if (track != null) loadCues(track)
            }
        }
    }

    /** null turns subtitles off. Remembers the language for next time. */
    fun selectSubtitle(track: SubtitleTrack?) {
        prefs.edit().putString(LANGUAGE, track?.language ?: "off").apply()
        subtitleJob?.cancel()
        if (track == null) {
            selectedSubtitle = null
            cues = emptyList()
            subtitleLines = emptyList()
            subtitleLoading = false
            return
        }
        subtitleJob = scope.launch { loadCues(track) }
    }

    private suspend fun loadCues(track: SubtitleTrack) {
        val media = subtitleMedia ?: return
        val (type, id) = media.split("-").takeIf { it.size == 2 }?.let { it[0] to it[1] } ?: return
        selectedSubtitle = track.id
        cues = emptyList()
        subtitleLines = emptyList()
        subtitleLoading = true
        val path = "/api/subtitles/$type/$id/${track.id}.vtt"
        // The server may still be reading subtitles out of the video file: use
        // what's there now and fetch again every few seconds until complete.
        while (true) {
            val result = runCatching { session.subtitles(path) }.getOrNull()
            if (subtitleMedia != media || selectedSubtitle != track.id) return
            subtitleLoading = false
            if (result == null) {
                // Couldn't load: show subtitles as off rather than stuck on "Loading".
                if (cues.isEmpty()) selectedSubtitle = null
                return
            }
            cues = WebVTT.parse(result.first)
            updateSubtitleLines()
            if (result.second) return
            delay(5000)
        }
    }

    private fun updateSubtitleLines() {
        if (cues.isEmpty()) {
            if (subtitleLines.isNotEmpty()) subtitleLines = emptyList()
            return
        }
        if (pendingSeek != null) return
        val lines = WebVTT.linesAt(cues, current.start + player.currentPosition / 1000.0)
        if (lines != subtitleLines) subtitleLines = lines
    }

    private suspend fun loadUpNext(episodeId: Int) {
        val response = runCatching { session.getObject("/api/tv/episode/$episodeId/next") }.getOrNull() ?: return
        if (current.mediaId != episodeId || current.type != MediaType.Episode) return
        upNext = response.obj("next")?.let(NextEpisode::from)
        upNextSeconds = max(5, response.int("upNextSeconds") ?: 30)
    }

    private fun tick() {
        if (stopped) return
        // Only publish real changes: every change redraws the controls.
        val seconds = player.currentPosition / 1000.0
        if (pendingSeek == null) {
            val newPosition = current.start + seconds
            if (abs(newPosition - position) >= 0.25) position = newPosition
        }
        val length = player.duration
        if (length != C.TIME_UNSET && length > 0) {
            val newDuration = current.start + length / 1000.0
            if (newDuration != duration) duration = newDuration
        }
        // How far ahead is loaded (the lighter part of the progress bar).
        val newBuffered = current.start + player.bufferedPosition / 1000.0
        if (abs(newBuffered - buffered) >= 1) buffered = newBuffered
        if (isPlaying && System.currentTimeMillis() - lastSaved >= 10_000) {
            lastSaved = System.currentTimeMillis()
            scope.launch { saveProgress() }
        }
        // Go to the next episode in the last second — some streams never say they've ended.
        if (upNext != null && duration > 0 && remaining <= 1 && !advancing) {
            scope.launch { advance() }
        }
    }

    // ── Controls ─────────────────────────────────────────────────────────────

    fun togglePlay() {
        if (player.isPlaying) player.pause() else player.play()
    }

    fun pause() {
        player.pause()
    }

    /** Skip by `delta` seconds. Presses add up and the seek happens once you stop pressing. */
    fun skip(delta: Double) {
        var target = (pendingSeek ?: position) + delta
        if (duration > 0) target = min(target, duration - 3)
        pendingSeek = max(0.0, target)
        seekJob?.cancel()
        seekJob = scope.launch {
            delay(700)
            commitSeek()
        }
    }

    /** Jump to `seconds` into the file (dragging the progress bar). `commit = false` only moves the knob. */
    fun seek(seconds: Double, commit: Boolean = true) {
        var target = seconds
        if (duration > 0) target = min(target, duration - 3)
        pendingSeek = max(0.0, target)
        seekJob?.cancel()
        if (commit) seekJob = scope.launch { commitSeek() }
    }

    private fun commitSeek() {
        val target = pendingSeek ?: return
        if (target < current.start) {
            // Before where this stream begins — open a new stream from there.
            load(current.copy(start = target.toInt()), compat)
            return
        }
        player.seekTo(((target - current.start) * 1000).toLong())
        position = target
        pendingSeek = null
    }

    fun playNextNow() {
        scope.launch { advance() }
    }

    fun dismissUpNext() {
        upNextDismissed = true
    }

    // ── End of item ──────────────────────────────────────────────────────────

    private suspend fun advance() {
        if (advancing) return
        advancing = true
        saveProgress(completed = true)
        val next = upNext
        if (next == null) {
            finish()
            return
        }
        // The next episode always starts from the beginning.
        load(PlayRequest(MediaType.Episode, next.id, 0, current.title, next.label))
    }

    private suspend fun didReachEnd() {
        if (current.type == MediaType.Episode && upNext != null) {
            advance()
        } else {
            saveProgress(completed = true)
            finish()
        }
    }

    private fun finish() {
        stop()
        onFinished()
    }

    // ── Progress ─────────────────────────────────────────────────────────────

    private suspend fun saveProgress(completed: Boolean? = null) {
        val pos = position.toInt()
        if (pos < 2) return
        val done = completed ?: (duration > 0 && position / duration > 0.9)
        runCatching {
            session.post("/api/stream/progress", buildJsonObject {
                put("mediaType", current.type.key)
                put("mediaId", current.mediaId)
                put("position", pos)
                put("completed", done)
            })
        }
    }

    /** Called when the player closes. */
    fun stop() {
        if (stopped) return
        stopped = true
        seekJob?.cancel()
        subtitleJob?.cancel()
        runCatching { player.pause() }
        // Save where you got to, then let the screens behind reload Continue Watching.
        MainScope().launch {
            saveProgress()
            session.notePlaybackEnded()
        }
        scope.cancel()
        cast?.setSessionAvailabilityListener(null)
        runCatching { cast?.stop() }
        runCatching { cast?.release() }
        exo.release()
    }

    private companion object {
        const val LANGUAGE = "subtitleLanguage"
    }
}
