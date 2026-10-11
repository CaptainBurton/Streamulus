package com.streamulus.android.ui.signin

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.streamulus.android.data.ApiException
import com.streamulus.android.data.Profile
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.components.AppTextField
import com.streamulus.android.ui.components.BrandMark
import com.streamulus.android.ui.components.ErrorText
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.ProfileAvatar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.components.userMessage
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/** What switching to a profile needs: its PIN, or the account password (parental lock). */
private data class Prompt(val profile: Profile, val kind: String)

/** "Who's watching?" — Streamlings get their own section beneath everyone else's profiles. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ProfilePickerScreen() {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    val avatar = if (LocalMetrics.current.wide) 140.dp else 100.dp
    var profiles by remember { mutableStateOf<List<Profile>>(emptyList()) }
    var prompt by remember { mutableStateOf<Prompt?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        attempt({ error = it }) { profiles = session.profiles() }
    }

    fun choose(profile: Profile, pin: String? = null, password: String? = null) {
        scope.launch {
            try {
                session.selectProfile(profile, pin, password)
                prompt = null
            } catch (e: ApiException) {
                // The server says what it needs — switch to that prompt.
                if (e.code == "PIN_REQUIRED") prompt = Prompt(profile, "pin")
                if (e.code == "PASSWORD_REQUIRED") prompt = Prompt(profile, "password")
                error = e.message
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.userMessage()
            }
        }
    }

    Box(Modifier.fillMaxSize().safeDrawingPadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(26.dp),
        ) {
            BrandMark(24.dp, Modifier.padding(top = 32.dp))
            Text("Who's watching?", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
            if (prompt == null) ErrorText(error)

            ProfileGrid(profiles.filter { !it.isKids }, avatar) { p ->
                if (p.requires != null) {
                    error = null
                    prompt = Prompt(p, p.requires)
                } else {
                    choose(p)
                }
            }
            val streamlings = profiles.filter { it.isKids }
            if (streamlings.isNotEmpty()) {
                Text("STREAMLINGS", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Black, color = Brand.Streamling, modifier = Modifier.padding(top = 6.dp))
                ProfileGrid(streamlings, avatar) { p ->
                    if (p.requires != null) {
                        error = null
                        prompt = Prompt(p, p.requires)
                    } else {
                        choose(p)
                    }
                }
            }
            OutlinedButton(onClick = { session.signOut() }) { Text("Sign Out") }
        }
    }

    prompt?.let { current ->
        UnlockDialog(
            prompt = current,
            error = error,
            onSubmit = { secret -> if (current.kind == "pin") choose(current.profile, pin = secret) else choose(current.profile, password = secret) },
            onDismiss = {
                prompt = null
                error = null
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ProfileGrid(profiles: List<Profile>, avatar: Dp, onChoose: (Profile) -> Unit) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(24.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        profiles.forEach { profile ->
            Column(
                Modifier.width(avatar + 20.dp).clip(RoundedCornerShape(16.dp)).clickable { onChoose(profile) }.padding(vertical = 6.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box {
                    ProfileAvatar(profile, avatar)
                    if (profile.requires != null) {
                        Box(
                            Modifier.align(Alignment.TopEnd).size(30.dp).clip(CircleShape).background(Brand.Card),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(Icons.Filled.Lock, contentDescription = "Locked", modifier = Modifier.size(15.dp))
                        }
                    }
                }
                Text(profile.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable
private fun UnlockDialog(prompt: Prompt, error: String?, onSubmit: (String) -> Unit, onDismiss: () -> Unit) {
    var secret by remember(prompt) { mutableStateOf("") }
    val isPin = prompt.kind == "pin"
    val ready = if (isPin) secret.length == 4 else secret.isNotEmpty()
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { ProfileAvatar(prompt.profile, 64.dp) },
        title = { Text(if (isPin) "Enter PIN for ${prompt.profile.name}" else "Enter your password to switch to ${prompt.profile.name}", textAlign = TextAlign.Center) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                AppTextField(
                    value = secret,
                    onValueChange = { secret = if (isPin) it.filter(Char::isDigit).take(4) else it },
                    label = if (isPin) "4-digit PIN" else "Account password",
                    password = true,
                    keyboardType = if (isPin) KeyboardType.NumberPassword else KeyboardType.Password,
                    imeAction = ImeAction.Go,
                    onDone = { if (ready) onSubmit(secret) },
                )
                ErrorText(error)
            }
        },
        confirmButton = { TextButton(onClick = { onSubmit(secret) }, enabled = ready) { Text("Continue") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
