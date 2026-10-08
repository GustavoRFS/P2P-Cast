package expo.modules.p2pcastmedia

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.activityresult.AppContextActivityResultLauncher
import expo.modules.p2pcastmedia.capture.CapturePermissionController
import expo.modules.p2pcastmedia.capture.CaptureSource
import expo.modules.p2pcastmedia.capture.CaptureSettings
import expo.modules.p2pcastmedia.capture.RuntimePermissionsContract
import expo.modules.p2pcastmedia.capture.ScreenCaptureConsentContract
import expo.modules.p2pcastmedia.service.SessionRegistry
import android.content.Intent
import android.os.Handler
import android.os.Looper

class P2PCastMediaModule : Module() {
  private var sessionController: SessionController? = null
  private var capturePermissionController: CapturePermissionController? = null
  private lateinit var runtimePermissionLauncher: AppContextActivityResultLauncher<ArrayList<String>, Map<String, Boolean>>
  private lateinit var screenCaptureLauncher: AppContextActivityResultLauncher<Boolean, Pair<Int, Intent?>>

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

    RegisterActivityContracts {
      runtimePermissionLauncher = registerForActivityResult(RuntimePermissionsContract())
      screenCaptureLauncher = registerForActivityResult(ScreenCaptureConsentContract())
    }

    OnCreate {
      val context = requireNotNull(appContext.reactContext) { "O contexto React Native não está disponível." }
      sessionController = SessionRegistry.attach(context) { eventName, payload ->
        runCatching { sendEvent(eventName, payload) }
      }
      capturePermissionController = CapturePermissionController(context, runtimePermissionLauncher, screenCaptureLauncher)
    }

    OnDestroy {
      SessionRegistry.detach(sessionController)
      sessionController = null
      capturePermissionController = null
    }

    OnStartObserving("stateChanged") {
      sessionController?.publishSnapshot("stateChanged")
    }
    OnStartObserving("shareUrlChanged") {
      sessionController?.publishSnapshot("shareUrlChanged")
    }
    OnStartObserving("viewerCountChanged") {
      sessionController?.publishSnapshot("viewerCountChanged")
    }
    OnStartObserving("trackChanged") {
      sessionController?.publishSnapshot("trackChanged")
    }
    OnStartObserving("chatMessage") {
      sessionController?.publishSnapshot("chatMessage")
    }
    OnStartObserving("chatReadyChanged") {
      sessionController?.publishSnapshot("chatReadyChanged")
    }
    OnStartObserving("screenAudioCapabilityChanged") {
      sessionController?.publishSnapshot("screenAudioCapabilityChanged")
    }
    OnStartObserving("pipModeChanged") {
      emitPipMode()
    }

    OnActivityEntersBackground {
      publishPipModeAfterActivityTransition()
    }
    OnActivityEntersForeground {
      publishPipModeAfterActivityTransition()
    }

    AsyncFunction("requestCapturePermissions") Coroutine { rawSettings: Map<String, Any?> ->
      val settings = CaptureSettings.fromBridge(rawSettings)
      requireNotNull(capturePermissionController) { "O controlador de permissões não está disponível." }
        .request(settings)
        .toBridgeMap()
    }

    AsyncFunction("startBroadcast") Coroutine { rawSettings: Map<String, Any?>, webOrigin: String ->
      val settings = CaptureSettings.fromBridge(rawSettings)
      val permissions = requireNotNull(capturePermissionController) { "O controlador de permissões não está disponível." }
      require(permissions.hasRequiredRuntimePermissions(settings)) { "As permissões de câmera ou microfone foram revogadas." }
      val projectionResult = if (settings.source == CaptureSource.SCREEN || settings.source == CaptureSource.BOTH) {
        requireNotNull(SessionRegistry.takeProjectionGrant()) { "A captura de tela precisa de autorização do Android." }
      } else {
        SessionRegistry.clearProjectionGrant()
        null
      }
      controller().startBroadcast(settings, webOrigin, projectionResult)
    }

    AsyncFunction("startViewer") { options: Map<String, String> ->
      val broadcastId = requireNotNull(options["broadcastId"]) { "O ID da transmissão está ausente." }
      val viewerId = requireNotNull(options["viewerId"]) { "O ID do espectador está ausente." }
      val viewerSessionId = requireNotNull(options["viewerSessionId"]) { "O ID da sessão está ausente." }
      controller().startViewer(broadcastId, viewerId, viewerSessionId)
    }

    AsyncFunction("stopSession") {
      SessionRegistry.clearProjectionGrant()
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
      PictureInPictureController.enter(appContext.currentActivity, controller().isViewerVideoActive())
    }

    View(P2PCastMediaView::class) {
      Prop("sessionId") { view: P2PCastMediaView, value: String? -> view.sessionId = value }
      Prop("source") { view: P2PCastMediaView, value: String -> view.source = value }
      Prop("scaleMode") { view: P2PCastMediaView, value: String? -> view.scaleMode = value ?: "contain" }
      Prop("mirror") { view: P2PCastMediaView, value: Boolean? -> view.mirror = value ?: false }
      OnViewDestroys { view: P2PCastMediaView -> view.detach() }
    }
  }

  private fun publishPipModeAfterActivityTransition() {
    val activity = appContext.currentActivity ?: return
    Handler(Looper.getMainLooper()).postDelayed({
      emitPipMode()
    }, PIP_STATE_DELAY_MS)
  }

  private fun emitPipMode() {
    runCatching {
      sendEvent("pipModeChanged", mapOf(
        "isInPictureInPictureMode" to PictureInPictureController.isInPictureInPictureMode(appContext.currentActivity),
      ))
    }
  }

  private companion object {
    const val PIP_STATE_DELAY_MS = 200L
  }
}
