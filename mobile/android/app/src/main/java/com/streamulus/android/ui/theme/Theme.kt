package com.streamulus.android.ui.theme

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color

/** Streamulus colours (same as the web app and the Apple apps). */
object Brand {
    val Accent = Color(0xFF00C2FF)
    val Purple = Color(0xFF7B2FFF)
    val Streamling = Color(0xFFFFB703)
    val StreamlingDeep = Color(0xFFFB5607)
    val Background = Color(0xFF0F0F0F)
    val Card = Color(0xFF1C1C1E)
    val Placeholder = Color(0xFF242424)
    val Secondary = Color(0xFFA0A0A8)
    val Success = Color(0xFF00C864)
    val LogoGradient = Brush.horizontalGradient(listOf(Accent, Purple))
}

private val Colors = darkColorScheme(
    primary = Brand.Accent,
    onPrimary = Color.Black,
    primaryContainer = Color(0xFF00384A),
    onPrimaryContainer = Color(0xFFB8EAFF),
    secondary = Brand.Purple,
    onSecondary = Color.White,
    tertiary = Brand.Streamling,
    onTertiary = Color.Black,
    background = Brand.Background,
    onBackground = Color.White,
    surface = Brand.Background,
    onSurface = Color.White,
    surfaceVariant = Color(0xFF2A2A2E),
    onSurfaceVariant = Brand.Secondary,
    surfaceContainerLowest = Color(0xFF0B0B0B),
    surfaceContainerLow = Color(0xFF151517),
    surfaceContainer = Brand.Card,
    surfaceContainerHigh = Color(0xFF242427),
    surfaceContainerHighest = Color(0xFF2E2E32),
    outline = Color(0xFF55555C),
    outlineVariant = Color(0xFF34343A),
    error = Color(0xFFFF6B6B),
)

@Composable
fun StreamulusTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors) {
        // Text and icons default to white: screens sit straight on the dark background
        // rather than inside a Material Surface, which would otherwise leave them black.
        CompositionLocalProvider(LocalContentColor provides Colors.onBackground, content = content)
    }
}
