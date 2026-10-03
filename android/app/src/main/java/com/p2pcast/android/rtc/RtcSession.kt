package com.p2pcast.android.rtc

import com.p2pcast.android.AppError
import com.p2pcast.android.StreamMode
import com.p2pcast.android.capture.CaptureSettings
import com.p2pcast.android.chat.ChatMessage
import kotlinx.coroutines.flow.StateFlow
import org.webrtc.AudioTrack
import org.webrtc.VideoTrack

/**
 * Contract the UI layer programs against, so screens/ViewModel don't need to
 * know whether media is flowing yet — only [RtcBroadcastSession] and
 * [RtcViewerSession] (rtc/RtcEngine.kt) touch PeerConnection/signaling
 * directly. Mirrors the shape of App.tsx's BroadcastView/ViewerView state.
 */

data class RemoteMedia(
    val videoTrack: VideoTrack?,
    val audioTrack: AudioTrack?,
)

data class DisplayChatMessage(
    val message: ChatMessage,
    val isSelf: Boolean,
)

interface ChatController {
    val messages: StateFlow<List<DisplayChatMessage>>
    val canSend: StateFlow<Boolean>
    fun send(text: String, viewerName: String? = null)
}

interface BroadcastSession {
    val mode: StateFlow<StreamMode>
    val error: StateFlow<AppError?>
    val shareUrl: StateFlow<String?>
    val viewerCount: StateFlow<Int>
    val localScreenTrack: StateFlow<VideoTrack?>
    val localCameraTrack: StateFlow<VideoTrack?>
    val localAudioMuted: StateFlow<Boolean>
    val chat: ChatController

    fun start(settings: CaptureSettings)
    fun stop()
    fun setLocalAudioMuted(muted: Boolean)
    fun flipCamera()
}

interface ViewerSession {
    val mode: StateFlow<StreamMode>
    val error: StateFlow<AppError?>
    val remoteScreen: StateFlow<RemoteMedia?>
    val remoteCamera: StateFlow<RemoteMedia?>
    val chat: ChatController

    fun connect(broadcastId: String)
    fun retry()
    fun disconnect()
}
