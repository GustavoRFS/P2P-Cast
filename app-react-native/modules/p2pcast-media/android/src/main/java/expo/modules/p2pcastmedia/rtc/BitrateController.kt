package expo.modules.p2pcastmedia.rtc

import org.webrtc.PeerConnection

/** Kotlin port of src/lib/capture.ts's applyVideoBitrate — caps (or clears)
 * the outgoing video encoding's max bitrate on a peer connection's sender. */
object BitrateController {
    fun apply(pc: PeerConnection, bitrateBps: Int?) {
        val videoSender = pc.senders.firstOrNull { it.track()?.kind() == "video" } ?: return
        val parameters = videoSender.parameters
        if (parameters.encodings.isEmpty()) return

        parameters.encodings.forEach { encoding ->
            encoding.maxBitrateBps = bitrateBps
        }
        videoSender.parameters = parameters
    }
}
