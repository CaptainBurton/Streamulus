package com.streamulus.android.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.streamulus.android.data.FeedbackItem
import com.streamulus.android.data.FeedbackMessage
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.Screen
import com.streamulus.android.ui.components.ErrorText
import com.streamulus.android.ui.components.ListStatus
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

/**
 * Profile & Settings › Feedback: send feedback or an app suggestion to the server's
 * admin, and read and answer their replies (Admin › Feedback on the web).
 */
@Composable
fun FeedbackScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    var items by remember { mutableStateOf<List<FeedbackItem>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var composing by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        attempt({ error = it; items = emptyList() }) { items = session.feedback() }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Feedback", onBack = { navigator.pop() })
        Box(Modifier.weight(1f)) {
            LazyColumn(
                contentPadding = PaddingValues(start = m.margin, end = m.margin, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                item {
                    Group(footer = "Tell your Streamulus admin what you think, report something that isn't working, or suggest something for the apps. Their replies show up here.") {
                        LinkRow(Icons.Filled.Edit, "Send Feedback or a Suggestion") { composing = true }
                    }
                }
                item { ErrorText(error) }
                val list = items ?: emptyList()
                if (list.isNotEmpty()) {
                    item { Text("YOUR MESSAGES", style = MaterialTheme.typography.labelMedium, color = Brand.Secondary, modifier = Modifier.padding(start = 16.dp, top = 8.dp)) }
                    items(list, key = { it.id }) { item ->
                        FeedbackRow(item) { navigator.push(Screen.FeedbackThread(item.id)) }
                    }
                } else if (items != null && error == null) {
                    item { Text("Nothing yet — anything you send appears here, with the admin's replies.", color = Brand.Secondary, modifier = Modifier.padding(16.dp)) }
                }
            }
            if (items == null) ListStatus(loading = true, error = null, isEmpty = true, emptyText = "")
        }
    }

    if (composing) {
        FeedbackComposer(
            onDismiss = { composing = false },
            onSent = { sent ->
                composing = false
                items = listOf(sent) + (items ?: emptyList())
            },
        )
    }
}

@Composable
private fun FeedbackRow(item: FeedbackItem, onClick: () -> Unit) {
    Surface(shape = RoundedCornerShape(16.dp), color = Brand.Card, modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
        Row(Modifier.clickable(onClick = onClick).padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.padding(top = 6.dp).size(9.dp).clip(CircleShape).background(if (item.unread) Brand.Accent else Color.Transparent))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(item.kindLabel, style = MaterialTheme.typography.titleSmall)
                    StatusLabel(item)
                    Spacer(Modifier.weight(1f))
                    Text(shortDate(item.updatedAt), style = MaterialTheme.typography.labelSmall, color = Brand.Secondary)
                }
                Text(item.preview, style = MaterialTheme.typography.bodyMedium, color = Brand.Secondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (item.unread) Text("New reply", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Brand.Accent)
            }
        }
    }
}

@Composable
private fun StatusLabel(item: FeedbackItem) {
    val color = when (item.status) {
        "answered" -> Brand.Success
        "closed" -> Brand.Secondary
        else -> Brand.Streamling
    }
    Text(
        item.statusLabel,
        style = MaterialTheme.typography.labelSmall,
        fontWeight = FontWeight.Bold,
        color = color,
        modifier = Modifier.border(1.dp, color.copy(alpha = 0.45f), CircleShape).padding(horizontal = 7.dp, vertical = 2.dp),
    )
}

/** Write new feedback or an app suggestion. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FeedbackComposer(onDismiss: () -> Unit, onSent: (FeedbackItem) -> Unit) {
    val session = LocalSession.current
    val scope = rememberCoroutineScope()
    var kind by rememberSaveable { mutableStateOf("feedback") }
    var message by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val ready = message.isNotBlank() && message.length <= 4000 && !busy

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text(if (kind == "suggestion") "App Suggestion" else "Feedback") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    listOf("feedback" to "Feedback", "suggestion" to "App Suggestion").forEachIndexed { index, (value, label) ->
                        SegmentedButton(selected = kind == value, onClick = { kind = value }, shape = SegmentedButtonDefaults.itemShape(index, 2)) {
                            Text(label, maxLines = 1)
                        }
                    }
                }
                OutlinedTextField(
                    value = message,
                    onValueChange = { message = it.take(4000) },
                    placeholder = { Text(if (kind == "suggestion") "What would make Streamulus better?" else "What's on your mind? If something isn't working, say what you were doing.") },
                    minLines = 5,
                    maxLines = 12,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                Text("${message.length}/4000", style = MaterialTheme.typography.labelSmall, color = Brand.Secondary)
                ErrorText(error)
            }
        },
        confirmButton = {
            TextButton(enabled = ready, onClick = {
                scope.launch {
                    busy = true
                    error = null
                    attempt({ error = it }) {
                        session.sendFeedback(kind, message.trim())?.let(onSent)
                    }
                    busy = false
                }
            }) { if (busy) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Send") }
        },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text("Cancel") } },
    )
}

/** One conversation as chat bubbles, with a reply bar. */
@Composable
fun FeedbackThreadScreen(id: Int) {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    var item by remember { mutableStateOf<FeedbackItem?>(null) }
    var reply by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(id) {
        attempt({ error = it }) {
            val found = session.feedback().firstOrNull { it.id == id }
            item = found
            if (found?.unread == true) session.markFeedbackRead(id)
        }
    }
    LaunchedEffect(item?.messages?.size) {
        val count = item?.messages?.size ?: 0
        if (count > 0) listState.animateScrollToItem(count)
    }

    val current = item
    Column(Modifier.fillMaxSize().imePadding()) {
        TopBar(current?.kindLabel ?: "Feedback", onBack = { navigator.pop() })
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.weight(1f).fillMaxWidth(),
        ) {
            if (current != null) {
                item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) { StatusLabel(current) } }
                items(current.messages, key = { it.id }) { message -> Bubble(message) }
            }
            item { ErrorText(error) }
        }
        Row(
            Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            OutlinedTextField(
                value = reply,
                onValueChange = { reply = it.take(4000) },
                placeholder = { Text(if (current?.status == "closed") "Reply to open this again…" else "Reply…") },
                maxLines = 5,
                shape = RoundedCornerShape(22.dp),
                modifier = Modifier.weight(1f),
            )
            FilledIconButton(
                onClick = {
                    scope.launch {
                        busy = true
                        error = null
                        attempt({ error = it }) {
                            session.replyToFeedback(id, reply.trim())?.let { item = it }
                            reply = ""
                        }
                        busy = false
                    }
                },
                enabled = !busy && reply.isNotBlank() && current != null,
                modifier = Modifier.size(52.dp),
            ) {
                if (busy) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp) else Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send reply")
            }
        }
    }
}

@Composable
private fun Bubble(message: FeedbackMessage) {
    val mine = !message.fromAdmin
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (mine) Alignment.End else Alignment.Start) {
        Text(
            message.body,
            modifier = Modifier.padding(start = if (mine) 48.dp else 0.dp, end = if (mine) 0.dp else 48.dp)
                .clip(RoundedCornerShape(18.dp))
                .background(if (mine) Brand.Accent.copy(alpha = 0.22f) else Color.White.copy(alpha = 0.08f))
                .padding(horizontal = 14.dp, vertical = 10.dp),
        )
        Text(
            (if (message.fromAdmin) "${message.author ?: "Admin"} (admin)" else message.author ?: "You") + " · " + shortDate(message.createdAt),
            style = MaterialTheme.typography.labelSmall,
            color = Brand.Secondary,
            modifier = Modifier.padding(top = 4.dp, start = 4.dp, end = 4.dp),
        )
    }
}

private fun shortDate(ms: Long): String =
    DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(ms))
