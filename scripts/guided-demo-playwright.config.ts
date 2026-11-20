/** Browser-only acceptance for the public fictional demo and help pages. */
import {defineConfig, devices} from "@playwright/test";
import {fileURLToPath} from "node:url";

// Public demo/help acceptance deliberately needs no account, database, hosted
// configuration or development stack. The ordinary isolated suite discovers
// the same spec through its existing config as well.
export default defineConfig({
    testDir: "../tests/e2e",
    testMatch: "guided-demo.spec.ts",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 45_000,
    expect: {timeout: 10_000},
    reporter: "list",
    outputDir: "../.local/guided-demo-test-results",
    use: {
        baseURL: "http://127.0.0.1:6273",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [
        {
            name: "desktop-chromium",
            use: {
                ...devices["Desktop Chrome"],
                viewport: {width: 1440, height: 1000},
            },
        },
        {name: "mobile-chromium", use: {...devices["Pixel 7"]}},
    ],
    webServer: {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        command:
            "npx --no-install vite --mode demo-qa --host 127.0.0.1 --port 6273 --strictPort",
        url: "http://127.0.0.1:6273",
        // Own this Vite process rather than reusing a potentially configured portal.
        reuseExistingServer: false,
        timeout: 30_000,
        env: {
            // Keep configuration syntactically present without providing a working
            // backend or credentials. The spec also detects attempted backend calls.
            VITE_SUPABASE_URL: "http://127.0.0.1:9",
            VITE_SUPABASE_PUBLISHABLE_KEY:
                "sb_publishable_fictional_demo_browser_acceptance_only",
        },
    },
});