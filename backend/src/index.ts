import { Elysia } from "elysia";
import { cors } from "@elysia/cors";
import { getConfig } from "./config";
import { createAuthRoutes } from "./auth";
import { createPresenceRouter } from "./presence";

const config = getConfig();
const auth = createAuthRoutes(config);

const app = new Elysia()
    .use(cors({
        origin: [...config.appOrigins],
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Authorization", "Content-Type"],
        credentials: false,
        maxAge: 600,
    }))
    .get("/health", () => ({ ok: true }))
    .use(auth.router)
    .use(createPresenceRouter(config, auth.verifyAccessToken))
    .listen(config.port);

console.log(`P2P-Cast backend listening at ${app.server?.hostname}:${app.server?.port}`);
