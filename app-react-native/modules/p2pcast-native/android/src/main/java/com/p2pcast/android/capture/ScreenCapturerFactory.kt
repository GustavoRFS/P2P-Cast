package com.p2pcast.android.capture

import android.content.Intent
import android.media.projection.MediaProjection
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.VideoCapturer

/** Wraps the user-granted MediaProjection consent intent as a WebRTC video
 * capturer. There is no Android equivalent of the web app's cursor-visibility
 * option (buildDisplayMediaVideoConstraints' `cursor` constraint) — the
 * system compositor draws the pointer and apps can't toggle that. */
object ScreenCapturerFactory {
    fun create(data: Intent, onStopped: () -> Unit): VideoCapturer {
        return ScreenCapturerAndroid(
            data,
            object : MediaProjection.Callback() {
                override fun onStop() {
                    onStopped()
                }
            },
        )
    }
}
