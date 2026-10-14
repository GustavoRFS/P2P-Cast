package expo.modules.p2pcastmedia.util

import android.content.Context
import java.net.URLDecoder
import java.net.URLEncoder
import java.util.UUID

/** Kotlin port of src/lib/room.ts. The web app encodes the broadcast peer id
 * as a `?watch=<id>` query param; the Android app accepts either a bare id or
 * a full shared URL (pasted from the web app's "copiar link" button) and
 * extracts the same id. Plain string handling (no android.net.Uri) so this
 * runs as a fast, dependency-free JVM unit test, same as the web version. */

private const val PREFS_NAME = "p2pcast_prefs"
private const val KEY_BROADCAST_ID = "room.broadcast_id"
private const val KEY_WEB_ORIGIN = "room.web_origin"
private const val KEY_VIEWER_ID = "viewer.id"
private const val WATCH_PARAM = "watch"

fun parseWatchId(input: String): String? {
    val trimmedInput = input.trim()
    if (trimmedInput.isEmpty()) return null

    val queryStart = trimmedInput.indexOf('?')
    if (queryStart == -1) {
        // No query string — a full URL with no params has no id to extract;
        // anything else (a bare code) is the id itself.
        return if (trimmedInput.contains("://")) null else trimmedInput
    }

    val query = trimmedInput.substring(queryStart + 1)
    val rawValue = query.split('&')
        .asSequence()
        .map { it.split("=", limit = 2) }
        .firstOrNull { it.getOrNull(0) == WATCH_PARAM }
        ?.getOrNull(1)
        ?: return null

    val decoded = runCatching { URLDecoder.decode(rawValue, "UTF-8") }.getOrDefault(rawValue)
    return decoded.trim().ifEmpty { null }
}

fun buildWatchUrl(origin: String, peerId: String): String {
    val trimmedOrigin = origin.trimEnd('/')
    val separator = if (trimmedOrigin.contains('?')) "&" else "?"
    val encodedId = URLEncoder.encode(peerId, "UTF-8")
    return "$trimmedOrigin/$separator$WATCH_PARAM=$encodedId"
}

class BroadcastIdStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): String? = prefs.getString(KEY_BROADCAST_ID, null)?.trim()?.takeIf { it.isNotEmpty() }

    fun save(id: String) {
        prefs.edit().putString(KEY_BROADCAST_ID, id).apply()
    }
}

class ViewerIdentityStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun loadOrCreate(): String = synchronized(identityLock) {
        prefs.getString(KEY_VIEWER_ID, null)?.trim()?.takeIf { it.isNotEmpty() }
            ?: UUID.randomUUID().toString().also { id ->
                prefs.edit().putString(KEY_VIEWER_ID, id).apply()
            }
    }

    private companion object {
        val identityLock = Any()
    }
}

/** The web app's deployed origin, so the Android broadcaster hands out the
 * exact same `?watch=` link the web app itself would generate — a web friend
 * can open it directly, same as clicking "copiar link" there. Overridable
 * (e.g. if the deployment ever moves), but defaults to the real deployment. */
class WebOriginStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun load(): String = prefs.getString(KEY_WEB_ORIGIN, null)?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_ORIGIN

    fun save(origin: String) {
        prefs.edit().putString(KEY_WEB_ORIGIN, origin.trim()).apply()
    }

    companion object {
        const val DEFAULT_ORIGIN = "https://p2p-cast-react-native-beta.vercel.app"
    }
}
