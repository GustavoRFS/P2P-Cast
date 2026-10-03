package com.p2pcast.android.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
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
import androidx.compose.material.icons.filled.Cameraswitch
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.p2pcast.android.AppError
import com.p2pcast.android.StreamMode
import com.p2pcast.android.capture.CaptureSettings
import com.p2pcast.android.capture.CaptureSource
import com.p2pcast.android.capture.formatCaptureSettings
import com.p2pcast.android.rtc.DisplayChatMessage
import com.p2pcast.android.ui.components.ChatPanel
import com.p2pcast.android.ui.components.ChatToggleButton
import com.p2pcast.android.ui.components.ErrorCard
import com.p2pcast.android.ui.components.StatusPill
import com.p2pcast.android.ui.components.VideoRendererView
import org.webrtc.EglBase
import org.webrtc.VideoTrack

@Composable
fun BroadcastScreen(
    mode: StreamMode,
    error: AppError?,
    shareUrl: String?,
    viewerCount: Int,
    captureSettings: CaptureSettings,
    localScreenTrack: VideoTrack?,
    localCameraTrack: VideoTrack?,
    audioMuted: Boolean,
    chatMessages: List<DisplayChatMessage>,
    chatSoundEnabled: Boolean,
    eglBaseContext: EglBase.Context?,
    onToggleAudioMute: () -> Unit,
    onFlipCamera: () -> Unit,
    onStop: () -> Unit,
    onSendChat: (String) -> Unit,
    onToggleChatSound: () -> Unit,
    onRetry: () -> Unit,
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

    val context = LocalContext.current

    Column(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Sua transmissão", style = MaterialTheme.typography.headlineMedium)
                Text(
                    "prévia local · ${formatCaptureSettings(captureSettings)}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.width(8.dp))
            StatusPill(mode)
        }

        Text("$viewerCount ${if (viewerCount == 1) "pessoa assistindo" else "pessoas assistindo"}")

        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(16f / 9f)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(16.dp)),
        ) {
            val primaryTrack = localScreenTrack ?: localCameraTrack
            if (eglBaseContext != null && primaryTrack != null) {
                VideoRendererView(
                    eglBaseContext = eglBaseContext,
                    videoTrack = primaryTrack,
                    mirror = primaryTrack === localCameraTrack && captureSettings.cameraFacing.name == "USER",
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                Text(
                    "Aguardando o compartilhamento…",
                    modifier = Modifier.align(Alignment.Center),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (localScreenTrack != null && localCameraTrack != null && eglBaseContext != null) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .padding(10.dp)
                        .height(100.dp)
                        .aspectRatio(9f / 16f)
                        .background(Color.Black, RoundedCornerShape(10.dp)),
                ) {
                    VideoRendererView(eglBaseContext, localCameraTrack, mirror = true, modifier = Modifier.fillMaxSize())
                }
            }

            Row(
                Modifier.align(Alignment.TopStart).padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (captureSettings.source != CaptureSource.SCREEN) {
                    FilledIconAction(icon = Icons.Filled.Cameraswitch, contentDescription = "Inverter câmera", onClick = onFlipCamera)
                }
                FilledIconAction(
                    icon = if (audioMuted) Icons.Filled.MicOff else Icons.Filled.Mic,
                    contentDescription = if (audioMuted) "Ativar áudio" else "Mutar áudio",
                    onClick = onToggleAudioMute,
                )
            }

            ChatToggleButton(
                open = chatOpen,
                unreadCount = chatUnread,
                onToggle = { chatOpen = !chatOpen },
                modifier = Modifier.align(Alignment.BottomStart).padding(10.dp),
            )
        }

        if (chatOpen) {
            ChatPanel(
                title = "Chat com espectadores",
                messages = chatMessages,
                soundEnabled = chatSoundEnabled,
                onSoundToggle = onToggleChatSound,
                onClose = { chatOpen = false },
                onSend = onSendChat,
                canSend = true,
                emptyLabel = "Nenhuma mensagem ainda. Diga oi para quem está assistindo.",
                modifier = Modifier.fillMaxWidth(),
            )
        }

        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("O link é a sala.", style = MaterialTheme.typography.titleMedium)
            Text(
                shareUrl ?: "gerando seu link…",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
            )
            Button(
                onClick = {
                    shareUrl?.let { copyToClipboard(context, it) }
                },
                enabled = shareUrl != null,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Copiar link")
            }
        }

        error?.let {
            ErrorCard(error = it, onRetry = onRetry, onHome = onStop)
        }

        Spacer(Modifier.height(4.dp))

        TextButton(onClick = onStop, modifier = Modifier.fillMaxWidth()) {
            Text("Encerrar transmissão ×")
        }
    }
}

@Composable
private fun FilledIconAction(icon: androidx.compose.ui.graphics.vector.ImageVector, contentDescription: String, onClick: () -> Unit) {
    IconButton(
        onClick = onClick,
        modifier = Modifier.background(MaterialTheme.colorScheme.surface.copy(alpha = 0.85f), RoundedCornerShape(50)),
    ) {
        Icon(icon, contentDescription = contentDescription)
    }
}

private fun copyToClipboard(context: Context, text: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("p2pcast link", text))
}
