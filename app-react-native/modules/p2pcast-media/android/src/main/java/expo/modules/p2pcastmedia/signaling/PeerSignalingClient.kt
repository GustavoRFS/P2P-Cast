package expo.modules.p2pcastmedia.signaling

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Hand-rolled client for the PeerJS signaling protocol — there is no
 * PeerJS SDK for Android, so this replicates the wire format peer.ts's
 * `new Peer(id, { config, debug })` configured for the self-hosted server
 * (host 129.148.41.116, port 9000, path /peerjs, cleartext, key "peerjs").
 *
 * Only the signaling channel lives here — SDP/ICE payload contents are
 * standard WebRTC JSEP objects (peerjs's Negotiator doesn't munge SDP in
 * modern unified-plan browsers), so any spec-compliant WebRTC stack on either
 * end should interoperate once the envelope below matches.
 */
object PeerMessageType {
    const val OPEN = "OPEN"
    const val ERROR = "ERROR"
    const val ID_TAKEN = "ID-TAKEN"
    const val INVALID_KEY = "INVALID-KEY"
    const val LEAVE = "LEAVE"
    const val EXPIRE = "EXPIRE"
    const val OFFER = "OFFER"
    const val ANSWER = "ANSWER"
    const val CANDIDATE = "CANDIDATE"
    const val HEARTBEAT = "HEARTBEAT"
}

object PeerConnectionType {
    const val MEDIA = "media"
    const val DATA = "data"
}

data class ServerMessage(val type: String, val src: String?, val payload: JsonObject?)

class PeerSignalingClient(
    private val localId: String,
    private val scope: CoroutineScope,
) {
    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .build()
    private var webSocket: WebSocket? = null
    private val token = UUID.randomUUID().toString().replace("-", "")
    private val json = Json { ignoreUnknownKeys = true }
    private var heartbeatJob: Job? = null

    var onOpen: (() -> Unit)? = null
    var onOffer: ((src: String, payload: JsonObject) -> Unit)? = null
    var onAnswer: ((src: String, payload: JsonObject) -> Unit)? = null
    var onCandidate: ((src: String, payload: JsonObject) -> Unit)? = null
    var onLeave: ((src: String) -> Unit)? = null
    var onExpire: ((src: String) -> Unit)? = null
    var onError: ((type: String) -> Unit)? = null
    var onDisconnected: (() -> Unit)? = null

    fun connect() {
        // Matches peerjs's Socket._baseUrl + "&id=...&token=..." exactly — no
        // "version" param (verified against the actual peerjs 1.5.5 source;
        // the real client never sends one).
        val url = "ws://129.148.41.116:9000/peerjs/peerjs?key=peerjs&id=$localId&token=$token"
        val request = Request.Builder().url(url).build()

        webSocket = client.newWebSocket(
            request,
            object : WebSocketListener() {
                override fun onMessage(webSocket: WebSocket, text: String) {
                    handleMessage(text)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    onError?.invoke("socket-error")
                    onDisconnected?.invoke()
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    onDisconnected?.invoke()
                }
            },
        )

        // peerjs's Socket defaults pingInterval to 5000ms — match it exactly;
        // PeerServer may treat a sparser heartbeat as a dead connection.
        heartbeatJob = scope.launch {
            while (isActive) {
                delay(5_000)
                send(buildJsonObject { put("type", PeerMessageType.HEARTBEAT) })
            }
        }
    }

    private fun handleMessage(text: String) {
        val message = runCatching { parse(text) }.getOrNull() ?: return
        val src = message.src

        when (message.type) {
            PeerMessageType.OPEN -> onOpen?.invoke()
            PeerMessageType.ERROR -> onError?.invoke("server-error")
            PeerMessageType.ID_TAKEN -> onError?.invoke("unavailable-id")
            PeerMessageType.INVALID_KEY -> onError?.invoke("invalid-key")
            PeerMessageType.OFFER -> if (src != null && message.payload != null) onOffer?.invoke(src, message.payload)
            PeerMessageType.ANSWER -> if (src != null && message.payload != null) onAnswer?.invoke(src, message.payload)
            PeerMessageType.CANDIDATE -> if (src != null && message.payload != null) onCandidate?.invoke(src, message.payload)
            PeerMessageType.LEAVE -> if (src != null) onLeave?.invoke(src)
            PeerMessageType.EXPIRE -> if (src != null) onExpire?.invoke(src)
            PeerMessageType.HEARTBEAT -> Unit
        }
    }

    private fun parse(text: String): ServerMessage {
        val obj = json.parseToJsonElement(text).jsonObject
        return ServerMessage(
            type = obj["type"]?.jsonPrimitive?.contentOrNull.orEmpty(),
            src = obj["src"]?.jsonPrimitive?.contentOrNull,
            payload = obj["payload"] as? JsonObject,
        )
    }

    // peerjs's client never sends "src" on outgoing messages — the server
    // identifies the sender from the authenticated socket connection itself
    // and stamps "src" only on messages it relays to the *other* end.
    fun sendSignal(type: String, dst: String, payload: JsonObject) {
        send(
            buildJsonObject {
                put("type", type)
                put("dst", dst)
                put("payload", payload)
            },
        )
    }

    fun sendLeave(dst: String) {
        send(buildJsonObject { put("type", PeerMessageType.LEAVE); put("dst", dst) })
    }

    private fun send(obj: JsonObject) {
        webSocket?.send(obj.toString())
    }

    fun close() {
        heartbeatJob?.cancel()
        webSocket?.close(1000, null)
        webSocket = null
    }
}

/** Matches PeerJS's connectionId generation convention (`dc_`/`mc_` prefix +
 * a random token) closely enough for uniqueness — the exact alphabet doesn't
 * need to match since it's an opaque id echoed back by whoever receives it. */
fun newConnectionId(prefix: String): String = "${prefix}_${UUID.randomUUID().toString().replace("-", "").take(16)}"
