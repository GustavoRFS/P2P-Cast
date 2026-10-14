package expo.modules.p2pcastmedia.capture

import android.content.Intent
import android.media.projection.MediaProjection
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.VideoCapturer

object ScreenCapturerFactory {
  fun create(data: Intent, onStopped: () -> Unit): VideoCapturer = ScreenCapturerAndroid(
    data,
    object : MediaProjection.Callback() {
      override fun onStop() = onStopped()
    },
  )
}
