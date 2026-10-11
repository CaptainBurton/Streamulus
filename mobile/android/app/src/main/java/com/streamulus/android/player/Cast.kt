package com.streamulus.android.player

import android.content.Context
import android.view.ContextThemeWrapper
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.mediarouter.app.MediaRouteButton
import com.google.android.gms.cast.CastMediaControlIntent
import com.google.android.gms.cast.framework.CastButtonFactory
import com.google.android.gms.cast.framework.CastOptions
import com.google.android.gms.cast.framework.OptionsProvider
import com.google.android.gms.cast.framework.SessionProvider

/**
 * Google Cast set-up (named in AndroidManifest.xml). Uses Google's Default Media
 * Receiver, which plays the server's HLS streams on Chromecasts and Google TV.
 */
class CastOptionsProvider : OptionsProvider {
    override fun getCastOptions(context: Context): CastOptions =
        CastOptions.Builder()
            .setReceiverApplicationId(CastMediaControlIntent.DEFAULT_MEDIA_RECEIVER_APPLICATION_ID)
            .build()

    override fun getAdditionalSessionProviders(context: Context): List<SessionProvider>? = null
}

/** The system Cast button: lists Cast devices on your network and connects to one. */
@Composable
fun CastButton(modifier: Modifier = Modifier) {
    AndroidView(
        modifier = modifier.size(48.dp),
        factory = { context ->
            // The button's menus need an AppCompat theme.
            val themed = ContextThemeWrapper(context, androidx.appcompat.R.style.Theme_AppCompat_NoActionBar)
            MediaRouteButton(themed).also { button ->
                runCatching { CastButtonFactory.setUpMediaRouteButton(context.applicationContext, button) }
            }
        },
    )
}
