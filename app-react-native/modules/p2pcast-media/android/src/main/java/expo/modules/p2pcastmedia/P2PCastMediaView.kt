package expo.modules.p2pcastmedia

import android.content.Context
import android.graphics.Color
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class P2PCastMediaView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var sessionId: String? = null
    set(value) {
      field = value
      attachCurrentTrack()
    }

  var source: String = "screen"
    set(value) {
      field = value
      attachCurrentTrack()
    }

  var scaleMode: String = "contain"
    set(value) {
      field = value
      applyScaleMode()
    }

  var mirror: Boolean = false
    set(value) {
      field = value
      applyMirror()
    }

  private val surface = FrameLayout(context).apply {
    layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    setBackgroundColor(Color.rgb(3, 10, 18))
  }

  init {
    clipsToPadding = true
    clipChildren = true
    addView(surface)
  }

  private fun attachCurrentTrack() {
    // The native RTC registry and renderer are connected in the media-view task.
  }

  private fun applyScaleMode() {
    // The WebRTC renderer applies the contain/cover mode once a track is attached.
  }

  private fun applyMirror() {
    // Only a local front-camera preview is mirrored by the completed renderer.
  }

  fun detach() {
    // The renderer releases its sink and EGL surface here after it is installed.
    surface.removeAllViews()
  }
}
