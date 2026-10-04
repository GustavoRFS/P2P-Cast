import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Elysia, t } from "elysia";
import { SignJWT, jwtVerify } from "jose";
import type { BackendConfig } from "./config";

export type DiscordProfile = {
    id: string;
    username: string;
    avatar: string | null;
};

type DiscordUserResponse = {
    id?: unknown;
    username?: unknown;
    global_name?: unknown;
    avatar?: unknown;
};

type DesktopHost = "electron" | "tauri";
type PendingOAuth = { challenge: string; host: DesktopHost; expiresAt: number };
type PendingExchange = { user: DiscordProfile; challenge: string; expiresAt: number };

const OAUTH_STATE_TTL_MS = 5 * 60_000;
const EXCHANGE_CODE_TTL_MS = 60_000;
const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const SHA256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

function randomCode(): string {
    return randomBytes(32).toString("base64url");
}

function htmlResponse(status: number, title: string, message: string): Response {
    const escape = (value: string) => value.replace(/[&<>"']/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]!);
    return new Response(
        `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><body style="font:16px system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem;background:#07111f;color:#edf5ff"><h1>${escape(title)}</h1><p>${escape(message)}</p><p>Você pode fechar esta aba e voltar ao P2P-Cast.</p></body></html>`,
        { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
    );
}

function digestVerifier(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
}

function secureTextEqual(left: string, right: string): boolean {
    const leftBytes = Buffer.from(left);
    const rightBytes = Buffer.from(right);
    return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function readWhitelist(path: string): Promise<Set<string>> {
    let raw: string;
    try {
        raw = await readFile(path, "utf8");
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return new Set();
        throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(value => typeof value === "string" && DISCORD_SNOWFLAKE.test(value))) {
        throw new Error("Whitelist must be a JSON array of Discord user IDs");
    }
    return new Set(parsed);
}

function toProfile(user: DiscordUserResponse): DiscordProfile | null {
    if (typeof user.id !== "string" || !DISCORD_SNOWFLAKE.test(user.id) || typeof user.username !== "string") {
        return null;
    }

    const name = typeof user.global_name === "string" && user.global_name.trim()
        ? user.global_name.trim()
        : user.username;
    const avatarHash = typeof user.avatar === "string" ? user.avatar : null;
    const extension = avatarHash?.startsWith("a_") ? "gif" : "png";

    return {
        id: user.id,
        username: name.slice(0, 80),
        avatar: avatarHash ? `https://cdn.discordapp.com/avatars/${user.id}/${avatarHash}.${extension}?size=96` : null,
    };
}

export function createAuthRoutes(config: BackendConfig) {
    const oauthStates = new Map<string, PendingOAuth>();
    const exchangeCodes = new Map<string, PendingExchange>();
    const signingKey = new TextEncoder().encode(config.jwtSecret);

    const verifyAccessToken = async (token: string): Promise<DiscordProfile | null> => {
        try {
            const { payload } = await jwtVerify(token, signingKey, {
                issuer: config.publicUrl,
                audience: "p2p-cast-desktop",
            });
            if (typeof payload.sub !== "string" || typeof payload.username !== "string") return null;
            return {
                id: payload.sub,
                username: payload.username,
                avatar: typeof payload.avatar === "string" ? payload.avatar : null,
            };
        } catch {
            return null;
        }
    };

    const signAccessToken = async (user: DiscordProfile) => new SignJWT({ username: user.username, avatar: user.avatar })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuer(config.publicUrl)
        .setAudience("p2p-cast-desktop")
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime("7d")
        .sign(signingKey);

    const router = new Elysia()
        .get("/auth/discord", ({ query, set }) => {
            if (!SHA256_CHALLENGE.test(query.code_challenge)) {
                set.status = 400;
                return { error: "invalid_handoff_challenge" };
            }

            for (const [state, pending] of oauthStates) {
                if (pending.expiresAt <= Date.now()) oauthStates.delete(state);
            }

            const state = randomCode();
            oauthStates.set(state, {
                challenge: query.code_challenge,
                host: query.host ?? "electron",
                expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
            });

            const authorizationUrl = new URL("https://discord.com/oauth2/authorize");
            authorizationUrl.searchParams.set("client_id", config.discordClientId);
            authorizationUrl.searchParams.set("response_type", "code");
            authorizationUrl.searchParams.set("scope", "identify");
            authorizationUrl.searchParams.set("redirect_uri", config.discordRedirectUri);
            authorizationUrl.searchParams.set("state", state);

            set.status = 302;
            set.headers.location = authorizationUrl.toString();
            set.headers["cache-control"] = "no-store";
            return "";
        }, {
            query: t.Object({
                code_challenge: t.String({ minLength: 43, maxLength: 43 }),
                host: t.Optional(t.Union([t.Literal("electron"), t.Literal("tauri")])),
            }),
        })
        .get("/auth/discord/callback", async ({ query, set }) => {
            if (query.error) return htmlResponse(400, "Login cancelado", "O Discord não concluiu o login.");

            const pendingState = oauthStates.get(query.state);
            oauthStates.delete(query.state);
            if (!pendingState || pendingState.expiresAt <= Date.now()) {
                return htmlResponse(400, "Login expirado", "Inicie novamente o login pelo P2P-Cast.");
            }
            if (!query.code) return htmlResponse(400, "Login inválido", "O Discord não retornou um código de autorização.");

            try {
                const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
                    method: "POST",
                    headers: { "content-type": "application/x-www-form-urlencoded" },
                    body: new URLSearchParams({
                        client_id: config.discordClientId,
                        client_secret: config.discordClientSecret,
                        grant_type: "authorization_code",
                        code: query.code,
                        redirect_uri: config.discordRedirectUri,
                    }),
                });
                if (!tokenResponse.ok) return htmlResponse(502, "Falha no login", "Não foi possível confirmar a conta com o Discord.");

                const tokenData: unknown = await tokenResponse.json();
                const discordToken = typeof tokenData === "object" && tokenData !== null && "access_token" in tokenData
                    && typeof tokenData.access_token === "string" ? tokenData.access_token : null;
                if (!discordToken) return htmlResponse(502, "Falha no login", "O Discord retornou uma resposta inválida.");

                const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
                    headers: { authorization: `Bearer ${discordToken}` },
                });
                if (!userResponse.ok) return htmlResponse(502, "Falha no login", "Não foi possível carregar a conta Discord.");

                const user = toProfile(await userResponse.json() as DiscordUserResponse);
                if (!user) return htmlResponse(502, "Falha no login", "O Discord retornou uma conta inválida.");
                if (!(await readWhitelist(config.whitelistPath)).has(user.id)) {
                    return htmlResponse(403, "Acesso não autorizado", "Esta conta Discord ainda não está na whitelist do P2P-Cast.");
                }

                for (const [code, entry] of exchangeCodes) {
                    if (entry.expiresAt <= Date.now()) exchangeCodes.delete(code);
                }

                const code = randomCode();
                exchangeCodes.set(code, { user, challenge: pendingState.challenge, expiresAt: Date.now() + EXCHANGE_CODE_TTL_MS });
                const scheme = pendingState.host === "electron" ? "p2pcast" : "p2pcast-tauri";
                const deepLink = new URL(`${scheme}://auth/callback`);
                deepLink.searchParams.set("code", code);
                set.status = 302;
                set.headers.location = deepLink.toString();
                set.headers["cache-control"] = "no-store";
                return "";
            } catch {
                return htmlResponse(502, "Falha no login", "O serviço do Discord não está disponível no momento.");
            }
        }, {
            query: t.Object({
                code: t.Optional(t.String({ maxLength: 512 })),
                state: t.String({ minLength: 32, maxLength: 128 }),
                error: t.Optional(t.String({ maxLength: 128 })),
            }),
        })
        .post("/auth/exchange", async ({ body, set }) => {
            const pending = exchangeCodes.get(body.code);
            exchangeCodes.delete(body.code);

            if (!pending || pending.expiresAt <= Date.now()) {
                set.status = 401;
                return { error: "invalid_or_expired_code" };
            }

            if (body.verifier.length < 43 || body.verifier.length > 128
                || !secureTextEqual(digestVerifier(body.verifier), pending.challenge)) {
                set.status = 401;
                return { error: "invalid_or_expired_code" };
            }

            const token = await signAccessToken(pending.user);
            set.headers["cache-control"] = "no-store";
            return { token, user: pending.user };
        }, {
            body: t.Object({
                code: t.String({ minLength: 32, maxLength: 128 }),
                verifier: t.String({ minLength: 43, maxLength: 128 }),
            }),
        })
        .get("/api/me", async ({ headers, set }) => {
            const token = headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
            const user = token ? await verifyAccessToken(token) : null;
            if (!user) {
                set.status = 401;
                return { error: "unauthorized" };
            }
            return { user };
        })
        .post("/api/logout", () => ({ ok: true }));

    return { router, verifyAccessToken };
}
