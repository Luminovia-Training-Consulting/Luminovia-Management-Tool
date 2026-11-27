/**
 * Shared Vite/Vitest configuration: public build values, static PWA assets
 * and isolated component tests. Private backend responses must not be cached.
 */
import { defineConfig } from "vitest/config";
import { loadEnv, type Connect } from "vite";
import { validatePublicConfig } from "./scripts/public-config.ts";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { resolve } from "node:path";
import {
  internalExplorerDocument,
  portalOpenApi,
} from "./src/features/developer-api/contract.ts";
import {
  academyExplorerOpenApi,
  academyOpenApi,
} from "./src/features/developer-api/academy-contract.ts";
import { internalExplorerPath } from "./src/features/developer-api/catalogue-url.ts";
import { academyWorkflowIndex } from "./scripts/academy-workflows.ts";
import { academyClientAssets } from "./scripts/academy-client-assets.mjs";
import { recordAcademyBrowserModules } from "./scripts/academy-browser-inventory.ts";
import { loadAcademyBrand } from "./scripts/academy-brand-config.ts";
import editionModules from "./scripts/edition-modules.json" with { type: "json" };

// Give retired bookmarks the same result in development, preview and the PWA.
const retiredDemoPath = /^\/demo(?:[/?]|$)/i;
const rejectRetiredDemoPath: Connect.NextHandleFunction = (
  request,
  response,
  next,
) => {
  if (!retiredDemoPath.test(request.url ?? "")) return next();
  response.statusCode = 404;
  response.setHeader("Cache-Control", "no-store");
  response.end();
};

export default defineConfig(({ mode }) => {
  // VITE_ values enter the browser bundle. The shared validator rejects
  // privileged keys and requires public configuration for production builds.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  validatePublicConfig(
    env.VITE_SUPABASE_URL,
    env.VITE_SUPABASE_PUBLISHABLE_KEY,
    mode === "production",
  );
  const { brand, assets: brandAssets } = loadAcademyBrand(
    process.env.PORTAL_ACADEMY_BRAND_FILE,
    resolve("public"),
  );
  const assets = new Map(brandAssets);
  const internal = brand.edition === "internal";
  const deliveryTrace = !internal && process.env.PORTAL_ACADEMY_DELIVERY_TRACE;
  const webManifest = {
    name: brand.name,
    short_name: brand.shortName,
    description: internal ? "Training & Consulting · Portal" : brand.name,
    lang: brand.defaultLanguage,
    start_url: "/",
    scope: "/",
    display: "standalone" as const,
    theme_color: brand.themeColor,
    background_color: "#f8f5ee",
    icons: [...brand.pwaIcons],
  };
  if (!internal) {
    // The PWA plugin automatically precaches the manifest it emits. Academies
    // serve the live manifest through ingress and package these bytes for fallback.
    assets.set(
      "manifest.webmanifest",
      Buffer.from(JSON.stringify(webManifest) + "\n"),
    );
  }
  const internalOnlyModule =
    /\/(?:data\/native-rpc\.generated\.json|src\/(?:app\/portal-routes\.tsx|features\/(?:(?:accounting|commercial|jobs|replacements)\/|developer-api\/(?:accounting-contract|commercial-records-contract|contract|portal-explorer|native-contract)\.|help\/catalog\.ts|learning\/destinations\.tsx|workbench\/finance-)))/;
  const escapeHtml = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const openApiPath = "/api/openapi.json";
  const backend = env.VITE_SUPABASE_URL ?? "";
  const academyExplorer = academyExplorerOpenApi(backend, brand);
  const academyDocument = !internal ? academyOpenApi(backend, brand) : null;
  const openApiDocument =
    academyDocument ?? portalOpenApi(backend, true, brand);
  const openApi =
    JSON.stringify(openApiDocument, null, internal ? 0 : 2) + "\n";
  const internalExplorer = internal
    ? JSON.stringify(internalExplorerDocument(backend, brand)) + "\n"
    : null;
  if (academyDocument) {
    assets.set(
      "api/workflows.json",
      Buffer.from(
        JSON.stringify(
          academyWorkflowIndex(academyDocument, academyExplorer),
          null,
          2,
        ) + "\n",
      ),
    );
    for (const [path, source] of academyClientAssets(academyDocument))
      assets.set(path, Buffer.from(source));
  }
  return {
    publicDir: internal ? "public" : false,
    // Both editions load Swagger lazily. Prebundle its UMD entry on startup
    // so the first API visit cannot rediscover it and invalidate dependency URLs.
    optimizeDeps: { include: ["swagger-ui-dist/swagger-ui-bundle.js"] },
    resolve: {
      // Resolve the edition before tracing imports and precache assets.
      alias: Object.fromEntries(
        Object.entries(editionModules).map(([name, modules]) => [
          name,
          resolve(internal ? modules.internal : modules.academy),
        ]),
      ),
    },
    define: {
      __PORTAL_INSTALLATION_BRAND__: JSON.stringify(brand),
      __PORTAL_INTERNAL_EDITION__: JSON.stringify(internal),
      __PORTAL_ACADEMY_EXPLORER__: JSON.stringify(academyExplorer),
    },
    ...(!internal && {
      server: {
        fs: {
          deny: [
            ".env",
            ".env.*",
            "*.{crt,pem}",
            "**/.git/**",
            "**/public/brand/luminovia-logo-*",
            "**/public/icons/**",
          ],
        },
      },
    }),
    plugins: [
      {
        name: "portal-retired-demo-path",
        configureServer(server) {
          server.middlewares.use(rejectRetiredDemoPath);
        },
        configurePreviewServer(server) {
          server.middlewares.use(rejectRetiredDemoPath);
        },
      },
      {
        name: "portal-local-reset",
        async configureServer(server) {
          const supervisor = process.env.PORTAL_LOCAL_RESET_SUPERVISOR;
          const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
          if (!internal || !supervisor || !key) return;
          const { configureLocalReset } =
            await import("./scripts/admin-local-reset.mjs");
          configureLocalReset(server, key, supervisor);
        },
      },
      react(),
      tailwindcss(),
      {
        name: "portal-academy-assets",
        transformIndexHtml(html) {
          if (internal) return html;
          const description =
            brand.defaultLanguage === "de"
              ? `${brand.name} · Kurse und Lernbereiche`
              : `${brand.name} · Courses and learning workspaces`;
          const branded = html
            .replace('lang="de"', `lang="${brand.defaultLanguage}"`)
            .replace(
              "<title>Luminovia Portal</title>",
              `<title>${escapeHtml(brand.name)}</title>`,
            )
            .replace('content="#172b4b"', `content="${brand.themeColor}"`)
            .replace(
              "Luminovia Portal – gemeinsam lehren, lernen und organisieren.",
              escapeHtml(description),
            )
            .replace(
              "</head>",
              '  <link rel="manifest" href="/manifest.webmanifest">\n  </head>',
            );
          return branded;
        },
        configureServer(server) {
          if (internal) return;
          // Serve the same reviewed assets in isolated previews without exposing the vendor public directory.
          server.middlewares.use((req, res, next) => {
            const path = req.url?.split("?")[0]?.slice(1) ?? "";
            const bytes = assets.get(path);
            if (!bytes || (req.method !== "GET" && req.method !== "HEAD"))
              return next();
            const contentType = path.endsWith(".png")
              ? "image/png"
              : path.endsWith(".woff2")
                ? "font/woff2"
                : path.endsWith(".js")
                  ? "text/javascript"
                  : path === "manifest.webmanifest"
                    ? "application/manifest+json"
                    : path.endsWith(".json")
                      ? "application/json; charset=utf-8"
                      : "text/plain; charset=utf-8";
            res.setHeader("Content-Type", contentType);
            res.setHeader("X-Content-Type-Options", "nosniff");
            if (path.startsWith("api/"))
              res.setHeader("Cache-Control", "no-store");
            res.end(req.method === "HEAD" ? undefined : bytes);
          });
        },
        generateBundle(_options, output) {
          if (deliveryTrace) recordAcademyBrowserModules(output, deliveryTrace);
          if (!internal) {
            for (const entry of Object.values(output)) {
              if (entry.type !== "chunk") continue;
              for (const [id, module] of Object.entries(entry.modules)) {
                if (module.renderedLength > 0 && internalOnlyModule.test(id)) {
                  this.error(
                    `Academy browser output includes an internal module: ${id.split("/").at(-1)}`,
                  );
                }
              }
            }
          }
          for (const [fileName, source] of assets) {
            this.emitFile({ type: "asset", fileName, source });
          }
        },
      },
      {
        name: "portal-openapi-document",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const path = req.url?.split("?")[0];
            const document =
              path === openApiPath
                ? openApi
                : path === internalExplorerPath
                  ? internalExplorer
                  : null;
            if (
              document === null ||
              (req.method !== "GET" && req.method !== "HEAD")
            )
              return next();
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(req.method === "HEAD" ? undefined : document);
          });
        },
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: openApiPath.slice(1),
            source: openApi,
          });
          if (internalExplorer !== null)
            this.emitFile({
              fileName: internalExplorerPath.slice(1),
              type: "asset",
              source: internalExplorer,
            });
        },
      },
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
        ...(internal && {
          includeAssets: ["icons/icon-*.png", "brand/*.woff2", "brand/*.webp"],
        }),
        manifest: internal ? webManifest : false,
        workbox: {
          importScripts: ["/push-sw.js"],
          ...(deliveryTrace ? { sourcemap: true } : {}),

          // Precache built public files only. Authenticated API/Storage responses
          // deliberately have no runtime-caching rule.
          globPatterns: ["**/*.{js,css,html,woff2,png,webp,ico}"],
          globIgnores: [
            // The link used by Safari stays available on the origin. Only
            // cache the manifest icons needed by the installable app shell.
            "icons/apple-touch-icon.png",
            // The internal manifest uses the same source for both 512 px
            // purposes. Keep the old URL for existing clients without caching it twice.
            ...(internal ? ["icons/maskable-512.png"] : []),
            "**/explorer-*.{js,css}",
            "**/portal-explorer-*.{js,css}",
            "**/academy-explorer-*.{js,css}",
            "**/standalone-swagger-*.{js,css}",
            "**/swagger-view-*.{js,css}",
            // Spreadsheet processing is loaded on demand during online imports.
            "**/attendance-xlsx-*.js",
            // Private company contracts cannot be viewed or filed offline.
            "**/company-contracts-*.js",
            // Live training workflows fetch actor-scoped data on demand.
            "**/training-control-*.js",
            "**/course-creator-drafts-*.js",
            "**/delivery-disclosure-*.js",
            "**/structured-delivery-*.{js,css}",
            "**/training-commercial-*.{js,css}",
            "**/training-course-preset-*.{js,css}",
            "**/expense-panel-*.{js,css}",
            // These private LMS workflows require a live session and load on entry.
            "**/portfolio-*.js",
            "**/peer-feedback-*.js",
            "**/course-text-exam-*.js",
            "**/text-exam-grade-import-panel-*.js",
            "**/grade-import-dialog-*.js",
            "**/assignment-grade-import-panel-*.js",
            "**/programme-path-exceptions-*.js",
            "**/programme-curriculum-editor-*.js",
            "**/course-xapi-export-*.js",
            "**/course-completion-policy-*.js",
            // Packet review and conversion are loaded when explicitly used.
            "**/scorm-package-*.js",
            "**/scorm-package-review-*.js",
            "**/scorm-package-i18n-*.js",
            "**/course-scorm-player-*.js",
            "**/scorm-course-api-*.js",
            "**/scorm-static-package-*.js",
            "**/active-scorm-player-*.js",
            "**/h5p-import-*.js",
            "**/h5p-question-import-panel-*.js",
            "**/course-package-archive-*.js",
            "**/course-assignment-teams-*.js",
            "**/course-assignments-*.js",
            "**/course-assignments-i18n-*.js",
            "**/course-curriculum-catalogue-*.js",
            "**/curriculum-merge-*.js",
            "**/competencies-*.js",
            "**/course-h5p-playback-*.js",
            // The learning hub requests current course and file rights online.
            "**/material-library-*.js",
            "**/h5p-playback-i18n-*.js",
            "**/h5p-playback-schema-*.js",
            "**/h5p-runtime-package-*.js",
            "**/lti-course-*.js",
            "**/course-weighted-gradebook-*.js",
            "**/exam-grade-import-panel-*.js",
            "**/programme-grade-report-*.js",
            // Shared by the on-demand archive tools and XLSX import/export.
            "**/zip.js-*.js",
          ],
          navigateFallback: "/index.html",
          cleanupOutdatedCaches: true,
          runtimeCaching: [],
          navigateFallbackDenylist: [
            retiredDemoPath,
            /^\/backend(?:\/|$)/,
            /^\/__portal(?:\/|$)/,
            /^\/auth\//,
            /^\/rest\//,
            /^\/storage\//,
            /^\/functions\//,
            /^\/lti\/authorize$/,
            /^\/realtime\//,
            /^\/api\/(?:openapi|explorer)\.json$/,
            /^\/api\/client\.(?:ts|py)(?:\?|$)/,
            ...(!internal
              ? [
                  /^\/(?:manifest\.webmanifest|icons\/apple-touch-icon\.png)(?:\?|$)/,
                ]
              : []),
          ],
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
      ...(process.env.CI !== "true" && { maxWorkers: 2 }),
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
          "**/scripts/public-config.ts": { 100: true },
          "**/src/lib/dates.ts": { 100: true },
          "**/src/features/operations/schedule.ts": { 100: true },
          // These client boundaries now cover both success and rejected-response
          // paths; retain all measured branches when future features extend them.
          "**/src/features/jobs/lifecycle-api.ts": { 100: true },
          "**/src/features/notifications/api.ts": { 100: true },
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
    build: { chunkSizeWarningLimit: 1000 },
  };
});
