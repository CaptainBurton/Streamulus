package com.streamulus.android.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.streamulus.android.data.ApiException
import kotlinx.coroutines.CancellationException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** A message people can act on, for any error from a request. */
fun Throwable.userMessage(): String = when (this) {
    is ApiException -> message
    is UnknownHostException -> "Can't find that server — check the address."
    is ConnectException -> "The server isn't answering."
    is SocketTimeoutException -> "The server took too long to answer."
    else -> localizedMessage ?: "Something went wrong."
}

/** Runs `block`; on failure (other than cancellation) passes a readable message to `onError`. */
inline fun <T> attempt(onError: (String) -> Unit, block: () -> T): T? = try {
    block()
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    onError(e.userMessage())
    null
}

/** A centred, scrolling column for sign-in style pages (keeps clear of the keyboard). */
@Composable
fun FormPage(maxWidth: Dp = 460.dp, content: @Composable ColumnScope.() -> Unit) {
    Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.TopCenter) {
        Column(
            Modifier.widthIn(max = maxWidth).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
            content = content,
        )
    }
}

@Composable
fun AppTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    capitalization: KeyboardCapitalization = KeyboardCapitalization.None,
    imeAction: ImeAction = ImeAction.Next,
    onDone: (() -> Unit)? = null,
    enabled: Boolean = true,
    singleLine: Boolean = true,
    minLines: Int = 1,
    placeholder: String? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = placeholder?.let { { Text(it) } },
        modifier = modifier.fillMaxWidth(),
        enabled = enabled,
        singleLine = singleLine,
        minLines = minLines,
        shape = RoundedCornerShape(14.dp),
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(
            capitalization = capitalization,
            autoCorrectEnabled = false,
            keyboardType = if (password && keyboardType == KeyboardType.Text) KeyboardType.Password else keyboardType,
            imeAction = imeAction,
        ),
        // Without an action, Next moves to the following field as usual.
        keyboardActions = if (onDone != null) KeyboardActions(onAny = { onDone() }) else KeyboardActions.Default,
    )
}

@Composable
fun ErrorText(text: String?) {
    if (text != null) {
        Text(text, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
    }
}
