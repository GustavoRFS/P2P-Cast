package expo.modules.p2pcastnative

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import com.p2pcast.android.capture.CameraFacing
import com.p2pcast.android.capture.CaptureSettings
import com.p2pcast.android.capture.CaptureSource
import com.p2pcast.android.capture.FPS_OPTIONS
import com.p2pcast.android.capture.Resolution
import com.p2pcast.android.rtc.BroadcastSession
import com.p2pcast.android.rtc.ChatController
import com.p2pcast.android.rtc.RemoteMedia
import com.p2pcast.android.rtc.ViewerSession
import com.p2pcast.android.service.StreamForegroundService
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

private const val SCREEN_CAPTURE_REQUEST = 47_123

/**
 * Bridges the Kotlin capture/WebRTC engine (com.p2pcast.android.rtc) to JavaScript. Sessions
 * expose StateFlows; every change is sent to JS as a full snapshot event, and video tracks travel
 * as ids that P2PCastVideoView resolves through [TrackRegistry].
 */
class P2PCastNativeModule : Module() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var broadcast: BroadcastSession? = null
    private var viewer: ViewerSession? = null
    private val broadcastJobs = mutableListOf<Job>()
    private val viewerJobs = mutableListOf<Job>()
    private var broadcastHasAudio = false
    private var broadcastTrackIds = emptyList<String?>()
    private var viewerTrackIds = emptyList<String?>()
    private var viewerAudioEnabled = false
    private var viewerVolume = 1.0
    private var projectionPromise: Promise? = null
    private var projectionData: Intent? = null

    private val context: Context
        get() = requireNotNull(appContext.reactContext) { "React context is not available" }

    override fun definition() = ModuleDefinition {
        Name("P2PCastNative")

        Events("onBroadcastState", "onBroadcastChat", "onViewerState", "onViewerChat")

        // MediaProjection consent is a system dialog that answers through onActivityResult.
        AsyncFunction("requestScreenCapture") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.resolve(false)
                return@AsyncFunction
            }
            projectionPromise?.resolve(false)
            projectionPromise = promise
            val manager = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            activity.startActivityForResult(manager.createScreenCaptureIntent(), SCREEN_CAPTURE_REQUEST)
        }.runOnQueue(Queues.MAIN)

        OnActivityResult { _, payload ->
            if (payload.requestCode != SCREEN_CAPTURE_REQUEST) return@OnActivityResult
            val granted = payload.resultCode == Activity.RESULT_OK && payload.data != null
            projectionData = if (granted) payload.data else null
            projectionPromise?.resolve(granted)
            projectionPromise = null
        }

        AsyncFunction("startBroadcast") { rawSettings: Map<String, Any?>, promise: Promise ->
            scope.launch {
                try {
                    startBroadcast(parseSettings(rawSettings))
                    promise.resolve(null)
                } catch (error: Throwable) {
                    stopBroadcastSession()
                    promise.reject("E_BROADCAST_START", error.message ?: "Não foi possível iniciar a transmissão.", error)
                }
            }
        }

        Function("stopBroadcast") { onMain { stopBroadcastSession() } }
        Function("setBroadcastAudioMuted") { muted: Boolean -> onMain { broadcast?.setLocalAudioMuted(muted) } }
        Function("flipCamera") { onMain { broadcast?.flipCamera() } }
        Function("sendBroadcastChat") { text: String -> onMain { broadcast?.chat?.send(text) } }

        Function("startViewer") { broadcastId: String -> onMain { startViewer(broadcastId) } }
        Function("retryViewer") { onMain { viewer?.retry() } }
        Function("stopViewer") { onMain { stopViewerSession() } }
        Function("sendViewerChat") { text: String, name: String? -> onMain { viewer?.chat?.send(text, name) } }
        Function("setViewerAudio") { enabled: Boolean, volume: Double ->
            onMain {
                viewerAudioEnabled = enabled
                viewerVolume = volume.coerceIn(0.0, 1.0)
                applyViewerAudio()
            }
        }

        OnDestroy {
            broadcast?.stop()
            viewer?.disconnect()
            broadcast = null
            viewer = null
            runCatching { StreamForegroundService.stop(context) }
            scope.cancel()
        }
    }

    // ---- broadcast ----

    private suspend fun startBroadcast(settings: CaptureSettings) {
        stopBroadcastSession()
        val projection = if (settings.source == CaptureSource.CAMERA) null else {
            projectionData ?: throw IllegalStateException("A captura de tela não foi autorizada.")
        }
        // A MediaProjection token works once; the next broadcast asks again.
        projectionData = null

        // getMediaProjection() throws unless the foreground service is already running.
        StreamForegroundService.start(context, roleFor(settings.source))
        withTimeoutOrNull(3_000) { StreamForegroundService.isForeground.first { it } }

        val session = EngineHolder.get(context).createBroadcastSession(scope, projection?.let { Activity.RESULT_OK to it })
        broadcast = session
        broadcastHasAudio = settings.microphone || (settings.screenAudio && settings.source != CaptureSource.CAMERA)
        observe(broadcastJobs, listOf(
            session.mode, session.error, session.shareUrl, session.viewerCount,
            session.localScreenTrack, session.localCameraTrack, session.localAudioMuted,
        )) { emitBroadcastState(session) }
        observe(broadcastJobs, listOf(session.chat.messages, session.chat.canSend)) {
            emitChat("onBroadcastChat", session.chat)
        }
        session.start(settings)
    }

    private fun stopBroadcastSession() {
        broadcastJobs.forEach { it.cancel() }
        broadcastJobs.clear()
        broadcast?.stop()
        broadcast = null
        broadcastTrackIds.forEach(TrackRegistry::unregister)
        broadcastTrackIds = emptyList()
        if (viewer == null) runCatching { StreamForegroundService.stop(context) }
        sendEvent("onBroadcastState", idleState())
    }

    private fun emitBroadcastState(session: BroadcastSession) {
        val screenId = TrackRegistry.register(session.localScreenTrack.value)
        val cameraId = TrackRegistry.register(session.localCameraTrack.value)
        (broadcastTrackIds - setOf(screenId, cameraId)).forEach(TrackRegistry::unregister)
        broadcastTrackIds = listOf(screenId, cameraId)
        sendEvent("onBroadcastState", mapOf(
            "mode" to session.mode.value.name.lowercase(),
            "error" to session.error.value?.let { mapOf("title" to it.title, "message" to it.message) },
            "shareUrl" to session.shareUrl.value,
            "viewerCount" to session.viewerCount.value,
            "audioMuted" to session.localAudioMuted.value,
            "screen" to screenId?.let { mapOf("trackId" to it, "hasAudio" to broadcastHasAudio) },
            "camera" to cameraId?.let { mapOf("trackId" to it, "hasAudio" to broadcastHasAudio) },
        ))
    }

    // ---- viewer ----

    private fun startViewer(broadcastId: String) {
        stopViewerSession()
        val session = EngineHolder.get(context).createViewerSession(scope)
        viewer = session
        observe(viewerJobs, listOf(session.mode, session.error, session.remoteScreen, session.remoteCamera)) {
            emitViewerState(session)
        }
        observe(viewerJobs, listOf(session.chat.messages, session.chat.canSend)) {
            emitChat("onViewerChat", session.chat)
        }
        session.connect(broadcastId)
        if (broadcast == null) StreamForegroundService.start(context, StreamForegroundService.ROLE_VIEWER)
    }

    private fun stopViewerSession() {
        viewerJobs.forEach { it.cancel() }
        viewerJobs.clear()
        viewer?.disconnect()
        viewer = null
        viewerTrackIds.forEach(TrackRegistry::unregister)
        viewerTrackIds = emptyList()
        if (broadcast == null) runCatching { StreamForegroundService.stop(context) }
    }

    private fun emitViewerState(session: ViewerSession) {
        val screen = session.remoteScreen.value
        val camera = session.remoteCamera.value
        val screenId = TrackRegistry.register(screen?.videoTrack)
        val cameraId = TrackRegistry.register(camera?.videoTrack)
        (viewerTrackIds - setOf(screenId, cameraId)).forEach(TrackRegistry::unregister)
        viewerTrackIds = listOf(screenId, cameraId)
        applyViewerAudio()
        sendEvent("onViewerState", mapOf(
            "mode" to session.mode.value.name.lowercase(),
            "error" to session.error.value?.let { mapOf("title" to it.title, "message" to it.message) },
            "screen" to remoteMediaPayload(screen, screenId),
            "camera" to remoteMediaPayload(camera, cameraId),
        ))
    }

    private fun remoteMediaPayload(media: RemoteMedia?, trackId: String?): Map<String, Any?>? =
        trackId?.let { mapOf("trackId" to it, "hasAudio" to (media?.audioTrack != null)) }

    // Remote audio plays through the WebRTC audio device; JS controls it like the web <video>.
    private fun applyViewerAudio() {
        val session = viewer ?: return
        listOfNotNull(session.remoteScreen.value?.audioTrack, session.remoteCamera.value?.audioTrack).forEach { track ->
            runCatching {
                track.setEnabled(viewerAudioEnabled)
                track.setVolume(viewerVolume * 10.0)
            }
        }
    }

    // ---- shared ----

    /** Sessions are driven from the main thread; JS calls return immediately. */
    private fun onMain(block: suspend () -> Unit) {
        scope.launch { block() }
    }

    private fun observe(jobs: MutableList<Job>, flows: List<StateFlow<*>>, emit: () -> Unit) {
        flows.forEach { flow -> jobs += scope.launch { flow.collect { emit() } } }
    }

    private fun emitChat(event: String, chat: ChatController) {
        sendEvent(event, mapOf(
            "canSend" to chat.canSend.value,
            "messages" to chat.messages.value.map { entry ->
                mapOf(
                    "id" to entry.message.id,
                    "authorName" to entry.message.authorName,
                    "text" to entry.message.text,
                    "timestamp" to entry.message.timestamp.toDouble(),
                    "isBroadcaster" to entry.message.isBroadcaster,
                    "isSelf" to entry.isSelf,
                )
            },
        ))
    }

    private fun idleState(): Map<String, Any?> = mapOf(
        "mode" to "idle",
        "error" to null,
        "shareUrl" to null,
        "viewerCount" to 0,
        "audioMuted" to false,
        "screen" to null,
        "camera" to null,
    )

    private fun roleFor(source: CaptureSource) = when (source) {
        CaptureSource.SCREEN -> StreamForegroundService.ROLE_BROADCAST_SCREEN
        CaptureSource.CAMERA -> StreamForegroundService.ROLE_BROADCAST_CAMERA
        CaptureSource.BOTH -> StreamForegroundService.ROLE_BROADCAST_BOTH
    }

    /** Same shape as CaptureSettings in src/lib/capture.ts. */
    private fun parseSettings(raw: Map<String, Any?>): CaptureSettings {
        val resolutionValue = (raw["resolution"] as? String)?.lowercase()
        return CaptureSettings(
            source = when (raw["source"]) {
                "camera" -> CaptureSource.CAMERA
                "both" -> CaptureSource.BOTH
                else -> CaptureSource.SCREEN
            },
            resolution = Resolution.ALL.find { it.label.lowercase() == resolutionValue } ?: Resolution.P1080,
            fps = (raw["fps"] as? Number)?.toInt()?.takeIf { it in FPS_OPTIONS } ?: 30,
            bitrate = (raw["bitrate"] as? Number)?.toInt(),
            screenAudio = raw["audio"] as? Boolean ?: true,
            microphone = raw["microphone"] as? Boolean ?: true,
            cameraFacing = if (raw["cameraFacing"] == "environment") CameraFacing.ENVIRONMENT else CameraFacing.USER,
        )
    }
}
