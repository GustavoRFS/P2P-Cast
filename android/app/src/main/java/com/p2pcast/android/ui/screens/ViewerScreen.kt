package com.p2pcast.android.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.VolumeOff
import androidx.compose.material.icons.filled.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.p2pcast.android.AppError
import com.p2pcast.android.StreamMode
import com.p2pcast.android.rtc.DisplayChatMessage
import com.p2pcast.android.rtc.RemoteMedia
import com.p2pcast.android.ui.components.ChatPanel
import com.p2pcast.android.ui.components.ChatToggleButton
import com.p2pcast.android.ui.components.ErrorCard
import com.p2pcast.android.ui.components.StatusPill
import com.p2pcast.android.ui.components.VideoRendererView
import org.webrtc.EglBase

@Composable
fun ViewerScreen(
    mode: StreamMode,
    inPictureInPictureMode: Boolean,
    supportsPictureInPicture: Boolean,
    error: AppError?,
    remoteScreen: RemoteMedia?,
    remoteCamera: RemoteMedia?,
    audioOn: Boolean,
    volume: Float,
    chatMessages: List<DisplayChatMessage>,
    chatReady: Boolean,
    chatSoundEnabled: Boolean,
    viewerName: String,
    eglBaseContext: EglBase.Context?,
    onToggleAudio: () -> Unit,
    onVolumeChange: (Float) -> Unit,
    onSendChat: (String) -> Unit,
    onToggleChatSound: () -> Unit,
    onNameChange: (String) -> Unit,
    onRetry: () -> Unit,
    onLeave: () -> Unit,
    onEnterPictureInPicture: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var chatOpen by remember { mutableStateOf(false) }
    var chatUnread by remember { mutableIntStateOf(0) }
    var lastSeenCount by remember { mutableIntStateOf(0) }

    LaunchedEffect(chatMessages.size, chatOpen) {
        if (chatOpen) {
            chatUnread = 0
            lastSeenCount = chatMessages.size
        } else if (chatMessages.size > lastSeenCount) {
            chatUnread += chatMessages.size - lastSeenCount
            lastSeenCount = chatMessages.size
        }
    }

    val primary = remoteScreen ?: remoteCamera
    Column(
        modifier
            .fillMaxSize()
            .padding(if (inPictureInPictureMode) 0.dp else 16.dp),
        verticalArrangement = if (inPictureInPictureMode) Arrangement.Center else Arrangement.spacedBy(14.dp),
    ) {
        if (!inPictureInPictureMode) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Você entrou na transmissão.", style = MaterialTheme.typography.headlineMedium)
                    Text(
                        "A imagem vem direto do aparelho do seu amigo.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.width(8.dp))
                StatusPill(mode)
            }
        }

        Box(
            (if (inPictureInPictureMode) {
                Modifier.fillMaxWidth().weight(1f)
            } else {
                Modifier.fillMaxWidth().aspectRatio(16f / 9f)
            }).background(
                if (inPictureInPictureMode) Color.Black else MaterialTheme.colorScheme.surfaceVariant,
                if (inPictureInPictureMode) androidx.compose.ui.graphics.RectangleShape else RoundedCornerShape(16.dp),
            ),
        ) {
            if (eglBaseContext != null && primary?.videoTrack != null) {
                VideoRendererView(eglBaseContext, primary.videoTrack, modifier = Modifier.fillMaxSize())
            } else if (mode != StreamMode.ERROR) {
                Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(Modifier.height(8.dp))
                    Text(
                        when (mode) {
                            StreamMode.CONNECTING -> "Conectando à transmissão…"
                            else -> "Aguardando vídeo…"
                        },
                    )
                }
            }

            if (!inPictureInPictureMode && remoteScreen?.videoTrack != null && remoteCamera?.videoTrack != null && eglBaseContext != null) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .padding(10.dp)
                        .height(100.dp)
                        .aspectRatio(9f / 16f)
                        .background(Color.Black, RoundedCornerShape(10.dp)),
                ) {
                    VideoRendererView(eglBaseContext, remoteCamera.videoTrack, modifier = Modifier.fillMaxSize())
                }
            }

            if (!inPictureInPictureMode && primary != null) {
                Row(
                    Modifier
                        .align(Alignment.TopEnd)
                        .padding(10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Slider(
                        value = volume,
                        onValueChange = onVolumeChange,
                        modifier = Modifier.width(120.dp),
                    )
                    IconButton(onClick = onToggleAudio) {
                        Icon(
                            if (audioOn) Icons.Filled.VolumeUp else Icons.Filled.VolumeOff,
                            contentDescription = if (audioOn) "Mutar áudio" else "Ativar áudio",
                        )
                    }
                    if (supportsPictureInPicture && primary.videoTrack != null) {
                        TextButton(onClick = onEnterPictureInPicture) {
                            Text("PIP")
                        }
                    }
                }
            }

            if (!inPictureInPictureMode) {
                ChatToggleButton(
                    open = chatOpen,
                    unreadCount = chatUnread,
                    onToggle = { chatOpen = !chatOpen },
                    modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
                )
            }
        }

        if (!inPictureInPictureMode && chatOpen) {
            ChatPanel(
                title = "Chat com quem está transmitindo",
                messages = chatMessages,
                soundEnabled = chatSoundEnabled,
                onSoundToggle = onToggleChatSound,
                onClose = { chatOpen = false },
                onSend = onSendChat,
                canSend = chatReady,
                nameValue = viewerName,
                onNameChange = onNameChange,
                emptyLabel = "Nenhuma mensagem ainda. Mande um oi.",
                modifier = Modifier.fillMaxWidth(),
            )
        }

        if (!inPictureInPictureMode) {
            error?.let {
                ErrorCard(error = it, onRetry = onRetry, onHome = onLeave)
            }

            Spacer(Modifier.height(4.dp))

            TextButton(onClick = onLeave, modifier = Modifier.fillMaxWidth()) {
                Text("Sair da sala ×")
            }
        }
    }
}
