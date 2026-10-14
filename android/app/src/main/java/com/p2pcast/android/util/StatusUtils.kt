package com.p2pcast.android.util

import com.p2pcast.android.AppError
import com.p2pcast.android.capture.CaptureSource

/** Kotlin port of src/lib/status.ts — same error catalogue so users see
 * consistent, friendly messages regardless of which client they're on. */

enum class CaptureErrorKind { PERMISSION_DENIED, NOT_FOUND, UNSUPPORTED, UNKNOWN }

fun getMediaError(kind: CaptureErrorKind, source: CaptureSource = CaptureSource.SCREEN): AppError {
    val permissionMessage = when (source) {
        CaptureSource.CAMERA -> "Permita o acesso à câmera e ao microfone para iniciar a transmissão."
        CaptureSource.BOTH -> "Permita o acesso à tela, câmera e microfone para iniciar a transmissão."
        CaptureSource.SCREEN -> "Permita o compartilhamento de tela para iniciar a transmissão."
    }

    return when (kind) {
        CaptureErrorKind.PERMISSION_DENIED -> AppError(
            title = "Permissão necessária",
            message = permissionMessage,
        )
        CaptureErrorKind.NOT_FOUND -> AppError(
            title = if (source == CaptureSource.CAMERA) "Nenhuma câmera disponível" else "Nenhuma fonte disponível",
            message = if (source == CaptureSource.CAMERA)
                "O aparelho não encontrou uma câmera ou microfone disponíveis."
            else
                "O aparelho não encontrou uma tela, câmera ou microfone disponíveis.",
        )
        CaptureErrorKind.UNSUPPORTED -> AppError(
            title = "Recurso indisponível neste aparelho",
            message = "Este aparelho não permite compartilhar a tela. Escolha a fonte \"Câmera\" nas configurações da transmissão.",
        )
        CaptureErrorKind.UNKNOWN -> AppError(
            title = "Não foi possível iniciar",
            message = "O sistema recusou a captura de mídia. Tente novamente.",
        )
    }
}

/** Mirrors PeerJS's ServerMessageType/PeerError `type` strings so failures map
 * to the same copy the web app shows, whether they originate on our own
 * signaling client or bubble up from the peer on the other end. */
fun getPeerError(type: String?): AppError = when (type) {
    "peer-unavailable" -> AppError(
        title = "Transmissão não encontrada",
        message = "O link pode ter expirado ou o transmissor encerrou a sessão.",
    )
    "network", "server-error", "socket-error", "socket-closed" -> AppError(
        title = "Sinalização indisponível",
        message = "Não foi possível conversar com o serviço de sinalização do PeerJS.",
    )
    "ssl-unavailable" -> AppError(
        title = "Conexão de sinalização indisponível",
        message = "Não foi possível estabelecer uma conexão com o servidor PeerJS.",
    )
    "browser-incompatible" -> AppError(
        title = "Aparelho incompatível",
        message = "Este aparelho não oferece os recursos WebRTC necessários.",
    )
    "webrtc" -> AppError(
        title = "A conexão direta falhou",
        message = "A rede não permitiu uma rota P2P direta. Tente outra rede ou VPN.",
    )
    else -> AppError(
        title = "Não foi possível conectar",
        message = "A conexão com a transmissão foi interrompida. Tente novamente.",
    )
}
