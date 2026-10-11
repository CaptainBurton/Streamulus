package com.streamulus.android.ui.account

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Feedback
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Translate
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Badge
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.BrandMark
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.ProfileAvatar
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.launch

/** Profile & Settings (opened from your profile picture, top-right). */
@Composable
fun AccountScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    var savingEnglish by remember { mutableStateOf(false) }
    var confirmChangeServer by remember { mutableStateOf(false) }
    var unreadFeedback by remember { mutableIntStateOf(0) }
    val profile = session.profile

    // Runs again when you come back from Feedback (this page is rebuilt), so the badge stays current.
    LaunchedEffect(Unit) { unreadFeedback = session.unreadFeedbackCount() }

    Column(Modifier.fillMaxSize()) {
        TopBar("Profile & Settings", onBack = { navigator.pop() })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = LocalMetrics.current.margin)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            if (profile != null) {
                Group {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        ProfileAvatar(profile, 64.dp)
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            Text(profile.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                            if (profile.isKids) Text("STREAMLING", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Black, color = Brand.Streamling)
                            session.user?.let { Text("Signed in as ${it.username}", color = Brand.Secondary, style = MaterialTheme.typography.bodyMedium) }
                        }
                    }
                    Divider()
                    // The admin's provided pictures — also how Streamlings change theirs.
                    LinkRow(Icons.Filled.AccountCircle, "Choose a Picture") { navigator.push(Screen.AvatarPicker) }
                    Divider()
                    LinkRow(Icons.Filled.People, "Switch Profile") { session.switchProfile() }
                }

                Group(footer = "Shows English titles and descriptions for movies and shows stored in another language, where available. For this profile, here and on the web, iPhone and Apple TV.") {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.Translate, contentDescription = null, tint = Brand.Accent)
                        Text("Titles in English", modifier = Modifier.weight(1f).padding(start = 16.dp))
                        Switch(
                            checked = profile.englishTitles,
                            enabled = !savingEnglish,
                            onCheckedChange = { on ->
                                scope.launch {
                                    savingEnglish = true
                                    runCatching { session.setEnglishTitles(on) }
                                    savingEnglish = false
                                }
                            },
                        )
                    }
                }

                if (!profile.isKids) {
                    Group(footer = "Signing in on an Apple TV, another phone or a browser? Choose Quick Login there, then scan its QR code or enter its code here.") {
                        LinkRow(Icons.Filled.QrCodeScanner, "Approve a Sign-In") { navigator.push(Screen.ApproveSignIn) }
                    }
                }

                Group(footer = "Send feedback or an app suggestion to your Streamulus admin, and read their replies.") {
                    LinkRow(Icons.Filled.Feedback, "Feedback", badge = unreadFeedback) { navigator.push(Screen.Feedback) }
                }
            }

            Group(title = "Server") {
                InfoRow(Icons.Filled.Dns, "Address", session.serverUrl?.toString() ?: "—")
                if (session.usingPublicAddress) {
                    Divider()
                    InfoRow(Icons.Filled.Public, "Away from home", "Using the public address")
                } else {
                    session.publicUrl?.let {
                        Divider()
                        InfoRow(Icons.Filled.Public, "Public address", it.toString())
                    }
                }
                Divider()
                TextButton(onClick = { confirmChangeServer = true }, modifier = Modifier.padding(horizontal = 6.dp)) {
                    Text("Change Server", color = MaterialTheme.colorScheme.error)
                }
            }

            Group {
                LinkRow(Icons.AutoMirrored.Filled.Logout, "Sign Out", tint = MaterialTheme.colorScheme.error) { session.signOut() }
            }

            Column(Modifier.padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                BrandMark(14.dp)
                Text("Version ${session.appVersion}", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmChangeServer) {
        AlertDialog(
            onDismissRequest = { confirmChangeServer = false },
            title = { Text("Change server?") },
            text = { Text("You'll be signed out and asked for a server address.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmChangeServer = false
                    session.changeServer()
                }) { Text("Change Server", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton(onClick = { confirmChangeServer = false }) { Text("Cancel") } },
        )
    }
}

/** A rounded group of rows, like an iOS settings section, with an optional title and footer. */
@Composable
fun Group(title: String? = null, footer: String? = null, content: @Composable () -> Unit) {
    Column(Modifier.widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (title != null) Text(title.uppercase(), style = MaterialTheme.typography.labelMedium, color = Brand.Secondary, modifier = Modifier.padding(start = 16.dp))
        Surface(shape = RoundedCornerShape(16.dp), color = Brand.Card) {
            Column { content() }
        }
        if (footer != null) Text(footer, style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, modifier = Modifier.padding(horizontal = 16.dp))
    }
}

@Composable
fun LinkRow(icon: ImageVector, text: String, badge: Int = 0, tint: Color = Brand.Accent, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 15.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = tint)
        Text(text, modifier = Modifier.weight(1f).padding(start = 16.dp), color = if (tint == Brand.Accent) Color.White else tint)
        if (badge > 0) Badge(containerColor = Brand.Accent, contentColor = Color.Black) { Text(badge.toString()) }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = Brand.Secondary, modifier = Modifier.size(22.dp))
    }
}

@Composable
private fun InfoRow(icon: ImageVector, label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = Brand.Secondary)
        Column(Modifier.padding(start = 16.dp)) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Text(value, style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
        }
    }
}

@Composable
private fun Divider() {
    HorizontalDivider(Modifier.padding(start = 56.dp), color = Color.White.copy(alpha = 0.06f))
}
