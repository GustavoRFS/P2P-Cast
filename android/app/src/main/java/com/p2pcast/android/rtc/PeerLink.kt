package com.p2pcast.android.rtc

import com.p2pcast.android.signaling.PeerMessageType
import com.p2pcast.android.signaling.PeerSignalingClient
import com.p2pcast.android.signaling.buildCandidatePayload
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.nio.ByteBuffer

/**
 * One PeerJS "connection" (a MediaConnection or DataConnection on the web
 * side) is its own dedicated RTCPeerConnection, addressed by a connectionId
 * on the shared signaling socket. Buffers ICE candidates that arrive before
 * the remote description is set — signaling and SDP exchange race in
 * practice — and forwards local candidates back out as they're gathered.
 */
class PeerLink(
    val connectionId: String,
    val connType: String,
    val remotePeerId: String,
    val pc: PeerConnection,
    private val signaling: PeerSignalingClient,
) {
    private val pendingRemoteCandidates = mutableListOf<IceCandidate>()
    private var remoteDescriptionSet = false

    var dataChannel: DataChannel? = null
    var onDataMessage: ((String) -> Unit)? = null
    var onClosed: (() -> Unit)? = null

    fun sendLocalIceCandidate(candidate: IceCandidate) {
        signaling.sendSignal(
            PeerMessageType.CANDIDATE,
            remotePeerId,
            buildCandidatePayload(candidate, connType, connectionId),
        )
    }

    fun applyRemoteDescription(sdp: SessionDescription, onSet: () -> Unit = {}) {
        pc.setRemoteDescription(
            object : SdpObserver {
                override fun onSetSuccess() {
                    remoteDescriptionSet = true
                    pendingRemoteCandidates.forEach { pc.addIceCandidate(it) }
                    pendingRemoteCandidates.clear()
                    onSet()
                }

                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onCreateFailure(p0: String?) {}
                override fun onSetFailure(p0: String?) {}
            },
            sdp,
        )
    }

    fun addRemoteCandidate(candidate: IceCandidate) {
        if (remoteDescriptionSet) pc.addIceCandidate(candidate) else pendingRemoteCandidates.add(candidate)
    }

    fun attachDataChannelObserver(channel: DataChannel) {
        dataChannel = channel
        channel.registerObserver(
            object : DataChannel.Observer {
                override fun onBufferedAmountChange(previousAmount: Long) {}
                override fun onStateChange() {}
                override fun onMessage(buffer: DataChannel.Buffer) {
                    val bytes = ByteArray(buffer.data.remaining())
                    buffer.data.get(bytes)
                    onDataMessage?.invoke(String(bytes, Charsets.UTF_8))
                }
            },
        )
    }

    fun sendData(text: String) {
        val channel = dataChannel ?: return
        val bytes = text.toByteArray(Charsets.UTF_8)
        channel.send(DataChannel.Buffer(ByteBuffer.wrap(bytes), false))
    }

    fun close() {
        dataChannel?.close()
        pc.close()
        onClosed?.invoke()
    }
}
