package com.p2pcast.android.rtc

import android.content.Context
import android.content.Intent
import com.p2pcast.android.AppError
import com.p2pcast.android.StreamMode
import com.p2pcast.android.capture.CameraCapturerFactory
import com.p2pcast.android.capture.CaptureSettings
import com.p2pcast.android.capture.CaptureSource
import com.p2pcast.android.capture.ScreenCapturerFactory
import com.p2pcast.android.chat.CHAT_CONNECTION_ROLE
import com.p2pcast.android.chat.ChatMessage
import com.p2pcast.android.signaling.PeerConnectionType
import com.p2pcast.android.signaling.PeerMessageType
import com.p2pcast.android.signaling.PeerSignalingClient
import com.p2pcast.android.signaling.buildAnswerPayload
import com.p2pcast.android.signaling.connTypeOf
import com.p2pcast.android.signaling.connectionIdOf
import com.p2pcast.android.signaling.metadataOf
import com.p2pcast.android.signaling.parseCandidate
import com.p2pcast.android.signaling.parseSdp
import com.p2pcast.android.signaling.serializationOf
import com.p2pcast.android.util.BroadcastIdStore
import com.p2pcast.android.util.WebOriginStore
import com.p2pcast.android.util.buildWatchUrl
import com.p2pcast.android.util.getPeerError
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.AudioTrack
import org.webrtc.CameraVideoCapturer
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoTrack
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

private const val MAX_MEDIA_CONNECTIONS_PER_SESSION = 2
private data class MediaViewerReservation(val viewerId: String, val sessionId: String)

/**
 * Android counterpart of App.tsx's `startBroadcast` — owns local capture
 * (screen and/or camera), the signaling socket, and one RTCPeerConnection per
 * connected viewer (media) or chat peer (data), mirroring how PeerJS gives
 * the web broadcaster a fresh MediaConnection/DataConnection per caller.
 */
class RtcBroadcastSession(
    private val context: Context,
    private val engine: WebRtcEngine,
    private val scope: CoroutineScope,
    private val mediaProjectionData: Intent?,
) : BroadcastSession {

    private val _mode = MutableStateFlow(StreamMode.STARTING)
    override val mode: StateFlow<StreamMode> = _mode.asStateFlow()
    private val _error = MutableStateFlow<AppError?>(null)
    override val error: StateFlow<AppError?> = _error.asStateFlow()
    private val _shareUrl = MutableStateFlow<String?>(null)
    override val shareUrl: StateFlow<String?> = _shareUrl.asStateFlow()
    private val _viewerCount = MutableStateFlow(0)
    override val viewerCount: StateFlow<Int> = _viewerCount.asStateFlow()
    private val _localScreenTrack = MutableStateFlow<VideoTrack?>(null)
    override val localScreenTrack: StateFlow<VideoTrack?> = _localScreenTrack.asStateFlow()
    private val _localCameraTrack = MutableStateFlow<VideoTrack?>(null)
    override val localCameraTrack: StateFlow<VideoTrack?> = _localCameraTrack.asStateFlow()
    private val _localAudioMuted = MutableStateFlow(false)
    override val localAudioMuted: StateFlow<Boolean> = _localAudioMuted.asStateFlow()

    override val chat = SimpleChatController(
        selfAuthorName = { "Transmissor" },
        isBroadcaster = true,
        onSend = { text, _ -> chatLinks.values.forEach { it.sendData(chatMessageJson(selfMessage(text))) } },
    )

    private val broadcastIdStore = BroadcastIdStore(context)
    private val webOriginStore = WebOriginStore(context)
    private val localId = broadcastIdStore.load() ?: UUID.randomUUID().toString()
    private var signaling: PeerSignalingClient? = null

    private var screenCapturer: VideoCapturer? = null
    private var cameraCapturer: CameraVideoCapturer? = null
    private var micAudioTrack: AudioTrack? = null
    private var surfaceTextureHelperScreen: SurfaceTextureHelper? = null
    private var surfaceTextureHelperCamera: SurfaceTextureHelper? = null

    private var settings: CaptureSettings = CaptureSettings.DEFAULT
    private val mediaLinks = ConcurrentHashMap<String, PeerLink>()
    private val mediaViewerReservations = mutableMapOf<String, MediaViewerReservation>()
    private val mediaAdmissionLock = Any()
    private val chatLinks = mutableMapOf<String, PeerLink>()
    private var chatViewerIndex = 0
    private val json = Json { ignoreUnknownKeys = true }

    override fun start(settings: CaptureSettings) {
        this.settings = settings
        try {
            setUpLocalTracks(settings)
        } catch (t: Throwable) {
            _error.value = AppError("Não foi possível iniciar", t.message ?: "Falha ao preparar a captura.")
            _mode.value = StreamMode.ERROR
            return
        }

        chat.setCanSend(true)
        val client = PeerSignalingClient(localId, scope)
        signaling = client
        wireSignaling(client)
        client.connect()
    }

    private fun setUpLocalTracks(settings: CaptureSettings) {
        val source = settings.source

        if (source == CaptureSource.SCREEN || source == CaptureSource.BOTH) {
            val data = mediaProjectionData ?: error("Permissão de captura de tela não concedida")
            val capturer = ScreenCapturerFactory.create(data) { scope.launch { stop() } }
            screenCapturer = capturer
            val videoSource = engine.factory.createVideoSource(true)
            val helper = SurfaceTextureHelper.create("ScreenCaptureThread", engine.eglBaseContext)
            surfaceTextureHelperScreen = helper
            capturer.initialize(helper, context, videoSource.capturerObserver)
            val (w, h) = resolutionPixels(settings)
            capturer.startCapture(w, h, settings.fps)
            _localScreenTrack.value = engine.factory.createVideoTrack("screen_v_$localId", videoSource)
        }

        if (source == CaptureSource.CAMERA || source == CaptureSource.BOTH) {
            val capturer = CameraCapturerFactory.create(context, settings.cameraFacing, noopCameraEvents())
                ?: error("Nenhuma câmera disponível")
            cameraCapturer = capturer
            val videoSource = engine.factory.createVideoSource(false)
            val helper = SurfaceTextureHelper.create("CameraCaptureThread", engine.eglBaseContext)
            surfaceTextureHelperCamera = helper
            capturer.initialize(helper, context, videoSource.capturerObserver)
            val (w, h) = resolutionPixels(settings)
            capturer.startCapture(w, h, settings.fps)
            _localCameraTrack.value = engine.factory.createVideoTrack("camera_v_$localId", videoSource)

            if (settings.microphone) {
                val audioSource = engine.factory.createAudioSource(MediaConstraints())
                micAudioTrack = engine.factory.createAudioTrack("camera_a_$localId", audioSource)
            }
        }
    }

    private fun resolutionPixels(settings: CaptureSettings): Pair<Int, Int> {
        val width = settings.resolution.width ?: 1920
        val height = settings.resolution.height ?: 1080
        return width to height
    }

    private fun noopCameraEvents() = object : CameraVideoCapturer.CameraEventsHandler {
        override fun onCameraError(errorDescription: String?) {}
        override fun onCameraDisconnected() {}
        override fun onCameraFreezed(errorDescription: String?) {}
        override fun onCameraOpening(cameraName: String?) {}
        override fun onFirstFrameAvailable() {}
        override fun onCameraClosed() {}
    }

    private fun wireSignaling(client: PeerSignalingClient) {
        client.onOpen = {
            broadcastIdStore.save(localId)
            _shareUrl.value = buildWatchUrl(webOriginStore.load(), localId)
            _mode.value = StreamMode.BROADCASTING
        }
        client.onOffer = { src, payload -> handleOffer(src, payload) }
        client.onAnswer = { _, payload -> handleAnswer(payload) }
        client.onCandidate = { _, payload -> handleCandidate(payload) }
        client.onLeave = { src -> handlePeerLeft(src) }
        client.onExpire = { src -> handlePeerLeft(src) }
        client.onError = { type ->
            _error.value = getPeerError(type)
            _mode.value = StreamMode.ERROR
        }
        client.onDisconnected = {
            if (_mode.value != StreamMode.ERROR) {
                _error.value = AppError(
                    "Sinalização desconectada",
                    "A transmissão atual pode continuar, mas novos espectadores talvez não consigam entrar.",
                )
            }
        }
    }

    private fun handleOffer(src: String, payload: JsonObject) {
        val connectionId = connectionIdOf(payload) ?: return
        val connType = connTypeOf(payload) ?: return
        val sdp = parseSdp(payload)

        if (connType == PeerConnectionType.DATA) {
            val role = metadataOf(payload)?.get("role")?.jsonPrimitive?.contentOrNull
            if (role == CHAT_CONNECTION_ROLE) answerChatOffer(src, connectionId, sdp, serializationOf(payload))
        } else {
            val metadata = metadataOf(payload)
            val requestedSource = metadata?.get("source")?.jsonPrimitive?.contentOrNull
            val viewerId = metadata?.get("viewerId")?.jsonPrimitive?.contentOrNull
                ?.trim()
                ?.takeIf { it.isNotEmpty() && it.length <= 128 }
                ?.let { "viewer:$it" }
                ?: "peer:$src"
            val viewerSessionId = metadata?.get("viewerSessionId")?.jsonPrimitive?.contentOrNull
                ?.trim()
                ?.takeIf { it.isNotEmpty() && it.length <= 128 }
                ?.let { "session:$it" }
                ?: "peer:$src"
            answerMediaOffer(src, connectionId, sdp, requestedSource, viewerId, viewerSessionId)
        }
    }

    private fun answerMediaOffer(
        src: String,
        connectionId: String,
        sdp: org.webrtc.SessionDescription,
        requestedSource: String?,
        viewerId: String,
        viewerSessionId: String,
    ) {
        val wantsCamera = requestedSource == "camera"
        val videoTrack = if (wantsCamera) _localCameraTrack.value else _localScreenTrack.value
        val signalingClient = signaling ?: return
        if (videoTrack == null) return

        if (!reserveMediaConnection(connectionId, viewerId, viewerSessionId)) {
            signalingClient.sendLeave(src)
            return
        }

        var link: PeerLink? = null
        val pc = engine.factory.createPeerConnection(
            rtcConfig(),
            RoutingPeerConnectionObserver(
                onIceCandidate = { candidate -> link?.sendLocalIceCandidate(candidate) },
                onIceConnectionStateChanged = { state ->
                    if (state == PeerConnection.IceConnectionState.FAILED ||
                        state == PeerConnection.IceConnectionState.CLOSED
                    ) {
                        link?.close()
                    }
                },
            ),
        )
        if (pc == null) {
            releaseMediaConnection(connectionId)
            return
        }

        val mediaLink = PeerLink(connectionId, PeerConnectionType.MEDIA, src, pc, signalingClient)
        link = mediaLink
        mediaLinks[connectionId] = mediaLink
        mediaLink.onClosed = {
            mediaLinks.remove(connectionId, mediaLink)
            releaseMediaConnection(connectionId)
            updateViewerCount()
        }

        // A track added with no stream ID arrives on the browser side with an
        // empty `event.streams` — peerjs's ontrack handler reads
        // `event.streams[0].id` unconditionally and throws (this is the exact
        // "infinite loading" bug: the answer negotiates fine, but the web
        // viewer's UI crashes before ever calling `addStream`/showing video).
        // Every track for one source must share the same stream id so
        // video+mic arrive as one MediaStream, same as a browser's own
        // getUserMedia() would produce.
        val streamId = "p2pcast_$connectionId"
        pc.addTrack(videoTrack, listOf(streamId))
        if (wantsCamera) micAudioTrack?.let { pc.addTrack(it, listOf(streamId)) }

        mediaLink.applyRemoteDescription(sdp, onFailure = { mediaLink.close() }) {
            pc.createAnswer(
                LambdaSdpObserver(
                    onCreated = { answer ->
                        pc.setLocalDescription(NoopSdpObserver, answer)
                        signalingClient.sendSignal(
                            PeerMessageType.ANSWER,
                            src,
                            buildAnswerPayload(answer, PeerConnectionType.MEDIA, connectionId),
                        )
                        BitrateController.apply(pc, settings.bitrate)
                    },
                    onFailure = { mediaLink.close() },
                ),
                MediaConstraints(),
            )
        }

        updateViewerCount()
    }

    private fun reserveMediaConnection(connectionId: String, viewerId: String, sessionId: String): Boolean =
        synchronized(mediaAdmissionLock) {
            val activeSessions = mediaViewerReservations.values.filter { it.viewerId == viewerId }
            if (connectionId in mediaViewerReservations ||
                activeSessions.size >= MAX_MEDIA_CONNECTIONS_PER_SESSION ||
                activeSessions.any { it.sessionId != sessionId }
            ) {
                false
            } else {
                mediaViewerReservations[connectionId] = MediaViewerReservation(viewerId, sessionId)
                true
            }
        }

    private fun releaseMediaConnection(connectionId: String) {
        synchronized(mediaAdmissionLock) {
            mediaViewerReservations.remove(connectionId)
        }
    }

    private fun answerChatOffer(src: String, connectionId: String, sdp: org.webrtc.SessionDescription, serialization: String?) {
        val signalingClient = signaling ?: return
        var link: PeerLink? = null
        val pc = engine.factory.createPeerConnection(
            rtcConfig(),
            RoutingPeerConnectionObserver(
                onIceCandidate = { candidate -> link?.sendLocalIceCandidate(candidate) },
                onDataChannel = { channel ->
                    link?.attachDataChannelObserver(channel)
                    link?.onDataMessage = { text -> handleChatData(link!!, text, serialization) }
                },
            ),
        ) ?: return

        link = PeerLink(connectionId, PeerConnectionType.DATA, src, pc, signalingClient)
        chatLinks[connectionId] = link

        link.applyRemoteDescription(sdp) {
            pc.createAnswer(
                LambdaSdpObserver(
                    onCreated = { answer ->
                        pc.setLocalDescription(NoopSdpObserver, answer)
                        signalingClient.sendSignal(
                            PeerMessageType.ANSWER,
                            src,
                            buildAnswerPayload(answer, PeerConnectionType.DATA, connectionId),
                        )
                    },
                ),
                MediaConstraints(),
            )
        }
    }

    private fun handleChatData(link: PeerLink, text: String, serialization: String?) {
        // Only JSON is supported; a peer declaring another wire format (e.g.
        // PeerJS's binary/msgpack default) is answered for media purposes but
        // its chat text is dropped rather than mis-decoded.
        if (serialization != null && serialization != "json") return

        val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        val rawText = obj["text"]?.jsonPrimitive?.contentOrNull ?: return
        val name = obj["name"]?.jsonPrimitive?.contentOrNull

        val sanitized = com.p2pcast.android.chat.sanitizeChatText(rawText)
        if (sanitized.isEmpty()) return

        chatViewerIndex += 1
        val authorName = com.p2pcast.android.chat.resolveAuthorName(name, chatViewerIndex)
        val message = com.p2pcast.android.chat.buildChatMessage(sanitized, authorName, isBroadcaster = false)
        chat.receive(message, isSelf = false)

        chatLinks.values.forEach { other -> if (other !== link) other.sendData(chatMessageJson(message)) }
    }

    private fun selfMessage(text: String) = com.p2pcast.android.chat.buildChatMessage(text, "Transmissor", isBroadcaster = true)

    private fun chatMessageJson(message: ChatMessage): String = buildJsonObject {
        put("id", message.id)
        put("authorName", message.authorName)
        put("text", message.text)
        put("timestamp", message.timestamp)
        put("isBroadcaster", message.isBroadcaster)
    }.toString()

    private fun handleAnswer(payload: JsonObject) {
        val connectionId = connectionIdOf(payload) ?: return
        val link = mediaLinks[connectionId] ?: chatLinks[connectionId] ?: return
        link.applyRemoteDescription(parseSdp(payload))
    }

    private fun handleCandidate(payload: JsonObject) {
        val connectionId = connectionIdOf(payload) ?: return
        val link = mediaLinks[connectionId] ?: chatLinks[connectionId] ?: return
        link.addRemoteCandidate(parseCandidate(payload))
    }

    private fun handlePeerLeft(src: String) {
        mediaLinks.values.filter { it.remotePeerId == src }.forEach { it.close() }
        chatLinks.filterValues { it.remotePeerId == src }.forEach { (id, link) -> link.close(); chatLinks.remove(id) }
        updateViewerCount()
    }

    private fun updateViewerCount() {
        _viewerCount.value = mediaLinks.values.map { it.remotePeerId }.distinct().size
    }

    private fun rtcConfig(): PeerConnection.RTCConfiguration =
        PeerConnection.RTCConfiguration(engine.iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

    override fun setLocalAudioMuted(muted: Boolean) {
        micAudioTrack?.setEnabled(!muted)
        _localAudioMuted.value = muted
    }

    override fun flipCamera() {
        cameraCapturer?.switchCamera(null)
    }

    override fun stop() {
        mediaLinks.values.forEach { it.close() }
        mediaLinks.clear()
        synchronized(mediaAdmissionLock) { mediaViewerReservations.clear() }
        chatLinks.values.forEach { it.close() }
        chatLinks.clear()
        signaling?.close()
        signaling = null
        chat.reset()

        runCatching { screenCapturer?.stopCapture() }
        screenCapturer?.dispose()
        runCatching { cameraCapturer?.stopCapture() }
        cameraCapturer?.dispose()
        surfaceTextureHelperScreen?.dispose()
        surfaceTextureHelperCamera?.dispose()

        _localScreenTrack.value = null
        _localCameraTrack.value = null
        _viewerCount.value = 0
        _shareUrl.value = null
        _mode.value = StreamMode.IDLE
    }
}
