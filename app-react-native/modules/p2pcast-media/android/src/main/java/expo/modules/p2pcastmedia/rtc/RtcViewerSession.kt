package expo.modules.p2pcastmedia.rtc

import android.content.Context
import expo.modules.p2pcastmedia.AppError
import expo.modules.p2pcastmedia.StreamMode
import expo.modules.p2pcastmedia.capture.CaptureTrackSource
import expo.modules.p2pcastmedia.chat.CHAT_CONNECTION_ROLE
import expo.modules.p2pcastmedia.chat.ChatMessage
import expo.modules.p2pcastmedia.chat.SimpleChatController
import expo.modules.p2pcastmedia.signaling.PeerConnectionType
import expo.modules.p2pcastmedia.signaling.PeerMessageType
import expo.modules.p2pcastmedia.signaling.PeerSignalingClient
import expo.modules.p2pcastmedia.signaling.buildOfferPayload
import expo.modules.p2pcastmedia.signaling.connectionIdOf
import expo.modules.p2pcastmedia.signaling.newConnectionId
import expo.modules.p2pcastmedia.signaling.parseCandidate
import expo.modules.p2pcastmedia.signaling.parseSdp
import expo.modules.p2pcastmedia.util.getPeerError
import expo.modules.p2pcastmedia.chat.resolveAuthorName
import expo.modules.p2pcastmedia.chat.sanitizeChatText
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.DataChannel
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.RtpTransceiver
import java.util.UUID

/**
 * Android counterpart of App.tsx's ViewerView `connect` — calls the
 * broadcaster for each media source (screen, camera) plus one chat data
 * connection, same shape as the web app's per-source MediaConnections. Where
 * the web viewer must hand PeerJS a fake black/silent MediaStream just to
 * get `peer.call()` to build an offer, a standards-compliant RTCPeerConnection
 * can request receive-only media directly via a recvonly transceiver — no
 * dummy track needed, and it still negotiates correctly against a browser's
 * PeerJS-driven answer.
 */
class RtcViewerSession(
    private val context: Context,
    private val engine: WebRtcEngine,
    private val scope: CoroutineScope,
) : ViewerSession {

    private val _mode = MutableStateFlow(StreamMode.CONNECTING)
    override val mode: StateFlow<StreamMode> = _mode.asStateFlow()
    private val _error = MutableStateFlow<AppError?>(null)
    override val error: StateFlow<AppError?> = _error.asStateFlow()
    private val _remoteScreen = MutableStateFlow<RemoteMedia?>(null)
    override val remoteScreen: StateFlow<RemoteMedia?> = _remoteScreen.asStateFlow()
    private val _remoteCamera = MutableStateFlow<RemoteMedia?>(null)
    override val remoteCamera: StateFlow<RemoteMedia?> = _remoteCamera.asStateFlow()

    override val chat = SimpleChatController(
        selfAuthorName = { "Você" },
        isBroadcaster = false,
        onSend = { text, name -> sendChatData(text, name) },
    )

    private val localId = UUID.randomUUID().toString()
    private var viewerId = ""
    private var viewerSessionId = ""
    private var signaling: PeerSignalingClient? = null
    private var broadcastId: String? = null
    private var viewerAudioEnabled = false
    private var viewerAudioVolume = 1f
    private val mediaLinks = mutableMapOf<CaptureTrackSource, PeerLink>()
    private var chatLink: PeerLink? = null
    private val receivedMediaSources = mutableSetOf<CaptureTrackSource>()
    private val json = Json { ignoreUnknownKeys = true }

    override fun connect(broadcastId: String, viewerId: String, viewerSessionId: String) {
        this.viewerId = viewerId
        this.viewerSessionId = viewerSessionId
        this.broadcastId = broadcastId
        _mode.value = StreamMode.CONNECTING
        _error.value = null

        val client = PeerSignalingClient(localId, scope)
        signaling = client
        wireSignaling(client, broadcastId, viewerSessionId)
        client.connect()
    }

    override fun retry() {
        val id = broadcastId ?: return
        disconnect()
        connect(id, viewerId, viewerSessionId)
    }

    private fun wireSignaling(client: PeerSignalingClient, broadcastId: String, viewerSessionId: String) {
        client.onOpen = {
            listOf(CaptureTrackSource.SCREEN, CaptureTrackSource.CAMERA).forEach { source ->
                callForMedia(client, broadcastId, source, viewerSessionId)
            }
            openChatConnection(client, broadcastId, viewerSessionId)
        }
        client.onAnswer = { _, payload -> handleAnswer(payload) }
        client.onCandidate = { _, payload -> handleCandidate(payload) }
        client.onLeave = { fail("peer-unavailable") }
        client.onExpire = { fail("peer-unavailable") }
        client.onError = { type -> fail(type) }
        client.onDisconnected = {
            if (_mode.value != StreamMode.ERROR) {
                _error.value = AppError(
                    "Sinalização desconectada",
                    "A conexão inicial foi perdida. Tente novamente.",
                )
            }
        }
    }

    private fun callForMedia(
        client: PeerSignalingClient,
        broadcastId: String,
        source: CaptureTrackSource,
        viewerSessionId: String,
    ) {
        val connectionId = newConnectionId("mc")
        var link: PeerLink? = null

        val pc = engine.factory.createPeerConnection(
            rtcConfig(),
            RoutingPeerConnectionObserver(
                onIceCandidate = { candidate -> link?.sendLocalIceCandidate(candidate) },
                onTrackReceived = { transceiver -> handleRemoteTrack(source, transceiver.receiver.track()) },
            ),
        ) ?: return

        link = PeerLink(connectionId, PeerConnectionType.MEDIA, broadcastId, pc, client)
        mediaLinks[source] = link

        pc.addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )
        pc.addTransceiver(
            MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO,
            RtpTransceiver.RtpTransceiverInit(RtpTransceiver.RtpTransceiverDirection.RECV_ONLY),
        )

        pc.createOffer(
            LambdaSdpObserver(
                onCreated = { offer ->
                    pc.setLocalDescription(NoopSdpObserver, offer)
                    val metadata = buildJsonObject {
                        put("role", "viewer")
                        put("source", if (source == CaptureTrackSource.CAMERA) "camera" else "screen")
                        put("viewerId", viewerId)
                        put("viewerSessionId", viewerSessionId)
                    }
                    client.sendSignal(
                        PeerMessageType.OFFER,
                        broadcastId,
                        buildOfferPayload(offer, PeerConnectionType.MEDIA, connectionId, metadata = metadata),
                    )
                },
            ),
            MediaConstraints(),
        )
    }

    private fun openChatConnection(client: PeerSignalingClient, broadcastId: String, viewerSessionId: String) {
        val connectionId = newConnectionId("dc")
        var link: PeerLink? = null

        val pc = engine.factory.createPeerConnection(
            rtcConfig(),
            RoutingPeerConnectionObserver(onIceCandidate = { candidate -> link?.sendLocalIceCandidate(candidate) }),
        ) ?: return

        link = PeerLink(connectionId, PeerConnectionType.DATA, broadcastId, pc, client)
        chatLink = link
        link.onDataChannelOpen = { chat.setCanSend(true) }

        val channel = pc.createDataChannel(connectionId, DataChannel.Init())
        link.attachDataChannelObserver(channel)
        link.onDataMessage = { text -> handleIncomingChat(text) }

        pc.createOffer(
            LambdaSdpObserver(
                onCreated = { offer ->
                    pc.setLocalDescription(NoopSdpObserver, offer)
                    val metadata = buildJsonObject {
                        put("role", CHAT_CONNECTION_ROLE)
                        put("viewerId", viewerId)
                        put("viewerSessionId", viewerSessionId)
                    }
                    client.sendSignal(
                        PeerMessageType.OFFER,
                        broadcastId,
                        buildOfferPayload(
                            offer,
                            PeerConnectionType.DATA,
                            connectionId,
                            metadata = metadata,
                            serialization = "json",
                            reliable = true,
                        ),
                    )
                },
            ),
            MediaConstraints(),
        )
    }

    private fun handleRemoteTrack(source: CaptureTrackSource, track: MediaStreamTrack?) {
        receivedMediaSources.add(source)
        val media = when (track) {
            is org.webrtc.VideoTrack -> RemoteMedia(videoTrack = track, audioTrack = null)
            is org.webrtc.AudioTrack -> {
                track.setEnabled(viewerAudioEnabled)
                track.setVolume(viewerAudioVolume.toDouble())
                RemoteMedia(videoTrack = null, audioTrack = track)
            }
            else -> null
        } ?: return

        if (source == CaptureTrackSource.SCREEN) {
            _remoteScreen.value = mergeMedia(_remoteScreen.value, media)
        } else {
            _remoteCamera.value = mergeMedia(_remoteCamera.value, media)
        }
        _mode.value = StreamMode.WATCHING
    }

    private fun mergeMedia(existing: RemoteMedia?, incoming: RemoteMedia): RemoteMedia = RemoteMedia(
        videoTrack = incoming.videoTrack ?: existing?.videoTrack,
        audioTrack = incoming.audioTrack ?: existing?.audioTrack,
    )

    private fun handleIncomingChat(text: String) {
        val obj = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
        val messageText = sanitizeChatText(obj["text"]?.jsonPrimitive?.contentOrNull ?: return)
        if (messageText.isEmpty()) return
        val authorName = resolveAuthorName(obj["authorName"]?.jsonPrimitive?.contentOrNull, 1)
        val message = ChatMessage(
            id = obj["id"]?.jsonPrimitive?.contentOrNull ?: UUID.randomUUID().toString(),
            authorName = authorName,
            text = messageText,
            timestamp = obj["timestamp"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: System.currentTimeMillis(),
            isBroadcaster = obj["isBroadcaster"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull() ?: true,
        )
        chat.receive(message, isSelf = false)
    }

    private fun sendChatData(text: String, viewerNameOverride: String?) {
        val link = chatLink ?: return
        val payload = buildJsonObject {
            put("text", text)
            if (!viewerNameOverride.isNullOrBlank()) put("name", viewerNameOverride)
        }.toString()
        link.sendData(payload)
    }

    override fun setAudio(enabled: Boolean, volume: Float) {
        viewerAudioEnabled = enabled
        viewerAudioVolume = volume.coerceIn(0f, 1f)
        val safeVolume = viewerAudioVolume.toDouble()
        listOf(_remoteScreen.value, _remoteCamera.value).forEach { media ->
            media?.audioTrack?.apply {
                setEnabled(enabled)
                setVolume(safeVolume)
            }
        }
    }

    private fun handleAnswer(payload: JsonObject) {
        val connectionId = connectionIdOf(payload) ?: return
        linkFor(connectionId)?.applyRemoteDescription(parseSdp(payload))
    }

    private fun handleCandidate(payload: JsonObject) {
        val connectionId = connectionIdOf(payload) ?: return
        linkFor(connectionId)?.addRemoteCandidate(parseCandidate(payload))
    }

    private fun linkFor(connectionId: String): PeerLink? =
        mediaLinks.values.find { it.connectionId == connectionId }
            ?: chatLink?.takeIf { it.connectionId == connectionId }

    private fun fail(type: String?) {
        if (receivedMediaSources.isNotEmpty()) return
        _error.value = getPeerError(type)
        _mode.value = StreamMode.ERROR
    }

    private fun rtcConfig(): PeerConnection.RTCConfiguration =
        PeerConnection.RTCConfiguration(engine.iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

    override fun disconnect() {
        mediaLinks.values.forEach { it.close() }
        mediaLinks.clear()
        chatLink?.close()
        chatLink = null
        signaling?.close()
        signaling = null
        chat.reset()
        _remoteScreen.value = null
        _remoteCamera.value = null
        receivedMediaSources.clear()
    }
}
