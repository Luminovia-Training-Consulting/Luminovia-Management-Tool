/**
 * Fast local source acceptance for ./portal check, without starting services.
 * This complements the isolated database/API/browser suite in ./portal test;
 * a passing source/build check does not certify those backend paths.
 */
import {
  cleanEnvironment,
  command,
  ensureDependencies,
  root,
} from "./runtime-lib.mjs";

/**
 * Runs existing repository gates sequentially and stops on the first failure.
 * Dependency setup and command execution are injectable for orchestration tests;
 * ordinary CLI use retains the shared process timeout and sanitisation contract.
 */
export async function runLocalCheck({
  run = command,
  ensure = ensureDependencies,
  report = console.log,
} = {}) {
  await ensure();
  const steps = [
    ["Typecheck", "npm", ["run", "typecheck"]],
    ["Lint", "npm", ["run", "lint"]],
    ["Source formatting", "npm", ["run", "format:check"]],
    [
      "GitHub configuration formatting",
      "npx",
      ["--no-install", "prettier", "--check", ".github"],
    ],
    [
      "Code quality",
      process.execPath,
      ["scripts/code-integrity.mjs", "--exports"],
    ],
    ["Tests and coverage", "npm", ["run", "test:coverage"]],
    ["Build", "npm", ["run", "build"]],
  ];
  for (const [label, file, args] of steps) {
    report(`Local check: ${label}`);
    await run(file, args, {
      cwd: root,
      // Synthetic public values override inherited/backend build settings.
      // No real endpoint, cloud credential or running database is needed.
      env: cleanEnvironment(
        label === "Build"
          ? {
              VITE_SUPABASE_URL: "https://local-check.example.invalid",
              VITE_SUPABASE_PUBLISHABLE_KEY:
                "sb_publishable_local_check_fictional_build_only",
            }
          : {},
      ),
      timeoutMs: 600000,
    });
  }
  report(
    "Local source, test and build checks passed. For database/API/browser checks: ./portal test.",
  );
}
