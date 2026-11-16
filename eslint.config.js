/** ESLint boundaries for browser code, Node tools and shared configuration. */
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import refresh from "eslint-plugin-react-refresh";
export default tseslint.config(
  {
    // The complete runner uses Deno lint for Edge source; pinned upstream source
    // and generated/private files are excluded from local JS lint rules.
    ignores: [
      "dist",
      ".local",
      "node_modules",
      "supabase/functions",
      "deploy/hostinger/supabase/upstream",
      "playwright-report",
      "test-results",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "deploy/hostinger/**/*.mjs", "*.{js,ts}"],
    // Maintenance and test programs run in Node, not in the browser.
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/local-capture.mjs"],
    // This tool also includes code that Playwright executes inside the page.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Hook dependencies and Fast Refresh contracts apply to React source.
    plugins: { "react-hooks": hooks, "react-refresh": refresh },
    rules: {
      ...hooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },
);
