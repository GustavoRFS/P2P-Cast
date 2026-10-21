import { defineConfig } from "vitest/config";

// Unit tests cover the platform-agnostic modules in src/lib.
export default defineConfig({
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
});
