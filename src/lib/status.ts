import type { AppError } from "../types";

export function getMediaError(error: unknown): AppError {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
        return {
            title: "Permissão necessária",
            message: "Permita o compartilhamento de tela para iniciar a transmissão.",
        };
    }

    if (error instanceof DOMException && error.name === "NotFoundError") {
        return {
            title: "Nenhuma tela disponível",
            message: "O navegador não encontrou uma tela ou janela para compartilhar.",
        };
    }

    if (error instanceof TypeError) {
        return {
            title: "Navegador incompatível",
            message: "O compartilhamento precisa ser aberto em HTTPS ou em localhost.",
        };
    }

    return {
        title: "Não foi possível iniciar",
        message: "O navegador recusou a captura de tela. Tente novamente.",
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
