package com.streamulus.android.ui.signin

import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.QrCode2
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.streamulus.android.data.ApiException
import com.streamulus.android.data.Fmt
import com.streamulus.android.data.QuickStart
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.components.AppTextField
import com.streamulus.android.ui.components.BrandMark
import com.streamulus.android.ui.components.ErrorText
import com.streamulus.android.ui.components.FormPage
import com.streamulus.android.ui.components.openInAppBrowser
import com.streamulus.android.ui.components.QrCode
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.components.userMessage
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// ── Server ───────────────────────────────────────────────────────────────────

@Composable
fun ServerSetupScreen() {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var address by rememberSaveable { mutableStateOf("") }
    var connecting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun connect() {
        if (address.isBlank() || connecting) return
        scope.launch {
            connecting = true
            error = null
            attempt({ error = "Couldn't reach a Streamulus server there. $it" }) { session.setServer(address) }
            connecting = false
        }
    }

    FormPage(maxWidth = 520.dp) {
        BrandMark(30.dp)
        Text("Connect to your Streamulus server", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(
            "At home, use the address you open in your browser, e.g. 192.168.1.20:8096. Away from home, use the server's public address, e.g. https://streamulus.your-tailnet.ts.net.",
            color = Brand.Secondary, textAlign = TextAlign.Center,
        )
        AppTextField(address, { address = it }, "Server address", keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, onDone = ::connect)
        ErrorText(error)
        Button(onClick = ::connect, enabled = address.isNotBlank() && !connecting, modifier = Modifier.fillMaxWidth()) {
            if (connecting) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Connect")
        }
        Text(
            "Once you've connected at home, the app also learns the server's public address (if the admin has set one) and switches to it by itself when you're out.",
            style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, textAlign = TextAlign.Center,
        )
    }
}

// ── Sign in ──────────────────────────────────────────────────────────────────

private enum class Mode { Password, QuickLogin, Create }

@Composable
fun SignInScreen() {
    var mode by rememberSaveable { mutableStateOf(Mode.Password) }
    var username by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    /** A new account's first sign-in needs the Admin Passphrase: why, and whether it was just made. */
    var passphraseNote by rememberSaveable { mutableStateOf<String?>(null) }
    var justCreated by rememberSaveable { mutableStateOf(false) }

    when (mode) {
        Mode.QuickLogin -> QuickLoginRequest(onCancel = { mode = Mode.Password })
        Mode.Create -> CreateAccount(
            onCancel = { mode = Mode.Password },
            onCreated = { name, newPassword, message ->
                username = name
                password = newPassword
                passphraseNote = message
                justCreated = true
                mode = Mode.Password
            },
        )
        Mode.Password -> PasswordSignIn(
            username = username, onUsername = { username = it },
            password = password, onPassword = { password = it },
            passphraseNote = passphraseNote, onPassphraseNote = { passphraseNote = it },
            justCreated = justCreated, onJustCreated = { justCreated = it },
            onQuickLogin = { mode = Mode.QuickLogin },
            onCreate = { mode = Mode.Create },
        )
    }
}

@Composable
private fun PasswordSignIn(
    username: String, onUsername: (String) -> Unit,
    password: String, onPassword: (String) -> Unit,
    passphraseNote: String?, onPassphraseNote: (String?) -> Unit,
    justCreated: Boolean, onJustCreated: (Boolean) -> Unit,
    onQuickLogin: () -> Unit,
    onCreate: () -> Unit,
) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var passphrase by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val ready = username.isNotBlank() && password.isNotEmpty() && (passphraseNote == null || passphrase.isNotBlank())

    fun signIn() {
        if (!ready || busy) return
        scope.launch {
            busy = true
            error = null
            try {
                session.login(username.trim(), password, if (passphraseNote == null) null else passphrase.trim())
            } catch (e: ApiException) {
                if (e.isPassphraseError) {
                    // First sign-in of a new account: ask for (or retry) the Admin Passphrase.
                    if (passphraseNote == null || e.code == "PASSPHRASE_REQUIRED") onPassphraseNote(e.message) else error = e.message
                } else {
                    error = e.message
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = e.userMessage()
            }
            busy = false
        }
    }

    FormPage {
        BrandMark(30.dp)
        Text(if (passphraseNote == null) "Sign in" else "One more step", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)

        if (passphraseNote != null) {
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Brand.Accent.copy(alpha = 0.12f)).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                if (justCreated) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Brand.Success, modifier = Modifier.size(18.dp))
                        Text("Account created", fontWeight = FontWeight.Bold, color = Brand.Success)
                    }
                }
                Text(passphraseNote, style = MaterialTheme.typography.bodyMedium)
            }
        }

        AppTextField(username, onUsername, "Username", enabled = !justCreated)
        AppTextField(password, onPassword, "Password", password = true,
            imeAction = if (passphraseNote == null) ImeAction.Go else ImeAction.Next,
            onDone = if (passphraseNote == null) ::signIn else null)
        if (passphraseNote == null) {
            // The website's Forgot Password page, in the in-app browser (the reset email links there too).
            val context = LocalContext.current
            val uriHandler = LocalUriHandler.current
            session.websiteUrl("/forgot-password")?.let { url ->
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
                    TextButton(onClick = { if (!openInAppBrowser(context, url)) runCatching { uriHandler.openUri(url) } }) { Text("Forgot password?") }
                }
            }
        }
        if (passphraseNote != null) {
            AppTextField(passphrase, { passphrase = it }, "Admin Passphrase", placeholder = "e.g. maple-river-otter-comet",
                imeAction = ImeAction.Go, onDone = ::signIn)
        }
        ErrorText(error)
        Button(onClick = ::signIn, enabled = ready && !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else Text(if (passphraseNote == null) "Sign In" else "Activate & Sign In")
        }

        if (passphraseNote != null) {
            TextButton(onClick = {
                onPassphraseNote(null)
                onJustCreated(false)
                passphrase = ""
                error = null
            }) { Text("Back to sign in") }
        } else {
            FilledTonalButton(onClick = onQuickLogin, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.QrCode2, contentDescription = null)
                Text("  Quick Login with a code")
            }
            OutlinedButton(onClick = onCreate, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Filled.PersonAdd, contentDescription = null)
                Text("  Create Account")
            }
        }
        TextButton(onClick = { session.changeServer() }) {
            Text("Change Server · ${session.serverUrl?.host ?: ""}", style = MaterialTheme.typography.bodySmall)
        }
    }
}

/** Create an account: a display name (also the sign-in name) and a password. */
@Composable
private fun CreateAccount(onCancel: () -> Unit, onCreated: (String, String, String) -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val ready = name.isNotBlank() && password.isNotEmpty() && confirm.isNotEmpty() && email.isNotBlank()

    fun create() {
        if (!ready || busy) return
        if (password != confirm) {
            error = "The passwords don't match."
            return
        }
        scope.launch {
            busy = true
            error = null
            attempt({ error = it }) {
                val (created, message) = session.register(name.trim(), password, email.trim())
                onCreated(created, password, message)
            }
            busy = false
        }
    }

    FormPage {
        BrandMark(30.dp)
        Text("Create Account", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        AppTextField(name, { name = it }, "Display name", capitalization = KeyboardCapitalization.Words)
        Text("You'll sign in with your display name.", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, modifier = Modifier.fillMaxWidth())
        AppTextField(password, { password = it }, "Password (at least 6 characters)", password = true)
        AppTextField(confirm, { confirm = it }, "Confirm password", password = true)
        AppTextField(email, { email = it }, "Email address", keyboardType = KeyboardType.Email, imeAction = ImeAction.Go, onDone = ::create)
        Text("Your email lets you reset your password if you forget it.", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, modifier = Modifier.fillMaxWidth())
        ErrorText(error)
        Button(onClick = ::create, enabled = ready && !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Create Account")
        }
        Text(
            "New accounts need an Admin Passphrase from your Streamulus admin before the first sign-in. It usually takes 5–10 minutes to get one.",
            style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, textAlign = TextAlign.Center,
        )
        TextButton(onClick = onCancel) { Text("Already have an account? Sign in") }
    }
}

/** Sign this device in by approving a code on a device that's already signed in. */
@Composable
private fun QuickLoginRequest(onCancel: () -> Unit) {
    val session = LocalSession.current
    val context = LocalContext.current
    var attemptNumber by remember { mutableIntStateOf(0) }
    var request by remember { mutableStateOf<QuickStart?>(null) }
    var expiresAt by remember { mutableLongStateOf(0L) }
    var expired by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }

    LaunchedEffect(attemptNumber) {
        request = null
        expired = false
        error = null
        val started = attempt({ error = it }) { session.quickLoginStart() } ?: return@LaunchedEffect
        request = started
        expiresAt = System.currentTimeMillis() + started.expiresIn * 1000L
        while (!expired) {
            delay(maxOf(2, started.interval) * 1000L)
            try {
                val signIn = session.quickLoginPoll(started.requestId)
                if (signIn != null) {
                    session.completeSignIn(signIn)
                    return@LaunchedEffect
                }
            } catch (e: ApiException) {
                if (e.status == 410) expired = true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // Network blip — keep waiting.
            }
        }
    }
    LaunchedEffect(request) {
        while (request != null) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }

    FormPage(maxWidth = 520.dp) {
        BrandMark(26.dp)
        Text("Quick Login", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(
            "On a device that's signed in — Streamulus in a browser, or this app on another phone or tablet (Profile & Settings › Approve a Sign-In) — scan this or enter the code:",
            color = Brand.Secondary, textAlign = TextAlign.Center,
        )
        val current = request
        when {
            current != null && !expired -> {
                val link = session.quickLoginLink(current.code)
                QrCode(link, Modifier.size(196.dp).clip(RoundedCornerShape(18.dp)).background(androidx.compose.ui.graphics.Color.White).padding(10.dp))
                Text(
                    Fmt.code(current.code),
                    fontSize = 44.sp, fontWeight = FontWeight.Black, fontFamily = FontFamily.Monospace, color = Brand.Accent,
                    modifier = Modifier.clip(RoundedCornerShape(20.dp)).background(Brand.Card).padding(horizontal = 24.dp, vertical = 12.dp),
                )
                val left = maxOf(0L, (expiresAt - now) / 1000)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                    Text("Waiting for approval · ${left / 60}:${(left % 60).toString().padStart(2, '0')}", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary)
                }
                OutlinedButton(onClick = {
                    val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, link)
                    context.startActivity(Intent.createChooser(send, "Send the approval link"))
                }) {
                    Icon(Icons.Filled.Share, contentDescription = null)
                    Text("  Send the approval link")
                }
            }
            expired -> {
                Text("That code expired.")
                Button(onClick = { attemptNumber++ }) { Text("Get a New Code") }
            }
            error != null -> {
                ErrorText(error)
                Button(onClick = { attemptNumber++ }) { Text("Try Again") }
            }
            else -> CircularProgressIndicator()
        }
        TextButton(onClick = onCancel) { Text("Sign in with a password instead") }
    }
}
