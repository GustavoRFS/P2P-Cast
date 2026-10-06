package expo.modules.p2pcastmedia.capture

import android.content.Context
import org.webrtc.Camera2Enumerator
import org.webrtc.CameraVideoCapturer

object CameraCapturerFactory {
  fun create(
    context: Context,
    facing: CameraFacing,
    eventsHandler: CameraVideoCapturer.CameraEventsHandler,
  ): CameraVideoCapturer? {
    val enumerator = Camera2Enumerator(context)
    val names = enumerator.deviceNames
    val preferred = names.firstOrNull { name ->
      if (facing == CameraFacing.USER) enumerator.isFrontFacing(name) else enumerator.isBackFacing(name)
    }
    return enumerator.createCapturer(preferred ?: names.firstOrNull() ?: return null, eventsHandler)
  }
}
