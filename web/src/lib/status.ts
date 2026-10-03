import type { AppError } from "../types";
import type { CaptureSource } from "./capture";

export function getMediaError(error: unknown, source: CaptureSource = "screen"): AppError {
    const permissionMessage = source === "camera"
        ? "Permita o acesso à câmera e ao microfone para iniciar a transmissão."
        : source === "both"
            ? "Permita o acesso à tela, câmera e microfone para iniciar a transmissão."
            : "Permita o compartilhamento de tela para iniciar a transmissão.";

    if (error instanceof DOMException && error.name === "NotAllowedError") {
        return {
            title: "Permissão necessária",
            message: permissionMessage,
        };
    }

    if (error instanceof DOMException && error.name === "NotFoundError") {
        return {
            title: source === "camera" ? "Nenhuma câmera disponível" : "Nenhuma fonte disponível",
            message: source === "camera"
                ? "O navegador não encontrou uma câmera ou microfone disponíveis."
                : "O navegador não encontrou uma tela, câmera ou microfone disponíveis.",
        };
    }

    if (error instanceof TypeError && error.message === "Screen capture is not supported") {
        return {
            title: "Compartilhamento de tela indisponível",
            message: "Este navegador não permite compartilhar a tela (comum em navegadores mobile, como Chrome para Android). Escolha a fonte \"Câmera\" nas configurações da transmissão.",
        };
    }

    if (error instanceof TypeError) {
        return {
            title: "Navegador incompatível",
            message: "A captura de mídia precisa ser aberta em HTTPS ou em localhost.",
        };
    }

    return {
        title: "Não foi possível iniciar",
        message: "O navegador recusou a captura de mídia. Tente novamente.",
    };
}

export function getPeerError(error: unknown): AppError {
    const type = typeof error === "object" && error !== null && "type" in error
        ? String(error.type)
        : "";

    switch (type) {
        case "peer-unavailable":
            return {
                title: "Transmissão não encontrada",
                message: "O link pode ter expirado ou o transmissor encerrou a sessão.",
            };
        case "network":
        case "server-error":
        case "socket-error":
        case "socket-closed":
            return {
                title: "Sinalização indisponível",
                message: "Não foi possível conversar com o serviço de sinalização do PeerJS.",
            };
        case "ssl-unavailable":
            return {
                title: "Conexão segura indisponível",
                message: "O PeerJS Cloud exige uma conexão HTTPS disponível.",
            };
        case "browser-incompatible":
            return {
                title: "Navegador incompatível",
                message: "Este navegador não oferece os recursos WebRTC necessários.",
            };
        case "webrtc":
            return {
                title: "A conexão direta falhou",
                message: "A rede não permitiu uma rota P2P direta. Tente outra rede ou VPN.",
            };
        default:
            return {
                title: "Não foi possível conectar",
                message: "A conexão com a transmissão foi interrompida. Tente novamente.",
            };
    }
}
