package expo.modules.p2pcastmedia

import android.content.Context
import android.graphics.Color
import android.widget.FrameLayout
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import expo.modules.p2pcastmedia.service.SessionRegistry
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

class P2PCastMediaView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var sessionId: String? = null
    set(value) {
      if (field == value) return
      detachTrack()
      field = value
      attachCurrentTrack()
    }

  var source: String = "screen"
    set(value) {
      if (field == value) return
      detachTrack()
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
  private val renderer = SurfaceViewRenderer(context)
  private var attachedTrack: VideoTrack? = null
  private var trackListener: AutoCloseable? = null
  private var rendererInitialized = false

  init {
    clipsToPadding = true
    clipChildren = true
    addView(surface)
    surface.addView(renderer, FrameLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    SessionRegistry.eglContext()?.let { eglContext ->
      initializeRenderer(eglContext)
    }
    trackListener = SessionRegistry.addTrackListener {
      post { attachCurrentTrack() }
    }
    applyScaleMode()
    applyMirror()
  }

  private fun initializeRenderer(eglContext: org.webrtc.EglBase.Context) {
    renderer.init(eglContext, null)
    rendererInitialized = true
    applyScaleMode()
    applyMirror()
  }

  private fun attachCurrentTrack() {
    if (!rendererInitialized) {
      SessionRegistry.eglContext()?.let { eglContext ->
        initializeRenderer(eglContext)
      }
    }
    if (!rendererInitialized) return
    val next = SessionRegistry.videoTrack(sessionId, source)
    if (next === attachedTrack) return
    detachTrack()
    attachedTrack = next
    next?.addSink(renderer)
  }

  private fun applyScaleMode() {
    if (!rendererInitialized) return
    renderer.setScalingType(if (scaleMode == "cover") {
      RendererCommon.ScalingType.SCALE_ASPECT_FILL
    } else {
      RendererCommon.ScalingType.SCALE_ASPECT_FIT
    })
  }

  private fun applyMirror() {
    if (!rendererInitialized) return
    renderer.setMirror(mirror)
  }

  private fun detachTrack() {
    attachedTrack?.removeSink(renderer)
    attachedTrack = null
  }

  fun detach() {
    trackListener?.close()
    trackListener = null
    detachTrack()
    if (rendererInitialized) {
      renderer.release()
      rendererInitialized = false
    }
    surface.removeAllViews()
  }
}
