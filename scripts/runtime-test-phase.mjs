/** Explicit acceptance phases for independent, disposable CI runners.
 * No environment variable can reduce the default complete local command.
 * Splitting runs duplicates startup/retention, never shares private sessions.
 */
import { join, resolve } from "node:path";

const stages = [
  ["quality", "system"],
  ["runtime", "system"],
  ["coverage", "system"],
  ["audit", "system"],
  ["edge", "system"],
  ["operational", "system"],
  ["startup", "shared"],
  ["retention", "shared"],
  ["seed", "shared"],
  ["sql", "system"],
  ["api", "system"],
  ["invitation", "system"],
  ["chromium", "browser"],
  ["browser", "browser"],
  ["build", "browser"],
  ["pwa-start", "browser"],
  ["pwa", "browser"],
];

/** The public launcher imports the test runner with `test` still in argv.
 * Accept only these two owned entry points, rather than dropping an arbitrary
 * first argument or trusting a filename suffix that another caller can mimic.
 */
export function runtimeTestArguments(argv, root) {
  if (!Array.isArray(argv) || typeof argv[1] !== "string")
    throw new Error("An owned test runner entry point is required.");
  const entry = resolve(root, argv[1]);
  if (entry === join(root, "scripts/runtime-test.mjs")) return argv.slice(2);
  if (entry === join(root, "scripts/runtime-cli.mjs") && argv[2] === "test")
    return argv.slice(3);
  throw new Error("An owned test runner entry point is required.");
}

/** Validate the entire argument list before allocating locks or services.
 * Partial passes are deliberately opt-in and must not be called complete QA.
 */
export function runtimeTestPhasePlan(args = []) {
  if (
    !Array.isArray(args) ||
    (args.length !== 0 &&
      (args.length !== 2 ||
        args[0] !== "--phase" ||
        !["all", "system", "browser"].includes(args[1])))
  )
    throw new Error("Use no arguments, or --phase all|system|browser.");
  const phase = args.length ? args[1] : "all";
  return Object.freeze({
    phase,
    system: phase !== "browser",
    browser: phase !== "system",
    stages: Object.freeze(
      stages
        .filter(
          ([, group]) =>
            phase === "all" || group === "shared" || group === phase,
        )
        .map(([name]) => name),
    ),
  });
}
