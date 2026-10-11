package com.streamulus.android.player

import android.app.PictureInPictureParams
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.util.Rational
import android.view.WindowManager
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.fragment.app.FragmentActivity
import androidx.media3.session.MediaSession
import com.streamulus.android.StreamulusApplication
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.theme.StreamulusTheme

/**
 * Full-screen player. Leaving it while a video plays switches to Picture in
 * Picture (automatically on Android 12+); the media session gives the PiP window,
 * headphones and Bluetooth controls play / pause.
 */
class PlayerActivity : FragmentActivity() { // the Cast button's device list needs a FragmentActivity
    private var controller: PlaybackController? = null
    private var mediaSession: MediaSession? = null
    private val inPip = mutableStateOf(false)
    private var stopped = false

    private val supportsPip: Boolean
        get() = packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val request = PlayRequest.from(intent)
        if (request == null) {
            finish()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        if (Build.VERSION.SDK_INT >= 28) {
            window.attributes = window.attributes.also {
                it.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        WindowCompat.getInsetsController(window, window.decorView).let {
            it.hide(WindowInsetsCompat.Type.systemBars())
            it.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }

        val session = (application as StreamulusApplication).session
        val playback = PlaybackController(this, session, request, onFinished = { finish() })
        controller = playback
        mediaSession = runCatching { MediaSession.Builder(this, playback.exo).build() }.getOrNull()

        setContent {
            StreamulusTheme {
                CompositionLocalProvider(LocalSession provides session) {
                    PlayerScreen(
                        controller = playback,
                        inPictureInPicture = inPip.value,
                        canPictureInPicture = supportsPip,
                        onPictureInPicture = ::enterPip,
                        onPlayingChanged = { updatePipParams() },
                        onClose = { finish() },
                    )
                }
            }
        }
    }

    /** A new title chosen while this player is open (e.g. behind Picture in Picture). */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        PlayRequest.from(intent)?.let { controller?.open(it) }
    }

    private fun pipParams(): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder().setAspectRatio(Rational(16, 9))
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setAutoEnterEnabled(controller?.isPlaying == true)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    private fun updatePipParams() {
        if (supportsPip) runCatching { setPictureInPictureParams(pipParams()) }
    }

    private fun enterPip() {
        if (supportsPip) runCatching { enterPictureInPictureMode(pipParams()) }
    }

    /** Before Android 12, start Picture in Picture by hand when you leave while it plays. */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (Build.VERSION.SDK_INT < 31 && controller?.isPlaying == true) enterPip()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip.value = isInPictureInPictureMode
        // Closing the Picture in Picture window stops the activity first: that's the end of playback.
        if (!isInPictureInPictureMode && stopped) finish()
    }

    override fun onStart() {
        super.onStart()
        stopped = false
    }

    override fun onStop() {
        super.onStop()
        stopped = true
        // Not in Picture in Picture (e.g. it isn't available): pause rather than play unseen.
        if (!isInPictureInPictureMode && !isChangingConfigurations) controller?.pause()
    }

    override fun onDestroy() {
        mediaSession?.release()
        mediaSession = null
        controller?.stop()
        controller = null
        super.onDestroy()
    }
}
