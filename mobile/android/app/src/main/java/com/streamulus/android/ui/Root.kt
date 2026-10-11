package com.streamulus.android.ui

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.streamulus.android.data.Session
import com.streamulus.android.ui.components.BrandMark
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.Metrics
import com.streamulus.android.ui.signin.ProfilePickerScreen
import com.streamulus.android.ui.signin.ServerSetupScreen
import com.streamulus.android.ui.signin.SignInScreen
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.launch

/** Picks the screen for the session's phase: connect, sign in, Who's watching?, or the app. */
@Composable
fun RootScreen() {
    val session = LocalSession.current
    LaunchedEffect(Unit) { session.start() }
    BoxWithConstraints(Modifier.fillMaxSize().background(Brand.Background)) {
        CompositionLocalProvider(LocalMetrics provides Metrics(wide = maxWidth >= 600.dp)) {
            Crossfade(targetState = session.phase, label = "phase") { phase ->
                when (phase) {
                    Session.Phase.Starting -> Starting()
                    Session.Phase.NeedsServer -> ServerSetupScreen()
                    Session.Phase.SignedOut -> SignInScreen()
                    Session.Phase.PickingProfile -> ProfilePickerScreen()
                    Session.Phase.Ready -> MainScreen()
                    is Session.Phase.Unreachable -> Unreachable(phase.message)
                }
            }
        }
    }
}

@Composable
private fun Starting() {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(28.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        BrandMark(30.dp)
        CircularProgressIndicator()
    }
}

@Composable
private fun Unreachable(message: String) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.Center) {
        Column(
            Modifier.widthIn(max = 520.dp).padding(28.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            BrandMark(28.dp)
            Icon(Icons.Filled.WifiOff, contentDescription = null, tint = Brand.Secondary, modifier = Modifier.size(44.dp))
            Text("Can't reach your Streamulus server", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text(message, color = Brand.Secondary, textAlign = TextAlign.Center)
            if (session.publicUrl == null) {
                Text(
                    "Away from home? Ask your server's admin for its public address (Admin › Settings › Remote Access) and use it with Change Server.",
                    style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, textAlign = TextAlign.Center,
                )
            }
            Button(onClick = { scope.launch { session.start() } }, modifier = Modifier.fillMaxWidth()) { Text("Try Again") }
            OutlinedButton(onClick = { session.changeServer() }, modifier = Modifier.fillMaxWidth()) { Text("Change Server") }
        }
    }
}
