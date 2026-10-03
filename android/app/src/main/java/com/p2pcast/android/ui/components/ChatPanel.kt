package com.p2pcast.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.p2pcast.android.chat.CHAT_MAX_MESSAGE_LENGTH
import com.p2pcast.android.chat.formatMessageTime
import com.p2pcast.android.rtc.DisplayChatMessage

@Composable
fun ChatToggleButton(
    open: Boolean,
    unreadCount: Int,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(modifier) {
        FloatingActionButton(onClick = onToggle) {
            Icon(
                if (open) Icons.Filled.Close else androidx.compose.material.icons.Icons.AutoMirrored.Filled.Send,
                contentDescription = if (open) "Fechar chat" else "Abrir chat",
            )
        }
        if (!open && unreadCount > 0) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .size(18.dp)
                    .background(MaterialTheme.colorScheme.error, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    if (unreadCount > 9) "9+" else unreadCount.toString(),
                    color = Color.White,
                    style = MaterialTheme.typography.labelLarge,
                )
            }
        }
    }
}

@Composable
fun ChatPanel(
    title: String,
    messages: List<DisplayChatMessage>,
    soundEnabled: Boolean,
    onSoundToggle: () -> Unit,
    onClose: () -> Unit,
    onSend: (String) -> Unit,
    canSend: Boolean,
    nameValue: String? = null,
    onNameChange: ((String) -> Unit)? = null,
    emptyLabel: String,
    modifier: Modifier = Modifier,
) {
    var draft by remember { mutableStateOf("") }
    val listState = rememberLazyListState()

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    Card(modifier = modifier, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(12.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(title, style = MaterialTheme.typography.titleMedium)
                Row {
                    IconButton(onClick = onSoundToggle) {
                        Icon(
                            if (soundEnabled) Icons.Filled.Notifications else Icons.Filled.NotificationsOff,
                            contentDescription = if (soundEnabled) "Desativar sons do chat" else "Ativar sons do chat",
                        )
                    }
                    IconButton(onClick = onClose) {
                        Icon(Icons.Filled.Close, contentDescription = "Fechar chat")
                    }
                }
            }

            if (onNameChange != null) {
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(
                    value = nameValue ?: "",
                    onValueChange = onNameChange,
                    label = { Text("Seu nome (opcional)") },
                    placeholder = { Text("Espectador") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }

            Spacer(Modifier.height(8.dp))

            Box(Modifier.fillMaxWidth().height(220.dp)) {
                if (messages.isEmpty()) {
                    Text(
                        emptyLabel,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.align(Alignment.Center),
                    )
                } else {
                    LazyColumn(state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(messages, key = { it.message.id }) { entry ->
                            ChatBubble(entry)
                        }
                    }
                }
            }

            Spacer(Modifier.height(8.dp))

            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { if (it.length <= CHAT_MAX_MESSAGE_LENGTH) draft = it },
                    placeholder = { Text(if (canSend) "Escreva uma mensagem…" else "Conectando ao chat…") },
                    enabled = canSend,
                    singleLine = true,
                    modifier = Modifier.weight(1f).width(IntrinsicSize.Min),
                )
                IconButton(
                    onClick = {
                        val text = draft.trim()
                        if (text.isNotEmpty() && canSend) {
                            onSend(text)
                            draft = ""
                        }
                    },
                    enabled = canSend && draft.isNotBlank(),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Enviar mensagem")
                }
            }
        }
    }
}

@Composable
private fun ChatBubble(entry: DisplayChatMessage) {
    val message = entry.message
    val bubbleColor = when {
        entry.isSelf -> MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)
        message.isBroadcaster -> MaterialTheme.colorScheme.secondary.copy(alpha = 0.18f)
        else -> MaterialTheme.colorScheme.surfaceVariant
    }

    Column(
        Modifier
            .fillMaxWidth()
            .background(bubbleColor, RoundedCornerShape(10.dp))
            .padding(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(
                if (entry.isSelf) "Você" else message.authorName,
                style = MaterialTheme.typography.labelLarge,
            )
            Text(
                formatMessageTime(message.timestamp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.height(2.dp))
        Text(message.text, style = MaterialTheme.typography.bodyLarge)
    }
}
