package com.p2pcast.android.util

import com.p2pcast.android.capture.CaptureSource
import org.junit.Assert.assertEquals
import org.junit.Test

class StatusUtilsTest {
    @Test
    fun `explains when screen capture permission is denied`() {
        assertEquals("Permissão necessária", getMediaError(CaptureErrorKind.PERMISSION_DENIED).title)
    }

    @Test
    fun `explains when camera capture permission is denied`() {
        val error = getMediaError(CaptureErrorKind.PERMISSION_DENIED, CaptureSource.CAMERA)
        assertEquals("Permissão necessária", error.title)
        assertEquals("Permita o acesso à câmera e ao microfone para iniciar a transmissão.", error.message)
    }

    @Test
    fun `explains when the broadcast peer is unavailable`() {
        assertEquals("Transmissão não encontrada", getPeerError("peer-unavailable").title)
    }

    @Test
    fun `falls back to a useful connection error for webrtc failures`() {
        assertEquals("A conexão direta falhou", getPeerError("webrtc").title)
    }

    @Test
    fun `falls back to a generic error for an unknown type`() {
        assertEquals("Não foi possível conectar", getPeerError(null).title)
    }
}
