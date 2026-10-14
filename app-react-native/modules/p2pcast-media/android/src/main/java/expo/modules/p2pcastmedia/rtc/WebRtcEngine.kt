package expo.modules.p2pcastmedia.rtc

import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory

/**
 * Owns the process-wide WebRTC state (PeerConnectionFactory, shared EGL
 * context for video rendering/encoding) and hands out one [BroadcastSession]
 * or [ViewerSession] per app session — each gets its own signaling socket and
 * its own PeerConnection(s), same as the web app creating a fresh `Peer()`
 * per broadcast/watch. Counterpart of src/lib/peer.ts's createPeer, minus the
 * peerjs library itself (there is no PeerJS SDK for Android).
 */
class WebRtcEngine(private val context: Context) {
    val eglBase: EglBase = EglBase.create()
    val eglBaseContext: EglBase.Context get() = eglBase.eglBaseContext

    val factory: PeerConnectionFactory by lazy {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                .createInitializationOptions(),
        )
        PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
            .createPeerConnectionFactory()
    }

    /** Matches src/lib/peer.ts's peerOptions.config — same STUN-only ICE
     * config, no TURN, so both clients hit the same connectivity ceiling. */
    val iceServers: List<PeerConnection.IceServer> = listOf(
        PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
    )

    fun createBroadcastSession(
        scope: CoroutineScope,
        mediaProjectionResult: Pair<Int, Intent>?,
        webOrigin: String,
    ): BroadcastSession = RtcBroadcastSession(context, this, scope, mediaProjectionResult?.second, webOrigin)

    fun createViewerSession(scope: CoroutineScope): ViewerSession = RtcViewerSession(context, this, scope)

    fun release() {
        eglBase.release()
    }
}
