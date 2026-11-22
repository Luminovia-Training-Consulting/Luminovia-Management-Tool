/** Real browser workflows on the owned QA stack, isolated from development data. */
import {defineConfig, devices} from "@playwright/test";
import {existsSync} from "node:fs";

// The launcher creates this private per-environment file; it must stay out of Git.
if (existsSync(".env.test.local")) process.loadEnvFile(".env.test.local");

// Reject direct Playwright runs against a normal persistent development stack.
if (process.env.PORTAL_TEST_MODE !== "1")
    throw new Error(
        "Browser integration tests require the isolated ./portal test command; development data are preserved.",
    );

const stage = process.env.PORTAL_BROWSER_STAGE;
if (stage && !["application", "pwa", "pwa-webkit"].includes(stage))
    throw new Error("Unknown isolated browser acceptance stage.");
const reportRoot = stage ? `.local/browser/${stage}` : undefined;

export default defineConfig({
    testDir: "./tests/e2e",
    // The shared isolated Supabase Auth service returns database errors when
    // multiple browser specs delete their fictional accounts concurrently.
    // Keep lifecycle-heavy journeys sequential; retain all desktop/mobile cases.
    fullyParallel: false,
    workers: 1,
    retries: 0,
    forbidOnly: true,
    failOnFlakyTests: true,
    timeout: 45_000,
    expect: {timeout: 10_000},
    outputDir: reportRoot ? `${reportRoot}/results` : "test-results",
    reporter: [
        ["list"],
        [
            "html",
            {
                open: "never",
                ...(reportRoot ? {outputFolder: `${reportRoot}/html`} : {}),
            },
        ],
        ...(reportRoot
            ? ([["json", {outputFile: `${reportRoot}/report.json`}]] as [
                string,
                { outputFile: string },
            ][])
            : []),
    ],
    use: {
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
        // Failure artifacts may contain private QA sessions and remain ignored.
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    ...(stage === "pwa-webkit"
        ? {grep: /@pwa-webkit/, testMatch: "**/pwa.spec.ts"}
        : {grepInvert: /@pwa-webkit/}),
    projects: stage === "pwa-webkit" ? [
        {name: "desktop-webkit", use: {...devices["Desktop Safari"]}},
    ] : [
        // Both Chromium layouts run the same journeys; this does not establish
        // physical PWA installation or Safari/iOS compatibility.
        {
            name: "desktop-chromium",
            use: {
                ...devices["Desktop Chrome"],
                viewport: {width: 1440, height: 1000},
            },
        },
        {name: "mobile-chromium", use: {...devices["Pixel 7"]}},
    ],
    webServer: process.env.E2E_BASE_URL
        ? // The complete runner owns its supervised server. Playwright starts the
          // Vite process below only when no explicit URL was supplied.
        undefined
        : {
            command: "npm run dev -- --port 5173 --strictPort",
            url: "http://127.0.0.1:5173",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
        },
});