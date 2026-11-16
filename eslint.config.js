/** ESLint-Grenzen für Browser, Node-Werkzeuge und gemeinsam genutzte Konfiguration. */
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import refresh from "eslint-plugin-react-refresh";
export default tseslint.config(
  {
    // Edge-Code hat Deno-Lint im Gesamtprüflauf; die gepinnte Upstream-Kopie
    // und erzeugte/private Dateien werden nicht nach lokalen JS-Regeln verändert.
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
    // Wartungs-/Testprogramme laufen unter Node, nicht in einer Browserumgebung.
    languageOptions: { globals: globals.node },
  },
  {
    files: ["scripts/local-capture.mjs"],
    // Das Werkzeug enthält auch Code, den Playwright innerhalb der Seite ausführt.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    // Hook-Abhängigkeiten und Fast-Refresh-Verträge gelten für den React-Quellbaum.
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
