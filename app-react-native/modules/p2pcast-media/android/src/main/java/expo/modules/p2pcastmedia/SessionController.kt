package expo.modules.p2pcastmedia

import android.content.Context
import android.content.Intent
import expo.modules.p2pcastmedia.capture.CaptureSettings
import expo.modules.p2pcastmedia.capture.CaptureTrackSource
import expo.modules.p2pcastmedia.rtc.BroadcastSession
import expo.modules.p2pcastmedia.rtc.DisplayChatMessage
import expo.modules.p2pcastmedia.rtc.RemoteMedia
import expo.modules.p2pcastmedia.rtc.RtcViewerSession
import expo.modules.p2pcastmedia.rtc.ViewerSession
import expo.modules.p2pcastmedia.rtc.WebRtcEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import org.webrtc.VideoTrack
import java.util.UUID

/**
 * Owns one native P2P session and translates session flows into Expo events.
 * The activity and React screen are consumers; they never own RTC resources.
 */
class SessionController(
  context: Context,
  private val emitEvent: (String, Map<String, Any?>) -> Unit,
) {
  private val appContext = context.applicationContext
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private val engine = WebRtcEngine(appContext)
  private val observers = mutableListOf<Job>()

  private var sessionId: String? = null
  private var broadcast: BroadcastSession? = null
  private var viewer: ViewerSession? = null
  private var broadcastId: String? = null
  private var viewerId: String? = null
  private var viewerSessionId: String? = null

  fun startBroadcast(
    settings: CaptureSettings,
    webOrigin: String,
    mediaProjectionResult: Pair<Int, Intent>? = null,
  ): String {
    stopSession()
    val id = UUID.randomUUID().toString()
    val nativeSession = engine.createBroadcastSession(scope, mediaProjectionResult, webOrigin)
    sessionId = id
    broadcast = nativeSession
    observeBroadcast(id, nativeSession)
    emitEvent("screenAudioCapabilityChanged", mapOf(
      "available" to false,
      "reason" to "O Android não disponibilizou áudio da tela para esta sessão.",
      "sessionId" to id,
    ))
    nativeSession.start(settings)
    return id
  }

  fun startViewer(broadcastId: String, viewerId: String, viewerSessionId: String): String {
    stopSession()
    val id = UUID.randomUUID().toString()
    val nativeSession = engine.createViewerSession(scope)
    sessionId = id
    viewer = nativeSession
    this.broadcastId = broadcastId
    this.viewerId = viewerId
    this.viewerSessionId = viewerSessionId
    observeViewer(id, nativeSession)
    nativeSession.connect(broadcastId, viewerId, viewerSessionId)
    return id
  }

  private fun observeBroadcast(id: String, session: BroadcastSession) {
    observers += scope.launch {
      session.mode.collect { mode ->
        val error = session.error.value
        val payload = mutableMapOf<String, Any?>("mode" to mode.name.lowercase(), "sessionId" to id)
        if (error != null) payload["error"] = mapOf("code" to "session-error", "message" to "${error.title}: ${error.message}")
        emitEvent("stateChanged", payload)
      }
    }
    observers += scope.launch {
      session.error.collect { error ->
        if (error != null) emitEvent("stateChanged", mapOf(
          "mode" to session.mode.value.name.lowercase(),
          "sessionId" to id,
          "error" to mapOf("code" to "session-error", "message" to "${error.title}: ${error.message}"),
        ))
      }
    }
    observers += scope.launch {
      session.shareUrl.collect { url -> if (url != null) emitEvent("shareUrlChanged", mapOf("url" to url, "sessionId" to id)) }
    }
    observers += scope.launch {
      session.viewerCount.collect { count -> emitEvent("viewerCountChanged", mapOf("count" to count, "sessionId" to id)) }
    }
    observers += scope.launch {
      session.localScreenTrack.collect { track -> emitTrack(id, CaptureTrackSource.SCREEN, track != null, local = true) }
    }
    observers += scope.launch {
      session.localCameraTrack.collect { track -> emitTrack(id, CaptureTrackSource.CAMERA, track != null, local = true) }
    }
    observeChat(id, session.chat.messages, session.chat.canSend)
  }

  private fun observeViewer(id: String, session: ViewerSession) {
    observers += scope.launch {
      session.mode.collect { mode ->
        val error = session.error.value
        val payload = mutableMapOf<String, Any?>("mode" to mode.name.lowercase(), "sessionId" to id)
        if (error != null) payload["error"] = mapOf("code" to "session-error", "message" to "${error.title}: ${error.message}")
        emitEvent("stateChanged", payload)
      }
    }
    observers += scope.launch {
      session.error.collect { error ->
        if (error != null) emitEvent("stateChanged", mapOf(
          "mode" to session.mode.value.name.lowercase(),
          "sessionId" to id,
          "error" to mapOf("code" to "session-error", "message" to "${error.title}: ${error.message}"),
        ))
      }
    }
    observers += scope.launch {
      session.remoteScreen.collect { media -> emitTrack(id, CaptureTrackSource.SCREEN, media?.videoTrack != null, local = false) }
    }
    observers += scope.launch {
      session.remoteCamera.collect { media -> emitTrack(id, CaptureTrackSource.CAMERA, media?.videoTrack != null, local = false) }
    }
    observeChat(id, session.chat.messages, session.chat.canSend)
  }

  private fun observeChat(
    id: String,
    messages: kotlinx.coroutines.flow.StateFlow<List<DisplayChatMessage>>,
    canSend: kotlinx.coroutines.flow.StateFlow<Boolean>,
  ) {
    observers += scope.launch {
      var messageCount = 0
      messages.collect { current ->
        if (current.size > messageCount) {
          current.drop(messageCount).forEach { display ->
            val message = display.message
            emitEvent("chatMessage", mapOf(
              "sessionId" to id,
              "id" to message.id,
              "authorName" to message.authorName,
              "text" to message.text,
              "timestamp" to message.timestamp,
              "isBroadcaster" to message.isBroadcaster,
              "isSelf" to display.isSelf,
            ))
          }
        }
        messageCount = current.size
      }
    }
    observers += scope.launch {
      canSend.collect { ready -> emitEvent("chatReadyChanged", mapOf("ready" to ready, "sessionId" to id)) }
    }
  }

  private fun emitTrack(id: String, source: CaptureTrackSource, available: Boolean, local: Boolean) {
    emitEvent("trackChanged", mapOf(
      "source" to if (source == CaptureTrackSource.CAMERA) "camera" else "screen",
      "available" to available,
      "local" to local,
      "sessionId" to id,
    ))
  }

  fun retryViewer() {
    requireNotNull(viewer) { "Não há uma sessão de visualização ativa para tentar novamente." }.retry()
  }

  fun setMicrophoneMuted(muted: Boolean) {
    requireNotNull(broadcast) { "Não há uma sessão de transmissão ativa." }.setLocalAudioMuted(muted)
  }

  fun setViewerAudio(enabled: Boolean, volume: Double) {
    requireNotNull(viewer) { "Não há uma sessão de visualização ativa." }.setAudio(enabled, volume.toFloat())
  }

  fun flipCamera() {
    requireNotNull(broadcast) { "Não há uma sessão de transmissão ativa." }.flipCamera()
  }

  fun sendChatMessage(text: String, name: String?) {
    val chat = broadcast?.chat ?: viewer?.chat ?: error("O chat ainda não está conectado.")
    chat.send(text, name)
  }

  fun videoTrack(id: String, source: String): VideoTrack? {
    if (sessionId != id) return null
    val trackSource = if (source == "camera") CaptureTrackSource.CAMERA else CaptureTrackSource.SCREEN
    return broadcast?.let { session ->
      if (trackSource == CaptureTrackSource.CAMERA) session.localCameraTrack.value else session.localScreenTrack.value
    } ?: (viewer as? RtcViewerSession)?.let { session ->
      val media: RemoteMedia? = if (trackSource == CaptureTrackSource.CAMERA) session.remoteCamera.value else session.remoteScreen.value
      media?.videoTrack
    }
  }

  fun isViewerVideoActive(): Boolean {
    val activeViewer = viewer ?: return false
    val hasVideo = activeViewer.remoteScreen.value?.videoTrack != null || activeViewer.remoteCamera.value?.videoTrack != null
    return hasVideo && activeViewer.mode.value == StreamMode.WATCHING
  }

  fun stopSession() {
    val stoppedId = sessionId ?: return
    val wasLocal = broadcast != null
    observers.forEach { it.cancel() }
    observers.clear()
    broadcast?.stop()
    viewer?.disconnect()
    broadcast = null
    viewer = null
    broadcastId = null
    viewerId = null
    viewerSessionId = null
    sessionId = null
    emitEvent("trackChanged", mapOf("source" to "screen", "available" to false, "local" to wasLocal, "sessionId" to stoppedId))
    emitEvent("trackChanged", mapOf("source" to "camera", "available" to false, "local" to wasLocal, "sessionId" to stoppedId))
    emitEvent("viewerCountChanged", mapOf("count" to 0, "sessionId" to stoppedId))
    emitEvent("chatReadyChanged", mapOf("ready" to false, "sessionId" to stoppedId))
    emitEvent("stateChanged", mapOf("mode" to "idle", "sessionId" to stoppedId))
  }

  fun close() {
    stopSession()
    scope.cancel()
    engine.release()
  }
}
