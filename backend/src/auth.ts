import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { Elysia, t } from "elysia";
import { SignJWT, jwtVerify } from "jose";
import type { BackendConfig } from "./config";
import { escapeHtml, handoffResponse } from "./handoff";

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

type DesktopHost = "electron" | "tauri" | "android";

// Where each client listens for the OAuth hand-off.
const CALLBACK_SCHEMES: Record<DesktopHost, string> = {
    electron: "p2pcast",
    tauri: "p2pcast-tauri",
    android: "p2pcast-app",
};
type PendingOAuth = { challenge: string; host: DesktopHost; loopbackPort: number | null; expiresAt: number };
type PendingExchange = { user: DiscordProfile; challenge: string; expiresAt: number };

const OAUTH_STATE_TTL_MS = 5 * 60_000;
const EXCHANGE_CODE_TTL_MS = 60_000;
const DISCORD_SNOWFLAKE = /^\d{17,20}$/;
const SHA256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

function randomCode(): string {
    return randomBytes(32).toString("base64url");
}

function htmlResponse(status: number, title: string, message: string): Response {
    const escape = escapeHtml;
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
                loopbackPort: query.port ?? null,
                expiresAt: Date.now() + OAUTH_STATE_TTL_MS,
            });

            const authorizationUrl = new URL("https://discord.com/oauth2/authorize");
            authorizationUrl.searchParams.set("client_id", config.discordClientId);
            authorizationUrl.searchParams.set("response_type", "code");
            authorizationUrl.searchParams.set("scope", "identify guilds.members.read");
            authorizationUrl.searchParams.set("redirect_uri", config.discordRedirectUri);
            authorizationUrl.searchParams.set("state", state);

            set.status = 302;
            set.headers.location = authorizationUrl.toString();
            set.headers["cache-control"] = "no-store";
            return "";
        }, {
            query: t.Object({
                code_challenge: t.String({ minLength: 43, maxLength: 43 }),
                host: t.Optional(t.Union([t.Literal("electron"), t.Literal("tauri"), t.Literal("android")])),
                // Desktop apps listening on 127.0.0.1 for the code (RFC 8252 loopback redirect).
                port: t.Optional(t.Numeric({ minimum: 1024, maximum: 65535 })),
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

                const membershipResponse = await fetch(
                    `https://discord.com/api/v10/users/@me/guilds/${config.discordGuildId}/member`,
                    { headers: { authorization: `Bearer ${discordToken}` } },
                );
                if (membershipResponse.status === 403 || membershipResponse.status === 404) {
                    return htmlResponse(403, "Acesso não autorizado", "Entre no servidor Discord do P2P-Cast e tente novamente.");
                }
                if (!membershipResponse.ok) {
                    return htmlResponse(502, "Falha no login", "Não foi possível verificar sua participação no servidor Discord.");
                }

                const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
                    headers: { authorization: `Bearer ${discordToken}` },
                });
                if (!userResponse.ok) return htmlResponse(502, "Falha no login", "Não foi possível carregar a conta Discord.");

                const user = toProfile(await userResponse.json() as DiscordUserResponse);
                if (!user) return htmlResponse(502, "Falha no login", "O Discord retornou uma conta inválida.");

                for (const [code, entry] of exchangeCodes) {
                    if (entry.expiresAt <= Date.now()) exchangeCodes.delete(code);
                }

                const code = randomCode();
                exchangeCodes.set(code, { user, challenge: pendingState.challenge, expiresAt: Date.now() + EXCHANGE_CODE_TTL_MS });
                const scheme = CALLBACK_SCHEMES[pendingState.host];
                if (pendingState.loopbackPort !== null) {
                    // A plain HTTP redirect to the app's one-shot listener: no custom scheme for the
                    // browser to refuse, and the code still needs the app's PKCE verifier.
                    set.status = 302;
                    set.headers.location = `http://127.0.0.1:${pendingState.loopbackPort}/auth/callback?code=${code}`;
                    set.headers["cache-control"] = "no-store";
                    return "";
                }
                const deepLink = new URL(`${scheme}://auth/callback`);
                deepLink.searchParams.set("code", code);
                // Android's auth session intercepts the redirect itself; desktop browsers need the
                // hand-off page (see handoffResponse).
                if (pendingState.host !== "android") return handoffResponse(deepLink.toString());
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
