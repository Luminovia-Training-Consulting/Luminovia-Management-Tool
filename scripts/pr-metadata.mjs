/**
 * Prüft aktuelle PR-Identität und die gemeinsamen Pflichtkategorien für Labels.
 * Ereignisfelder bleiben Daten; Repository und API-Ziel werden nicht aus frei gelieferten URLs übernommen.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const categories = ["type", "risk", "area"];

/** Bricht bei ungültiger Metadatenbedingung mit einer gezielten Meldung ab. */
function requireMetadata(condition, message) {
  if (!condition) throw new Error(message);
}

/** Validiert den gemeinsamen Katalog einschließlich eindeutiger Namen und aller Pflichtkategorien. */
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

/** Bindet PR-Nummer, Zielrepository und vollständige Commit-SHA an die erwartete Identität. */
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

/** Lehnt fremde oder ungeeignete Ereignisse vor jedem Netzwerkzugriff ab. */
function checkEventIdentity(event, context) {
  requireMetadata(
    context.eventName === "pull_request" &&
      context.repository === repository &&
      event?.repository?.full_name === repository &&
      Number.isSafeInteger(event.number) &&
      event.number > 0,
    "This check requires a pull_request event from this repository.",
  );
  checkIdentity(event.pull_request, event.number);
}

/** Validate metadata only. PR titles, bodies and label names are never commands. */
/** Prüft aktuelle Labels gegen den Katalog und lehnt einen inzwischen überholten PR-Head ab. */
export function validatePullRequestMetadata(event, catalogue, context = {}) {
  checkEventIdentity(event, context);
  const pullRequest = context.livePullRequest ?? event.pull_request;
  checkIdentity(pullRequest, event.number);
  requireMetadata(
    pullRequest.head.sha === event.pull_request.head.sha,
    "The pull request has changed; use the newer check run.",
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
    number: event.number,
    type: selected.type[0],
    risk: selected.risk[0],
    areas: selected.area.sort(),
  };
}

/** Liest das Ereignis, bestätigt die aktuelle REST-Identität und gibt ausschließlich validierte Klassifikationen aus. */
async function main() {
  requireMetadata(
    process.env.GITHUB_EVENT_PATH,
    "GITHUB_EVENT_PATH is missing.",
  );
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  const catalogue = JSON.parse(
    await readFile(new URL("../.github/labels.json", import.meta.url), "utf8"),
  );
  const context = {
    eventName: process.env.GITHUB_EVENT_NAME,
    repository: process.env.GITHUB_REPOSITORY,
  };
  // Check event identity before constructing a request; never trust a payload URL.
  checkEventIdentity(event, context);
  const token = process.env.GH_TOKEN;
  requireMetadata(
    process.env.GITHUB_ACTIONS !== "true" || token,
    "The GitHub check requires its restricted read-only token.",
  );
  if (token) {
    let response;
    try {
      response = await fetch(
        `https://api.github.com/repos/${repository}/pulls/${event.number}`,
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
    `PR #${result.number}: ${result.type}, ${result.risk}, ${result.areas.join(", ")}.`,
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
