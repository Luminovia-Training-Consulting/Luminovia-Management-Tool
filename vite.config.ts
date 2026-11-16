/**
 * Gemeinsame Vite-/Vitest-Konfiguration: öffentliche Buildwerte, statische PWA
 * und isolierte Komponentenprüfungen. Private Backenddaten gehören in keinen Cache.
 */
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { validatePublicConfig } from "./scripts/public-config.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ mode }) => {
  // VITE_-Werte landen im Browserbundle. Die gemeinsame Prüfung weist dort
  // privilegierte Schlüssel ab und verlangt im Produktionsmodus echte Angaben.
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
      VitePWA({
        // Ein vorhandenes Formular soll nicht durch ein sofort aktiviertes
        // Service-Worker-Update verschwinden; die Oberfläche bietet das Update an.
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
            { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            {
              src: "/icons/maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // Nur gebaute öffentliche Dateien vorhalten. Für authentifizierte
          // API-/Storage-Antworten ist bewusst keine Laufzeitcache-Regel definiert.
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
    server: {
      watch: {
        ignored: [
          "**/.local/**",
          "**/docs/**",
          "**/playwright-report/**",
          "**/test-results/**",
          "**/coverage/**",
        ],
      },
    },
    test: {
      // Diese Suite nutzt DOM-/SDK-Fixtures. Native Auth, SQL und Browserabläufe
      // werden zusätzlich durch den verwalteten ./portal-test-Lauf geprüft.
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
          // Whole-source regression floor, measured with uncovered UI included.
          // End-to-end browser execution is not merged into these unit figures.
          statements: 46.5,
          branches: 41,
          functions: 36.5,
          lines: 48,
          "**/scripts/public-config.ts": { 100: true },
          "**/src/lib/dates.ts": { 100: true },
          "**/src/features/operations/schedule.ts": { 100: true },
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
    // Nur die Warnschwelle für Bundlegröße; dies hebt kein fachliches Testgate auf.
    build: { chunkSizeWarningLimit: 1000 },
  };
});
