/**
 * Shared Vite/Vitest configuration: public build values, static PWA assets
 * and isolated component tests. Private backend responses must not be cached.
 */
import {defineConfig} from "vitest/config";
import {loadEnv} from "vite";
import {validatePublicConfig} from "./scripts/public-config.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {VitePWA} from "vite-plugin-pwa";
import {resolve} from "node:path";

export default defineConfig(({mode}) => {
    // VITE_ values enter the browser bundle. The shared validator rejects
    // privileged keys and requires public configuration for production builds.
    const env = loadEnv(mode, process.cwd(), "VITE_");
    validatePublicConfig(
        env.VITE_SUPABASE_URL,
        env.VITE_SUPABASE_PUBLISHABLE_KEY,
        mode === "production",
    );
    return {
        plugins: [
            react(),
            tailwindcss(),
            {
                name: "portal-owned-output-watch",
                configResolved(config) {
                    if (config.server.watch === null) return;
                    const previous = config.server.watch?.ignored;
                    config.server.watch = {
                        ...config.server.watch,
                        ignored: [
                            ...(previous
                                ? Array.isArray(previous)
                                    ? previous
                                    : [previous]
                                : []),
                            ...[
                                ".local",
                                "docs",
                                "playwright-report",
                                "test-results",
                                "coverage",
                            ].map((directory) => `${resolve(config.root, directory)}/**`),
                        ],
                    };
                },
            },
            VitePWA({
                // Do not discard an in-progress form by immediately activating a new
                // service worker; the interface offers the update to the user.
                registerType: "prompt",
                includeAssets: ["icons/*.png", "brand/*.woff2", "brand/*.webp"],
                manifest: {
                    name: "Luminovia Portal",
                    short_name: "Luminovia",
                    description: "Training & Consulting · Portal",
                    lang: "de",
                    start_url: "/",
                    scope: "/",
                    display: "standalone",
                    theme_color: "#172b4b",
                    background_color: "#f8f5ee",
                    icons: [
                        {src: "/icons/icon-192.png", sizes: "192x192", type: "image/png"},
                        {src: "/icons/icon-512.png", sizes: "512x512", type: "image/png"},
                        {
                            src: "/icons/maskable-512.png",
                            sizes: "512x512",
                            type: "image/png",
                            purpose: "maskable",
                        },
                    ],
                },
                workbox: {
                    importScripts: ["/push-sw.js"],

                    // Precache built public files only. Authenticated API/Storage responses
                    // deliberately have no runtime-caching rule.
                    globPatterns: ["**/*.{js,css,html,woff2,png,webp,ico}"],
                    navigateFallback: "/index.html",
                    cleanupOutdatedCaches: true,
                    runtimeCaching: [],
                    navigateFallbackDenylist: [/^\/auth\//, /^\/rest\//, /^\/storage\//],
                },
            }),
        ],
        // Generated report HTML otherwise triggers full-page reloads despite having
        // no application import. Keep private diagnostics and QA output out of HMR.
        test: {
            // This suite uses DOM/SDK fixtures. The managed ./portal test command
            // also verifies actual Auth, SQL and browser workflows.
            environment: "jsdom",
            setupFiles: "./src/test/setup.ts",
            include: ["src/**/*.test.{ts,tsx}"],
            clearMocks: true,
            coverage: {
                provider: "v8",
                // Keep unimported application modules visible as uncovered. Browser,
                // SQL/HTTP, Edge and maintenance suites have their own acceptance gates.
                include: ["src/**/*.{ts,tsx}", "scripts/public-config.ts"],
                exclude: ["src/**/*.test.{ts,tsx}", "src/test/**", "src/**/*.d.ts"],
                reportsDirectory: "./coverage",
                reporter: ["text-summary", "html", "lcov", "json-summary", "json"],
                reportOnFailure: true,
                thresholds: {
                    // Preserve the accepted whole-source floor, including uncovered UI modules.
                    // End-to-end browser execution is not merged into these unit figures.
                    statements: 62.5,
                    branches: 56.5,
                    functions: 53,
                    lines: 64.5,
                    "**/scripts/public-config.ts": {100: true},
                    "**/src/lib/dates.ts": {100: true},
                    "**/src/features/operations/schedule.ts": {100: true},
                    // These client boundaries now cover both success and rejected-response
                    // paths; retain all measured branches when future features extend them.
                    "**/src/features/jobs/lifecycle-api.ts": {100: true},
                    "**/src/features/notifications/api.ts": {100: true},
                    "**/src/features/knowledge/content.ts": {
                        statements: 95,
                        branches: 85,
                        functions: 100,
                        lines: 95,
                    },
                    "**/src/features/files/api.ts": {
                        statements: 85,
                        branches: 85,
                        functions: 85,
                        lines: 88,
                    },
                },
            },
        },
        // This only sets the bundle-size warning limit; domain test gates still apply.
        build: {chunkSizeWarningLimit: 1000},
    };
});