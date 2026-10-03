package com.p2pcast.android.capture

import org.junit.Assert.assertEquals
import org.junit.Test

class CaptureSettingsTest {
    @Test
    fun `summarizes the default settings`() {
        assertEquals(
            "tela · 1080p · 30 FPS · 6 Mbps · com áudio",
            formatCaptureSettings(CaptureSettings.DEFAULT),
        )
    }

    @Test
    fun `summarizes camera source with microphone state`() {
        val settings = CaptureSettings.DEFAULT.copy(source = CaptureSource.CAMERA, microphone = false)
        assertEquals("câmera · 1080p · 30 FPS · 6 Mbps · sem microfone", formatCaptureSettings(settings))
    }

    @Test
    fun `summarizes combined source with both audio toggles`() {
        val settings = CaptureSettings.DEFAULT.copy(
            source = CaptureSource.BOTH,
            screenAudio = false,
            microphone = true,
        )
        assertEquals(
            "tela + câmera · 1080p · 30 FPS · 6 Mbps · sem áudio da tela · microfone",
            formatCaptureSettings(settings),
        )
    }

    @Test
    fun `falls back to automatic bitrate label`() {
        val settings = CaptureSettings.DEFAULT.copy(bitrate = null)
        assertEquals("tela · 1080p · 30 FPS · Automático · com áudio", formatCaptureSettings(settings))
    }

    @Test
    fun `expands a combined source into screen and camera tracks`() {
        assertEquals(listOf(CaptureTrackSource.SCREEN), CaptureSource.SCREEN.tracks())
        assertEquals(listOf(CaptureTrackSource.CAMERA), CaptureSource.CAMERA.tracks())
        assertEquals(listOf(CaptureTrackSource.SCREEN, CaptureTrackSource.CAMERA), CaptureSource.BOTH.tracks())
    }
}
