package com.streamulus.android

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import coil3.request.crossfade
import com.streamulus.android.data.Session

/** Holds the one Session for the whole app (screens and the player share it). */
class StreamulusApplication : Application(), SingletonImageLoader.Factory {
    lateinit var session: Session
        private set

    override fun onCreate() {
        super.onCreate()
        session = Session(this)
    }

    /** Artwork fades in as it loads. */
    override fun newImageLoader(context: PlatformContext): ImageLoader =
        ImageLoader.Builder(context).crossfade(true).build()
}
