package expo.modules.p2pcastmedia.rtc

import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaStream
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription

/**
 * A PeerConnection.Observer needs to exist before the [PeerLink] wrapping
 * that same connection can be constructed (the pc must already exist to
 * build the link), so ICE-candidate/data-channel routing is wired through
 * plain lambdas rather than a direct link reference — callers assign the
 * link-bound behavior right after construction, before any events can fire.
 */
open class RoutingPeerConnectionObserver(
    private val onIceCandidate: (IceCandidate) -> Unit = {},
    private val onDataChannel: (DataChannel) -> Unit = {},
    private val onTrackReceived: (RtpTransceiver) -> Unit = {},
    private val onIceConnectionStateChanged: (PeerConnection.IceConnectionState?) -> Unit = {},
) : PeerConnection.Observer {
    override fun onIceCandidate(candidate: IceCandidate) = onIceCandidate.invoke(candidate)
    override fun onDataChannel(channel: DataChannel) = onDataChannel.invoke(channel)
    override fun onTrack(transceiver: RtpTransceiver) = onTrackReceived.invoke(transceiver)

    override fun onSignalingChange(state: PeerConnection.SignalingState?) {}
    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) = onIceConnectionStateChanged.invoke(state)
    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) {}
    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>?) {}
    override fun onAddStream(stream: MediaStream?) {}
    override fun onRemoveStream(stream: MediaStream?) {}
    override fun onRenegotiationNeeded() {}
    override fun onAddTrack(receiver: RtpReceiver?, streams: Array<out MediaStream>?) {}
}

/** SdpObserver where only one callback matters for a given call site. */
open class LambdaSdpObserver(
    private val onCreated: (SessionDescription) -> Unit = {},
    private val onSet: () -> Unit = {},
    private val onFailure: (String?) -> Unit = {},
) : SdpObserver {
    override fun onCreateSuccess(sdp: SessionDescription) = onCreated.invoke(sdp)
    override fun onSetSuccess() = onSet.invoke()
    override fun onCreateFailure(error: String?) = onFailure.invoke(error)
    override fun onSetFailure(error: String?) = onFailure.invoke(error)
}

val NoopSdpObserver = LambdaSdpObserver()
