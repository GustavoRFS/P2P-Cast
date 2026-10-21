package expo.modules.p2pcastnative

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/** Renders one WebRTC video track; the JS side picks it with the `trackId` prop. */
class P2PCastVideoView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
    // The renderer is a plain Android child, so let Android lay it out inside the RN box.
    override val shouldUseAndroidLayout = true

    private val renderer = SurfaceViewRenderer(context)
    private var track: VideoTrack? = null
    private var released = false

    init {
        renderer.init(EngineHolder.get(context).eglBaseContext, null)
        renderer.setEnableHardwareScaler(true)
        renderer.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
        addView(renderer, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    fun setTrackId(id: String?) {
        if (released) return
        val next = id?.let { TrackRegistry.get(it) }
        if (next === track) return
        // A session may already have disposed the old track; detaching is best effort.
        track?.let { runCatching { it.removeSink(renderer) } }
        track = next
        if (next != null) runCatching { next.addSink(renderer) } else runCatching { renderer.clearImage() }
    }

    fun setFit(fit: String) {
        renderer.setScalingType(
            if (fit == "cover") RendererCommon.ScalingType.SCALE_ASPECT_FILL else RendererCommon.ScalingType.SCALE_ASPECT_FIT,
        )
    }

    fun setMirror(mirror: Boolean) {
        renderer.setMirror(mirror)
    }

    /** Two SurfaceViews have no defined z-order; the floating camera asks to be drawn on top. */
    fun setOverlay(overlay: Boolean) {
        renderer.setZOrderMediaOverlay(overlay)
    }

    fun release() {
        if (released) return
        released = true
        track?.let { runCatching { it.removeSink(renderer) } }
        track = null
        renderer.release()
    }
}
