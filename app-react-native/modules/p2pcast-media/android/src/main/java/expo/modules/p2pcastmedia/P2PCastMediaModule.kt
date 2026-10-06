package expo.modules.p2pcastmedia

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.p2pcastmedia.capture.CaptureSettings

class P2PCastMediaModule : Module() {
  private var sessionController: SessionController? = null

  private fun controller(): SessionController = requireNotNull(sessionController) {
    "O controlador de mídia nativo ainda não foi inicializado."
  }

  override fun definition() = ModuleDefinition {
    Name("P2PCastMedia")

    Events(
      "stateChanged",
      "shareUrlChanged",
      "viewerCountChanged",
      "trackChanged",
      "chatMessage",
      "chatReadyChanged",
      "screenAudioCapabilityChanged",
      "pipModeChanged"
    )

    OnCreate {
      val context = requireNotNull(appContext.reactContext) { "O contexto React Native não está disponível." }
      sessionController = SessionController(context) { eventName, payload ->
        runCatching { sendEvent(eventName, payload) }
      }
    }

    OnDestroy {
      sessionController?.close()
      sessionController = null
    }

    AsyncFunction("requestCapturePermissions") { _: Map<String, Any?> ->
      throw IllegalStateException("O controlador de permissões ainda não foi inicializado.")
    }

    AsyncFunction("startBroadcast") { rawSettings: Map<String, Any?>, webOrigin: String ->
      val settings = CaptureSettings.fromBridge(rawSettings)
      controller().startBroadcast(settings, webOrigin)
    }

    AsyncFunction("startViewer") { options: Map<String, String> ->
      val broadcastId = requireNotNull(options["broadcastId"]) { "O ID da transmissão está ausente." }
      val viewerId = requireNotNull(options["viewerId"]) { "O ID do espectador está ausente." }
      val viewerSessionId = requireNotNull(options["viewerSessionId"]) { "O ID da sessão está ausente." }
      controller().startViewer(broadcastId, viewerId, viewerSessionId)
    }

    AsyncFunction("stopSession") {
      sessionController?.stopSession()
    }

    AsyncFunction("retryViewer") {
      controller().retryViewer()
    }

    AsyncFunction("setMicrophoneMuted") { muted: Boolean ->
      controller().setMicrophoneMuted(muted)
    }

    AsyncFunction("setViewerAudio") { enabled: Boolean, volume: Double ->
      controller().setViewerAudio(enabled, volume)
    }

    AsyncFunction("flipCamera") {
      controller().flipCamera()
    }

    AsyncFunction("sendChatMessage") { text: String, name: String? ->
      controller().sendChatMessage(text, name)
    }

    AsyncFunction("enterPictureInPicture") {
      false
    }

    View(P2PCastMediaView::class) {
      Prop("sessionId") { view: P2PCastMediaView, value: String? -> view.sessionId = value }
      Prop("source") { view: P2PCastMediaView, value: String -> view.source = value }
      Prop("scaleMode") { view: P2PCastMediaView, value: String? -> view.scaleMode = value ?: "contain" }
      Prop("mirror") { view: P2PCastMediaView, value: Boolean? -> view.mirror = value ?: false }
      OnViewDestroys { view: P2PCastMediaView -> view.detach() }
    }
  }
}
