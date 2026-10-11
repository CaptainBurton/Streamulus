package com.streamulus.android.ui.account

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.streamulus.android.data.AvatarCategory
import com.streamulus.android.data.AvatarChoice
import com.streamulus.android.ui.LocalNavigator
import com.streamulus.android.ui.LocalSession
import com.streamulus.android.ui.components.ErrorText
import com.streamulus.android.ui.components.ListStatus
import com.streamulus.android.ui.components.LocalMetrics
import com.streamulus.android.ui.components.TopBar
import com.streamulus.android.ui.components.attempt
import com.streamulus.android.ui.theme.Brand
import kotlinx.coroutines.launch

/**
 * Choose one of the profile pictures the admin provides (Admin › Profile Pictures
 * on the web). Only pictures meant for this profile — Streamer or Streamling — are
 * offered; it's how Streamlings change their picture.
 */
@Composable
fun AvatarPickerScreen() {
    val session = LocalSession.current
    val navigator = LocalNavigator.current
    val m = LocalMetrics.current
    val scope = rememberCoroutineScope()
    var categories by remember { mutableStateOf<List<AvatarCategory>?>(null) }
    var currentId by remember { mutableStateOf<Int?>(null) }
    var shownCategory by remember { mutableStateOf<Int?>(null) } // null = all
    var busyId by remember { mutableStateOf<Int?>(null) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        attempt({ error = it; categories = emptyList() }) {
            val (loaded, current) = session.avatarChoices()
            categories = loaded
            currentId = current
        }
    }

    fun pick(image: AvatarChoice) {
        if (busyId != null) return
        scope.launch {
            busyId = image.id
            error = null
            attempt({ error = it }) {
                session.chooseAvatar(image.id)
                currentId = image.id
                navigator.pop()
            }
            busyId = null
        }
    }

    val size = if (m.wide) 100.dp else 78.dp
    val all = categories ?: emptyList()
    Column(Modifier.fillMaxSize()) {
        TopBar("Choose a Picture", onBack = { navigator.pop() })
        if (all.size > 1) {
            LazyRow(contentPadding = PaddingValues(horizontal = m.margin), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item { FilterChip(selected = shownCategory == null, onClick = { shownCategory = null }, label = { Text("All") }) }
                items(all, key = { it.id }) { category ->
                    FilterChip(selected = shownCategory == category.id, onClick = { shownCategory = category.id }, label = { Text(category.name) })
                }
            }
        }
        ErrorText(error)
        Box(Modifier.weight(1f)) {
            LazyVerticalGrid(
                columns = GridCells.Adaptive(size + 12.dp),
                contentPadding = PaddingValues(start = m.margin, end = m.margin, top = 12.dp, bottom = 24.dp),
                horizontalArrangement = Arrangement.spacedBy(14.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                all.filter { shownCategory == null || it.id == shownCategory }.forEach { category ->
                    item(key = "c${category.id}", span = { GridItemSpan(maxLineSpan) }) {
                        Text(category.name.uppercase(), style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, color = Brand.Secondary, modifier = Modifier.padding(top = 8.dp))
                    }
                    items(category.images, key = { "i${it.id}" }) { image ->
                        val current = image.id == currentId
                        Box(
                            Modifier.fillMaxWidth().aspectRatio(1f)
                                .alpha(if (busyId != null && busyId != image.id) 0.5f else 1f)
                                .clip(CircleShape)
                                .background(Color.White.copy(alpha = 0.08f))
                                .then(if (current) Modifier.border(3.dp, Brand.Accent, CircleShape) else Modifier)
                                .clickable { pick(image) },
                            contentAlignment = Alignment.Center,
                        ) {
                            AsyncImage(model = session.imageUrl(image.url), contentDescription = if (current) "Current picture" else "Profile picture", modifier = Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
                            if (busyId == image.id) CircularProgressIndicator(Modifier.size(28.dp), color = Color.White)
                            if (current) {
                                Icon(Icons.Filled.CheckCircle, contentDescription = null, tint = Brand.Accent, modifier = Modifier.align(Alignment.BottomEnd).size(26.dp).background(Color.Black, CircleShape))
                            }
                        }
                    }
                }
            }
            ListStatus(
                loading = categories == null,
                error = null,
                isEmpty = all.isEmpty(),
                emptyText = "No pictures yet — your Streamulus admin can add profile pictures in Admin › Profile Pictures on the web.",
            )
        }
    }
}
