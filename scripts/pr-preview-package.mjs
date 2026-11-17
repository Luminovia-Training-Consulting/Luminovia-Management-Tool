import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const shaPattern = /^[a-f0-9]{40}$/;
const positive = (value) => Number.isSafeInteger(value) && value > 0;

/** Archive committed source only: a previous QA run must never publish its
 * generated passwords, Auth traces, local configuration or database files. */
export function createPreviewPackage({
  cwd = process.cwd(),
  output,
  headSha,
  testedSha,
  runId,
  runAttempt,
  number,
  profile = "standard",
}) {
  if (
    !["docs", "standard", "full"].includes(profile) ||
    !isAbsolute(output) ||
    !shaPattern.test(headSha) ||
    !shaPattern.test(testedSha) ||
    ![runId, runAttempt, number].every(positive)
  )
    throw new Error("Invalid exact-revision PR preview package arguments.");
  const git = (...args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }).trim();
  if (git("rev-parse", "HEAD") !== testedSha)
    throw new Error("The preview checkout differs from the tested revision.");
  const entries = git("ls-tree", "-r", "--name-only", "HEAD").split("\n");
  for (const path of entries) {
    const parts = path.split("/");
    if (
      parts.some(
        (part) =>
          [
            ".local",
            "node_modules",
            "coverage",
            "test-results",
            "playwright-report",
            "private",
          ].includes(part) ||
          (part.startsWith(".env") && part !== ".env.example") ||
          part.endsWith(".env") ||
          /\.(?:pem|key|agekey)$/.test(part),
      )
    )
      throw new Error(
        "Private or generated material is tracked; preview publication refused.",
      );
  }
  // Exclusive creation refuses stale contents and symlinked output directories.
  mkdirSync(output, { mode: 0o700 });
  const archive = join(output, "portal-source.tar.gz");
  git(
    "archive",
    "--format=tar.gz",
    "--prefix=portal/",
    `--output=${archive}`,
    "HEAD",
  );
  const manifest = {
    version: 1,
    kind: "local-pr-preview",
    pull_request: number,
    source_head: headSha,
    tested_revision: testedSha,
    run_id: runId,
    run_attempt: runAttempt,
    archive_sha256: createHash("sha256")
      .update(readFileSync(archive))
      .digest("hex"),
    source_config_sha256: createHash("sha256")
      .update(
        execFileSync(
          "git",
          [
            "-c",
            "core.hooksPath=/dev/null",
            "show",
            "HEAD:supabase/config.toml",
          ],
          { cwd, timeout: 30_000 },
        ),
      )
      .digest("hex"),
    verification_profile: profile,
    verification_scope:
      profile === "docs"
        ? "pr-quality-runtime-edge"
        : profile === "full"
          ? "pr-full-application-native-postgresql"
          : "pr-quality-runtime-edge-postgresql",
    hosted: false,
  };
  writeFileSync(
    join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  writeFileSync(
    join(output, "preview.mjs"),
    `import { runPackagedPreview } from "./portal/scripts/runtime-pr-preview.mjs";
try {
  process.exitCode = await runPackagedPreview({ packageDirectory: import.meta.dirname, action: process.argv[2] });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
`,
  );
  writeFileSync(
    join(output, "README.txt"),
    `Luminovia PR #${number}: local application preview

This package contains committed source from tested revision ${testedSha}.
Verification profile: ${profile}.
PostgreSQL suites: ${profile === "docs" ? "not run for documentation-only changes" : "included"}.
Full Auth/Storage/browser/PWA/retained-data acceptance: ${profile === "full" ? "included" : "not included in this Draft profile"}.
PR head: ${headSha}. It is a downloadable local preview, not a hosted website.
It contains no live backend connection, generated account passwords or QA traces.
Review PR source before running it: contributor code executes on your computer.
Unpack into a fresh directory for this PR; do not overwrite a development checkout.

Complete local preview (Linux, Node >=22.12,
npm, Docker Engine and Compose >=2.20.2; ports 5473 and 573xx must be free):

  tar -xzf portal-source.tar.gz
  node preview.mjs start
  node preview.mjs credentials

Use this wrapper; do not run ./portal from the extracted canonical source.
The wrapper creates an owned .preview/source copy with a separate project ID,
database volumes and ports 5473/573xx. Normal development remains separate,
even if it is stopped. The source archive and canonical config remain unchanged.

Open: http://127.0.0.1:5473
Stop while keeping your fictional local data:

  node preview.mjs stop

The launcher installs locked dependencies, starts a separate local backend and
captures fictional email in Mailpit. No connection to cms.luminovia.org is needed.
Do not copy production credentials or real personal records into this preview.
Details: portal/docs/LOCAL_DEVELOPMENT.md and portal/docs/PR_PREVIEWS.md.
`,
  );
  return manifest;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const output = process.argv[2];
    if (!["docs", "standard", "full"].includes(process.env.CI_PROFILE))
      throw new Error(
        "An explicit verified CI profile is required for the preview package CLI.",
      );
    const manifest = createPreviewPackage({
      output,
      headSha: process.env.PR_HEAD_SHA,
      testedSha: process.env.GITHUB_SHA,
      runId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      number: Number(process.env.PR_NUMBER),
      profile: process.env.CI_PROFILE,
    });
    console.log(
      `Local preview package ready for PR #${manifest.pull_request}; no hosted site was deployed.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
