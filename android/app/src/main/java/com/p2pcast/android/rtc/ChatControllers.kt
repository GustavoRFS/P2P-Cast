package com.p2pcast.android.rtc

import com.p2pcast.android.chat.ChatMessage
import com.p2pcast.android.chat.buildChatMessage
import com.p2pcast.android.chat.sanitizeChatText
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Shared [ChatController] implementation for both broadcaster and viewer —
 * they differ only in who they call to actually transmit a sent message. */
class SimpleChatController(
    private val selfAuthorName: () -> String,
    private val isBroadcaster: Boolean,
    private val onSend: (text: String, viewerName: String?) -> Unit,
) : ChatController {
    private val _messages = MutableStateFlow<List<DisplayChatMessage>>(emptyList())
    override val messages: StateFlow<List<DisplayChatMessage>> = _messages.asStateFlow()

    private val _canSend = MutableStateFlow(false)
    override val canSend: StateFlow<Boolean> = _canSend.asStateFlow()

    fun setCanSend(value: Boolean) {
        _canSend.value = value
    }

    fun receive(message: ChatMessage, isSelf: Boolean) {
        _messages.value = _messages.value + DisplayChatMessage(message, isSelf)
    }

    override fun send(text: String, viewerName: String?) {
        val sanitized = sanitizeChatText(text)
        if (sanitized.isEmpty()) return

        val authorName = viewerName?.trim()?.takeIf { it.isNotEmpty() } ?: selfAuthorName()
        val message = buildChatMessage(sanitized, authorName, isBroadcaster)
        receive(message, isSelf = true)
        onSend(sanitized, viewerName)
    }

    fun reset() {
        _messages.value = emptyList()
        _canSend.value = false
    }
}
