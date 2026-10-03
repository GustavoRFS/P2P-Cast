package com.p2pcast.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RoomUtilsTest {
    @Test
    fun `builds a viewer link with the peer id`() {
        assertEquals(
            "https://p2p.example/?watch=abc-123",
            buildWatchUrl("https://p2p.example", "abc-123"),
        )
    }

    @Test
    fun `reads a trimmed watch id from a query string`() {
        assertEquals("abc-123", parseWatchId("?watch=%20abc-123%20"))
    }

    @Test
    fun `reads a watch id from a full shared url`() {
        assertEquals("abc-123", parseWatchId("https://p2p.example/?watch=abc-123"))
    }

    @Test
    fun `treats a bare code with no query string as the id itself`() {
        assertEquals("abc-123", parseWatchId("abc-123"))
    }

    @Test
    fun `returns null for a url with no watch param`() {
        assertNull(parseWatchId("https://p2p.example/"))
    }

    @Test
    fun `returns null for blank input`() {
        assertNull(parseWatchId(""))
        assertNull(parseWatchId("   "))
    }
}
