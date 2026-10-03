package com.p2pcast.android.capture

import android.content.Context
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer

/** Picks a camera matching [CameraFacing] and wraps it as a WebRTC capturer,
 * mirroring buildCameraVideoConstraints/buildCameraMediaOptions in the web
 * app's capture.ts (facingMode preference there, device enumeration here). */
object CameraCapturerFactory {
    fun create(
        context: Context,
        facing: CameraFacing,
        eventsHandler: CameraVideoCapturer.CameraEventsHandler,
    ): CameraVideoCapturer? {
        val enumerator = Camera2Enumerator(context)
        val deviceNames = enumerator.deviceNames

        val preferred = deviceNames.firstOrNull {
            if (facing == CameraFacing.USER) enumerator.isFrontFacing(it) else enumerator.isBackFacing(it)
        }
        val fallback = deviceNames.firstOrNull()
        val deviceName = preferred ?: fallback ?: return null

        return enumerator.createCapturer(deviceName, eventsHandler)
    }
}
