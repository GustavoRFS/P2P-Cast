package com.p2pcast.android.chat

import android.content.Context
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.UUID

/** Kotlin port of src/lib/chat.ts — kept field-for-field so JSON chat payloads
 * exchanged with the web app decode/encode identically on both ends. */

const val CHAT_MAX_MESSAGE_LENGTH = 500
const val CHAT_MAX_NAME_LENGTH = 40
const val CHAT_CONNECTION_ROLE = "chat"

data class ChatMessage(
    val id: String,
    val authorName: String,
    val text: String,
    val timestamp: Long,
    val isBroadcaster: Boolean,
)

fun sanitizeChatText(rawText: String): String =
    rawText.trim().take(CHAT_MAX_MESSAGE_LENGTH)

fun resolveAuthorName(rawName: String?, viewerIndex: Int): String {
    val trimmed = rawName?.trim()
    return if (!trimmed.isNullOrEmpty()) trimmed.take(CHAT_MAX_NAME_LENGTH) else "Espectador $viewerIndex"
}

fun buildChatMessage(text: String, authorName: String, isBroadcaster: Boolean): ChatMessage = ChatMessage(
    id = UUID.randomUUID().toString(),
    authorName = authorName,
    text = text,
    timestamp = System.currentTimeMillis(),
    isBroadcaster = isBroadcaster,
)

fun formatMessageTime(timestamp: Long): String {
    val formatter = SimpleDateFormat("HH:mm", Locale("pt", "BR"))
    return formatter.format(timestamp)
}

fun shouldPlayChatNotification(chatOpen: Boolean, soundEnabled: Boolean): Boolean =
    !chatOpen && soundEnabled

private const val PREFS_NAME = "p2pcast_prefs"
private const val KEY_VIEWER_NAME = "chat.viewer_name"
private const val KEY_CHAT_SOUND = "chat.sound_enabled"
private const val KEY_VIEWER_VOLUME = "chat.viewer_volume"

class ChatPreferencesStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun loadViewerName(): String = prefs.getString(KEY_VIEWER_NAME, "")?.trim() ?: ""

    fun saveViewerName(name: String) {
        prefs.edit().putString(KEY_VIEWER_NAME, name.trim()).apply()
    }

    fun loadChatSoundEnabled(): Boolean = prefs.getBoolean(KEY_CHAT_SOUND, true)

    fun saveChatSoundEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_CHAT_SOUND, enabled).apply()
    }

    fun loadViewerVolume(): Float = prefs.getFloat(KEY_VIEWER_VOLUME, 1f).coerceIn(0f, 1f)

    fun saveViewerVolume(volume: Float) {
        prefs.edit().putFloat(KEY_VIEWER_VOLUME, volume.coerceIn(0f, 1f)).apply()
    }
}
