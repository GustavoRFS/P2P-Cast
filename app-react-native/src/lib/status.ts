import type { AppError } from "./types";
import type { CaptureSource } from "./capture";

// DOMException only exists in browsers; touching it unguarded throws on React Native.
function isDomException(error: unknown, name?: string): error is DOMException {
    return typeof DOMException !== "undefined"
        && error instanceof DOMException
        && (name === undefined || error.name === name);
}

export function getMediaError(error: unknown, source: CaptureSource = "screen"): AppError {
    const permissionMessage = source === "camera"
        ? "Permita o acesso à câmera e ao microfone para iniciar a transmissão."
        : source === "both"
            ? "Permita o acesso à tela, câmera e microfone para iniciar a transmissão."
            : "Permita o compartilhamento de tela para iniciar a transmissão.";

    if (isDomException(error, "NotAllowedError")) {
        return {
            title: "Permissão necessária",
            message: permissionMessage,
        };
    }

    if (isDomException(error, "NotFoundError")) {
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

    if (error instanceof TypeError && error.message === "Media capture requires a secure context") {
        return {
            title: "Navegador incompatível",
            message: "A captura de mídia precisa ser aberta em HTTPS ou em localhost.",
        };
    }

    if (error instanceof TypeError && error.message === "Camera capture is not supported") {
        return {
            title: "Câmera indisponível",
            message: "Este navegador não permite usar a câmera.",
        };
    }

    const detail = describeCaptureFailure(error);
    return {
        title: "Não foi possível iniciar",
        message: detail ?? "O navegador recusou a captura de mídia. Tente novamente.",
    };
}

function describeCaptureFailure(error: unknown): string | null {
    if (isDomException(error)) {
        return error.message ? `${error.message} (${error.name})` : error.name;
    }
    if (error instanceof Error) {
        return error.message || null;
    }
    if (typeof error === "string") {
        return error.trim() || null;
    }
    return null;
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
                message: "O serviço de sinalização exige uma conexão HTTPS disponível.",
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
