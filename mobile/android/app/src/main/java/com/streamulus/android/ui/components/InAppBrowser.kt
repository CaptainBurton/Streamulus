package com.streamulus.android.ui.components

import android.content.ActivityNotFoundException
import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.ui.graphics.toArgb
import com.streamulus.android.ui.theme.Brand

/**
 * Opens a web page inside the app — a Custom Tab, the browser sliding up over the
 * app like links in Messenger — instead of switching to the browser app. Closing
 * it (✕ or Back) returns to where you were. Returns false if nothing could open it.
 */
fun openInAppBrowser(context: Context, url: String): Boolean {
    val colors = CustomTabColorSchemeParams.Builder()
        .setToolbarColor(Brand.Background.toArgb())
        .setNavigationBarColor(Brand.Background.toArgb())
        .build()
    val tab = CustomTabsIntent.Builder()
        .setShowTitle(true)
        .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
        .setDefaultColorSchemeParams(colors)
        .build()
    return try {
        tab.launchUrl(context, Uri.parse(url))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }
}
