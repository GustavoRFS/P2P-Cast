package expo.modules.p2pcastmedia

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class P2PCastMediaModule : Module() {
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

    AsyncFunction("requestCapturePermissions") { _: Map<String, Any> ->
      throw IllegalStateException("O controlador de permissões ainda não foi inicializado.")
    }

    AsyncFunction("startBroadcast") { _: Map<String, Any>, _: String ->
      throw IllegalStateException("O motor de transmissão ainda não foi inicializado.")
    }

    AsyncFunction("startViewer") { _: Map<String, String> ->
      throw IllegalStateException("O motor de visualização ainda não foi inicializado.")
    }

    AsyncFunction("stopSession") {
      // Stop remains idempotent when no session has been created.
    }

    AsyncFunction("retryViewer") {
      throw IllegalStateException("Não há uma sessão de visualização ativa para tentar novamente.")
    }

    AsyncFunction("setMicrophoneMuted") { _: Boolean ->
      throw IllegalStateException("Não há uma sessão de transmissão ativa.")
    }

    AsyncFunction("setViewerAudio") { _: Boolean, _: Double ->
      throw IllegalStateException("Não há uma sessão de visualização ativa.")
    }

    AsyncFunction("flipCamera") {
      throw IllegalStateException("Não há uma câmera ativa para alternar.")
    }

    AsyncFunction("sendChatMessage") { _: String, _: String? ->
      throw IllegalStateException("O chat ainda não está conectado.")
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
