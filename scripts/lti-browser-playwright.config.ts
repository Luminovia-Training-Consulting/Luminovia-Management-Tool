/** Use the normal browser profiles with only the isolated, explicitly keyed LTI fixture. */
import { defineConfig } from "@playwright/test";
import portal from "../playwright.config";

if (
  process.env.PORTAL_LTI_BROWSER_FIXTURE !== "1" ||
  !process.env.E2E_BASE_URL
) {
  throw new Error(
    "Start the isolated LTI browser fixture via node scripts/lti-browser-check.mjs.",
  );
}

export default defineConfig({
  ...portal,
  testDir: "./testing",
  testMatch: "**/lti-synthetic.spec.ts",
  reporter: [["list"]],
});
