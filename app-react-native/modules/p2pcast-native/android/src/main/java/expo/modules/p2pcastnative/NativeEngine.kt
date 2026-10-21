package expo.modules.p2pcastnative

import android.content.Context
import com.p2pcast.android.rtc.WebRtcEngine
import org.webrtc.VideoTrack
import java.util.concurrent.ConcurrentHashMap

/**
 * One WebRTC engine per process: the sessions and every video view must share the same EGL
 * context, and PeerConnectionFactory must only be initialized once.
 */
object EngineHolder {
    @Volatile
    private var engine: WebRtcEngine? = null

    fun get(context: Context): WebRtcEngine =
        engine ?: synchronized(this) {
            engine ?: WebRtcEngine(context.applicationContext).also { engine = it }
        }
}

/** Live video tracks by id, so a JS `trackId` prop can find the track to render. */
object TrackRegistry {
    private val tracks = ConcurrentHashMap<String, VideoTrack>()

    fun register(track: VideoTrack?): String? {
        if (track == null) return null
        val id = runCatching { track.id() }.getOrNull() ?: return null
        tracks[id] = track
        return id
    }

    fun get(id: String): VideoTrack? = tracks[id]

    fun unregister(id: String?) {
        if (id != null) tracks.remove(id)
    }
}
