package com.p2pcast.android.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import org.webrtc.EglBase
import org.webrtc.RendererCommon
import org.webrtc.SurfaceViewRenderer
import org.webrtc.VideoTrack

/**
 * Binds a single [VideoTrack] to a native [SurfaceViewRenderer] for the
 * lifetime of this composable — the closest Android equivalent to the web
 * app's `<video srcObject={stream}>` binding in App.tsx.
 */
@Composable
fun VideoRendererView(
    eglBaseContext: EglBase.Context,
    videoTrack: VideoTrack?,
    modifier: Modifier = Modifier,
    mirror: Boolean = false,
) {
    val rendererState = remember { mutableStateOf<SurfaceViewRenderer?>(null) }

    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            SurfaceViewRenderer(ctx).also { view ->
                view.init(eglBaseContext, null)
                view.setEnableHardwareScaler(true)
                view.setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                rendererState.value = view
            }
        },
        onRelease = { view ->
            view.release()
            rendererState.value = null
        },
    )

    DisposableEffect(videoTrack, rendererState.value) {
        val renderer = rendererState.value
        if (renderer != null && videoTrack != null) videoTrack.addSink(renderer)

        onDispose {
            if (renderer != null && videoTrack != null) videoTrack.removeSink(renderer)
        }
    }

    LaunchedEffect(mirror, rendererState.value) {
        rendererState.value?.setMirror(mirror)
    }
}
