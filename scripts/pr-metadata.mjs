/**
 * Checks automatic PR events or manual main-branch rechecks against the label catalogue.
 * Event fields remain data; repository and API targets are not accepted from arbitrary supplied URLs.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const categories = ["type", "risk", "area"];

/** Rejects an invalid metadata condition with a specific diagnostic. */
function requireMetadata(condition, message) {
  if (!condition) throw new Error(message);
}

/** Validates the shared catalogue, including unique names and all required categories. */
function allowedLabels(catalogue) {
  requireMetadata(
    Array.isArray(catalogue),
    "The label catalogue must be a list.",
  );
  const names = new Set();
  for (const label of catalogue) {
    requireMetadata(
      label &&
        typeof label.name === "string" &&
        label.name.length > 0 &&
        !names.has(label.name),
      "The label catalogue contains an invalid or duplicate name.",
    );
    names.add(label.name);
  }
  for (const category of categories)
    requireMetadata(
      [...names].some((name) => name.startsWith(category + ":")),
      "The label catalogue is missing a required category.",
    );
  return names;
}

/** Binds the PR number, target repository and full commit SHA to the expected identity. */
function checkIdentity(pullRequest, number) {
  requireMetadata(
    pullRequest &&
      pullRequest.number === number &&
      pullRequest.base?.repo?.full_name === repository &&
      typeof pullRequest.head?.sha === "string" &&
      /^[a-f0-9]{40}$/.test(pullRequest.head.sha),
    "The pull request identity is invalid.",
  );
}

/** Validates repository/event identity and returns a safe canonical PR number before fetching. */
function checkEventIdentity(event, context) {
  requireMetadata(
    context.repository === repository &&
      event?.repository?.full_name === repository,
    "This check requires an event from this repository.",
  );
  if (context.eventName === "workflow_dispatch") {
    // Dispatch must run on main, but its selected PR may be closed or target
    // another branch. Reject ambiguous numeric forms before building the API URL.
    const input = event.inputs?.pull_request_number;
    requireMetadata(
      context.ref === "refs/heads/main" &&
        typeof input === "string" &&
        /^[1-9][0-9]*$/.test(input) &&
        Number.isSafeInteger(Number(input)),
      "Manual checks require main and a positive pull request number.",
    );
    return Number(input);
  }
  requireMetadata(
    context.eventName === "pull_request" &&
      Number.isSafeInteger(event.number) &&
      event.number > 0 &&
      event.pull_request?.base?.ref === "main",
    "Automatic checks require a pull_request event against main.",
  );
  checkIdentity(event.pull_request, event.number);
  return event.number;
}

/**
 * Validates label data without executing PR titles, bodies or label names.
 * Automatic events bind the fetched head to the event snapshot; manual rechecks
 * require live metadata because their dispatch payload has no PR snapshot.
 */
export function validatePullRequestMetadata(event, catalogue, context = {}) {
  const number = checkEventIdentity(event, context);
  const pullRequest = context.livePullRequest ?? event.pull_request;
  checkIdentity(pullRequest, number);
  if (context.eventName === "pull_request")
    requireMetadata(
      pullRequest.head.sha === event.pull_request.head.sha,
      "The pull request has changed; use the newer check run.",
    );
  else
    requireMetadata(
      context.livePullRequest,
      "Manual checks require current pull request metadata from GitHub.",
    );
  requireMetadata(
    Array.isArray(pullRequest.labels),
    "Pull request labels are missing or invalid.",
  );
  const allowed = allowedLabels(catalogue);
  const selected = Object.fromEntries(
    categories.map((category) => [category, []]),
  );
  const seen = new Set();
  for (const label of pullRequest.labels) {
    requireMetadata(
      label && typeof label.name === "string" && !seen.has(label.name),
      "The pull request contains invalid or duplicate labels.",
    );
    seen.add(label.name);
    for (const category of categories) {
      if (!label.name.startsWith(category + ":")) continue;
      requireMetadata(
        allowed.has(label.name),
        `A label in category ${category} is not in the shared catalogue.`,
      );
      selected[category].push(label.name);
    }
  }
  // A hold must also block GitHub's native auto-merge through this required
  // check, including manual rechecks that use current trusted-main metadata.
  requireMetadata(
    !seen.has("merge:hold"),
    "Merging is paused by merge:hold; remove it only after the concern is resolved.",
  );
  requireMetadata(
    selected.type.length === 1,
    "Exactly one type: label is required.",
  );
  requireMetadata(
    selected.risk.length === 1,
    "Exactly one risk: label is required.",
  );
  requireMetadata(
    selected.area.length > 0,
    "At least one area: label is required.",
  );
  return {
    number,
    headSha: pullRequest.head.sha,
    type: selected.type[0],
    risk: selected.risk[0],
    areas: selected.area.sort(),
  };
}

/** Uses live REST metadata in Actions; tokenless local automatic-event fixtures use their snapshot. */
async function main() {
  requireMetadata(
    process.env.GITHUB_EVENT_PATH,
    "GITHUB_EVENT_PATH is missing.",
  );
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  // The hosted workflow checks out the validator and adjacent catalogue from
  // trusted main, so an old contribution snapshot cannot supply obsolete labels.
  const catalogue = JSON.parse(
    await readFile(new URL("../.github/labels.json", import.meta.url), "utf8"),
  );
  const context = {
    eventName: process.env.GITHUB_EVENT_NAME,
    repository: process.env.GITHUB_REPOSITORY,
    ref: process.env.GITHUB_REF,
  };
  // Check event identity before constructing a request; never trust a payload URL.
  const number = checkEventIdentity(event, context);
  const token = process.env.GH_TOKEN;
  requireMetadata(
    process.env.GITHUB_ACTIONS !== "true" || token,
    "The GitHub check requires its restricted read-only token.",
  );
  if (token) {
    let response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${repository}/pulls/${number}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2026-03-10",
          },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new Error("Unable to read the current pull request metadata.");
    }
    requireMetadata(response.ok, "GitHub rejected the metadata request.");
    try {
      context.livePullRequest = await response.json();
    } catch {
      throw new Error("GitHub did not return valid pull request metadata.");
    }
  }
  const result = validatePullRequestMetadata(event, catalogue, context);
  console.log(
    `PR #${result.number}: ${result.type}, ${result.risk}, ${result.areas.join(", ")}. Head ${result.headSha}.`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`Invalid PR metadata: ${error.message}`);
    process.exitCode = 1;
  });
}
