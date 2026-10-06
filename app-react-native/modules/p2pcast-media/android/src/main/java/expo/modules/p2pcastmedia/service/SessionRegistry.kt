package expo.modules.p2pcastmedia.service

import android.content.Context
import android.content.Intent
import expo.modules.p2pcastmedia.SessionController
import org.webrtc.EglBase
import org.webrtc.VideoTrack
import java.util.concurrent.CopyOnWriteArrayList

/** Process-owned session and MediaProjection grant; neither is persisted to disk. */
object SessionRegistry {
  @Volatile private var controller: SessionController? = null
  @Volatile private var eventSink: ((String, Map<String, Any?>) -> Unit)? = null
  private var projectionGrant: Pair<Int, Intent>? = null
  private val trackListeners = CopyOnWriteArrayList<() -> Unit>()

  @Synchronized
  fun attach(context: Context, sink: (String, Map<String, Any?>) -> Unit): SessionController {
    eventSink = sink
    if (controller == null) {
      controller = SessionController(context.applicationContext) { name, payload -> dispatch(name, payload) }
    }
    return requireNotNull(controller)
  }

  @Synchronized
  fun detach(attachedController: SessionController?) {
    if (attachedController != null && controller === attachedController) eventSink = null
  }

  fun dispatch(name: String, payload: Map<String, Any?>) {
    val sink = eventSink ?: return
    runCatching { sink(name, payload) }
    if (name == "trackChanged") trackListeners.forEach { runCatching(it) }
  }

  fun videoTrack(sessionId: String?, source: String): VideoTrack? =
    if (sessionId == null) null else controller?.videoTrack(sessionId, source)

  fun eglContext(): EglBase.Context? = controller?.eglContext

  fun addTrackListener(listener: () -> Unit): AutoCloseable {
    trackListeners += listener
    return AutoCloseable { trackListeners.remove(listener) }
  }

  @Synchronized
  fun storeProjectionGrant(result: Pair<Int, Intent>) {
    projectionGrant = result
  }

  @Synchronized
  fun takeProjectionGrant(): Pair<Int, Intent>? = projectionGrant.also { projectionGrant = null }

  @Synchronized
  fun clearProjectionGrant() {
    projectionGrant = null
  }
}
