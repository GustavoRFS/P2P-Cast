import { describe, expect, it } from "vitest";
import { getMediaError, getPeerError } from "./status";

describe("status messages", () => {
    it("explains when screen capture permission is denied", () => {
        const error = new DOMException("Permission denied", "NotAllowedError");

        expect(getMediaError(error)).toMatchObject({
            title: "Permissão necessária",
        });
    });

    it("explains when the broadcast peer is unavailable", () => {
        expect(getPeerError({ type: "peer-unavailable" })).toMatchObject({
            title: "Transmissão não encontrada",
        });
    });

    it("falls back to a useful connection error", () => {
        expect(getPeerError({ type: "webrtc" })).toMatchObject({
            title: "A conexão direta falhou",
        });
    });
});
