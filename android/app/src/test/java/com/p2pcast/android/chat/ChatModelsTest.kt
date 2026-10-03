package com.p2pcast.android.chat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatModelsTest {
    @Test
    fun `keeps a trimmed custom name`() {
        assertEquals("Ana", resolveAuthorName("  Ana  ", 3))
    }

    @Test
    fun `falls back to a numbered viewer label when blank`() {
        assertEquals("Espectador 2", resolveAuthorName("", 2))
        assertEquals("Espectador 2", resolveAuthorName("   ", 2))
        assertEquals("Espectador 5", resolveAuthorName(null, 5))
    }

    @Test
    fun `truncates names longer than 40 characters`() {
        val longName = "a".repeat(60)
        assertEquals(longName.take(40), resolveAuthorName(longName, 1))
    }

    @Test
    fun `trims surrounding whitespace from chat text`() {
        assertEquals("oi galera", sanitizeChatText("  oi galera  "))
    }

    @Test
    fun `truncates text longer than the max message length`() {
        val longText = "x".repeat(CHAT_MAX_MESSAGE_LENGTH + 50)
        assertEquals(longText.take(CHAT_MAX_MESSAGE_LENGTH), sanitizeChatText(longText))
    }

    @Test
    fun `returns an empty string for blank input`() {
        assertEquals("", sanitizeChatText("   "))
    }

    @Test
    fun `builds a message carrying the given text, author and role`() {
        val message = buildChatMessage(text = "oi", authorName = "Ana", isBroadcaster = false)

        assertEquals("oi", message.text)
        assertEquals("Ana", message.authorName)
        assertFalse(message.isBroadcaster)
        assertTrue(message.id.isNotEmpty())
        assertTrue(message.timestamp > 0)
    }

    @Test
    fun `only notifies when an incoming message arrives while chat is hidden`() {
        assertTrue(shouldPlayChatNotification(chatOpen = false, soundEnabled = true))
        assertFalse(shouldPlayChatNotification(chatOpen = true, soundEnabled = true))
        assertFalse(shouldPlayChatNotification(chatOpen = false, soundEnabled = false))
    }
}
