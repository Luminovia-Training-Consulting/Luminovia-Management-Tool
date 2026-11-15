import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import { validatePublicConfig } from "./scripts/public-config.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig(({ mode }) => {
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
          globPatterns: ["**/*.{js,css,html,woff2,png,webp,ico}"],
          navigateFallback: "/index.html",
          cleanupOutdatedCaches: true,
          runtimeCaching: [],
          navigateFallbackDenylist: [/^\/auth\//, /^\/rest\//, /^\/storage\//],
        },
      }),
    ],
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.{ts,tsx}"],
      clearMocks: true,
    },
    build: { chunkSizeWarningLimit: 1000 },
  };
});
