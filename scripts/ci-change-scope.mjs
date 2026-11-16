/** Conservative CI routing: uncertain changes receive complete acceptance.
 * This chooses work to run, never authorizes a release or replaces a test gate.
 * PR scope comes from the checked-out merge result, including deleted paths.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sha = /^[a-f0-9]{40}$/;
const full = (...reasons) => ({ profile: "full", reasons });
const documentation = /\.(?:md|txt|rst|pdf|png|jpe?g|webp|gif|svg)$/i;
const staticAsset = /\.(?:css|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|otf)$/i;
const source = /\.(?:[cm]?[jt]sx?|css)$/;
const rootDocuments = new Set([
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "ROADMAP.md",
  "LICENSE",
]);

/** A whitelist makes new executable locations conservative by default.
 * Shared identity/cache code and test infrastructure deliberately receive the
 * same complete gate as backend changes, even for edits to their own tests.
 */
export function classifyChangePaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0)
    return full("No trustworthy changed paths were available.");
  const reasons = new Set();
  let standard = false;
  for (const path of paths) {
    if (
      typeof path !== "string" ||
      !path ||
      path.includes("\\") ||
      Array.from(path).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      path.startsWith("/") ||
      path.split("/").some((part) => ["", ".", ".."].includes(part))
    ) {
      reasons.add("An invalid or ambiguous path requires complete acceptance.");
      continue;
    }
    if (
      /^(?:supabase|deploy|scripts|tests|data)\//.test(path) ||
      /^\.github\/(?:workflows|rulesets)\//.test(path)
    ) {
      reasons.add("Backend, delivery or test infrastructure changed.");
      continue;
    }
    if (
      /^src\/(?:app|lib|test)\//.test(path) ||
      /^src\/features\/(?:auth|files|chat)\//.test(path) ||
      path === "src/main.tsx" ||
      /(?:^|\/)(?:auth|identity|supabase|query[-_]?keys?)(?:[./-]|$)/i.test(
        path,
      )
    ) {
      reasons.add(
        "Shared application, identity or private-resource code changed.",
      );
      continue;
    }
    if (
      rootDocuments.has(path) ||
      (path.startsWith("docs/") && documentation.test(path)) ||
      /^\.github\/ISSUE_TEMPLATE\/[^/]+\.(?:ya?ml|md)$/.test(path) ||
      /^\.github\/(?:PULL_REQUEST_TEMPLATE\.md|PULL_REQUEST_TEMPLATE\/[^/]+\.md)$/.test(
        path,
      )
    )
      continue;
    if (
      ((path.startsWith("src/features/") ||
        path.startsWith("src/components/")) &&
        source.test(path)) ||
      path === "src/styles.css" ||
      (path.startsWith("public/") && staticAsset.test(path))
    ) {
      standard = true;
      continue;
    }
    // Root manifests/configuration, instruction files, PWA scripts and any new
    // directory are intentionally covered here rather than guessed harmless.
    reasons.add(
      "An unrecognized or configuration path requires complete acceptance.",
    );
  }
  if (reasons.size) return full(...reasons);
  return standard
    ? {
        profile: "standard",
        reasons: ["Application source or static assets changed."],
      }
    : {
        profile: "docs",
        reasons: [
          "Only documentation, screenshots or contribution templates changed.",
        ],
      };
}

/** The only fast path is a genuine two-parent PR merge matching GITHUB_SHA.
 * No label, requested profile, base override or changed-file environment is
 * consulted. Git failures, empty diffs and unexpected checkout shapes fail full.
 */
export function detectChangeScope({
  eventName = process.env.GITHUB_EVENT_NAME,
  expectedSha = process.env.GITHUB_SHA,
  git = (args) =>
    execFileSync("git", args, {
      encoding: "utf8",
      timeout: 10000,
      maxBuffer: 16 * 1024 * 1024,
    }),
} = {}) {
  if (eventName !== "pull_request")
    return full(
      "Main, manual and other non-PR events require complete acceptance.",
    );
  if (!sha.test(expectedSha || ""))
    return full("The PR event did not identify an exact checked-out revision.");
  try {
    const head = git(["rev-parse", "--verify", "HEAD"]).trim();
    if (head !== expectedSha)
      return full("The checkout does not match the PR event revision.");
    const parents = git(["rev-list", "--parents", "-n", "1", head])
      .trim()
      .split(/\s+/);
    if (
      parents.length !== 3 ||
      parents[0] !== head ||
      !parents.every((value) => sha.test(value))
    )
      return full("The PR checkout is not an inspectable two-parent merge.");
    const changed = git([
      "diff",
      "--name-only",
      "--no-renames",
      "-z",
      parents[1],
      head,
      "--",
    ]);
    if (typeof changed !== "string" || !changed.endsWith("\0"))
      return full("Git did not return a complete nonempty changed-path list.");
    return classifyChangePaths(changed.slice(0, -1).split("\0"));
  } catch {
    return full(
      "Git scope could not be verified; complete acceptance is required.",
    );
  }
}

/** Emit one fixed-valued Actions output and fixed-text reasons; PR filenames
 * never become workflow commands or Markdown in the job summary.
 */
export function writeChangeScope(
  result,
  {
    output = process.env.GITHUB_OUTPUT,
    summary = process.env.GITHUB_STEP_SUMMARY,
    append = appendFileSync,
    report = console.log,
  } = {},
) {
  if (output) append(output, `profile=${result.profile}\n`);
  const explanation = `CI profile: ${result.profile}\n\n${result.reasons.map((reason) => `- ${reason}`).join("\n")}\n`;
  if (summary) append(summary, explanation);
  report(explanation);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  writeChangeScope(detectChangeScope());
