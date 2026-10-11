package com.streamulus.android.ui.account

import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.streamulus.android.data.str
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.components.ErrorText
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.launch

/** The code from a Quick Login QR code — a link like http://server:8096/quick-login?code=ABC234 — or a bare code. */
fun quickLoginCode(text: String): String? {
    fun clean(value: String) = value.uppercase().filter { it.isLetterOrDigit() }
    val fromLink = runCatching { Uri.parse(text).getQueryParameter("code") }.getOrNull()
    val code = clean(fromLink ?: text)
    return code.takeIf { it.length == 6 }
}

/** Approve a Quick Login code shown on another device (TV, phone or browser): scan its QR code or type it. */
@Composable
fun ApproveSignInScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var code by rememberSaveable { mutableStateOf("") }
    var deviceName by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var approved by remember { mutableStateOf(false) }
    val normalized = code.uppercase().filter { it.isLetterOrDigit() }

    fun lookUp(value: String = normalized) {
        if (value.length < 6 || busy) return
        scope.launch {
            busy = true
            error = null
            attempt({ error = it }) {
                deviceName = session.getObject("/api/auth/quick/$value").str("deviceName") ?: "Device"
            }
            busy = false
        }
    }

    fun approve() {
        scope.launch {
            busy = true
            error = null
            attempt({ error = it }) {
                session.post("/api/auth/quick/$normalized/approve")
                approved = true
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            }
            busy = false
        }
    }

    fun scan() {
        error = null
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(context, options).startScan()
            .addOnSuccessListener { barcode ->
                val scanned = barcode.rawValue?.let(::quickLoginCode)
                if (scanned == null) {
                    error = "That QR code isn't a Streamulus sign-in code."
                } else {
                    code = scanned
                    deviceName = null
                    approved = false
                    lookUp(scanned)
                }
            }
            .addOnFailureListener { error = "Couldn't open the QR scanner. Type the code instead." }
            .addOnCanceledListener { }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Approve a Sign-In", onBack = { navigator.pop() })
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = LocalMetrics.current.margin),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Group(footer = "Point your camera at the QR code the TV or browser shows.") {
                LinkRow(Icons.Filled.QrCodeScanner, "Scan QR Code", onClick = ::scan)
            }

            Column(Modifier.widthIn(max = 720.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("OR TYPE THE CODE", style = MaterialTheme.typography.labelMedium, color = Brand.Secondary, modifier = Modifier.padding(start = 16.dp))
                OutlinedTextField(
                    value = code,
                    onValueChange = {
                        code = it
                        deviceName = null
                        error = null
                        approved = false
                    },
                    placeholder = { Text("ABC-234") },
                    singleLine = true,
                    textStyle = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 24.sp),
                    shape = RoundedCornerShape(14.dp),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters, autoCorrectEnabled = false, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { lookUp() }),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("On the TV or browser, choose Quick Login — it shows a QR code and a 6-character code.", style = MaterialTheme.typography.bodySmall, color = Brand.Secondary, modifier = Modifier.padding(horizontal = 16.dp))
            }

            ErrorText(error)

            val device = deviceName
            when {
                approved -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Brand.Success)
                    Text("${device ?: "The device"} is signing in now.", color = Brand.Success)
                }
                device != null -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Sign in $device as ${session.user?.username ?: "you"}?", style = MaterialTheme.typography.titleMedium)
                    Button(onClick = ::approve, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Approve")
                    }
                }
                else -> Button(onClick = { lookUp() }, enabled = normalized.length >= 6 && !busy, modifier = Modifier.fillMaxWidth()) {
                    if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Text("Continue")
                }
            }
        }
    }
}
