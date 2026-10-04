import { fileURLToPath } from "node:url";

export type BackendConfig = {
    port: number;
    publicUrl: string;
    discordClientId: string;
    discordClientSecret: string;
    discordRedirectUri: string;
    jwtSecret: string;
    whitelistPath: string;
    appOrigins: Set<string>;
};

const defaultWhitelistPath = fileURLToPath(new URL("../whitelist.json", import.meta.url));

function required(name: string): string {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable: ${name}`);
    return value;
}

function getPort(): number {
    const raw = process.env.PORT?.trim() || "3001";
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("PORT must be an integer between 1 and 65535");
    }
    return port;
}

export function getConfig(): BackendConfig {
    const development = process.env.NODE_ENV === "development";
    const publicUrl = development ? process.env.PUBLIC_URL?.trim() || "http://localhost:3001" : required("PUBLIC_URL");
    const discordClientId = development ? process.env.DISCORD_CLIENT_ID?.trim() || "development-client-id" : required("DISCORD_CLIENT_ID");
    const discordClientSecret = development ? process.env.DISCORD_CLIENT_SECRET?.trim() || "development-client-secret" : required("DISCORD_CLIENT_SECRET");
    const discordRedirectUri = process.env.DISCORD_REDIRECT_URI?.trim()
        || `${publicUrl.replace(/\/$/, "")}/auth/discord/callback`;
    const jwtSecret = development ? process.env.JWT_SECRET?.trim() || "local-development-secret-change-this-32-chars" : required("JWT_SECRET");
    if (jwtSecret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");

    const originValues = process.env.APP_ORIGINS?.split(",")
        .map(origin => origin.trim())
        .filter(Boolean)
        ?? ["p2pcast-app://desktop", "http://tauri.localhost", "tauri://localhost", "http://127.0.0.1:5173", "http://localhost:5173"];

    return {
        port: getPort(),
        publicUrl: publicUrl.replace(/\/$/, ""),
        discordClientId,
        discordClientSecret,
        discordRedirectUri,
        jwtSecret,
        whitelistPath: process.env.WHITELIST_PATH?.trim() || defaultWhitelistPath,
        appOrigins: new Set(originValues),
    };
}
