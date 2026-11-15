import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const categories = ["type", "risk", "area"];

function requireMetadata(condition, message) {
  if (!condition) throw new Error(message);
}

function allowedLabels(catalogue) {
  requireMetadata(
    Array.isArray(catalogue),
    "Der Label-Katalog muss eine Liste sein.",
  );
  const names = new Set();
  for (const label of catalogue) {
    requireMetadata(
      label &&
        typeof label.name === "string" &&
        label.name.length > 0 &&
        !names.has(label.name),
      "Der Label-Katalog enthält einen ungültigen oder doppelten Namen.",
    );
    names.add(label.name);
  }
  for (const category of categories)
    requireMetadata(
      [...names].some((name) => name.startsWith(category + ":")),
      "Im Label-Katalog fehlt eine Pflichtkategorie.",
    );
  return names;
}

function checkIdentity(pullRequest, number) {
  requireMetadata(
    pullRequest &&
      pullRequest.number === number &&
      pullRequest.base?.repo?.full_name === repository &&
      typeof pullRequest.head?.sha === "string" &&
      /^[a-f0-9]{40}$/.test(pullRequest.head.sha),
    "Die Pull-Request-Identität ist ungültig.",
  );
}

function checkEventIdentity(event, context) {
  requireMetadata(
    context.eventName === "pull_request" &&
      context.repository === repository &&
      event?.repository?.full_name === repository &&
      Number.isSafeInteger(event.number) &&
      event.number > 0,
    "Die Prüfung benötigt ein Pull-Request-Ereignis dieses Repositorys.",
  );
  checkIdentity(event.pull_request, event.number);
}

/** Validate metadata only. PR titles, bodies and label names are never commands. */
export function validatePullRequestMetadata(event, catalogue, context = {}) {
  checkEventIdentity(event, context);
  const pullRequest = context.livePullRequest ?? event.pull_request;
  checkIdentity(pullRequest, event.number);
  requireMetadata(
    pullRequest.head.sha === event.pull_request.head.sha,
    "Der Pull Request wurde inzwischen geändert; der neuere Prüflauf ist maßgeblich.",
  );
  requireMetadata(
    Array.isArray(pullRequest.labels),
    "Die Pull-Request-Labels fehlen oder sind ungültig.",
  );
  const allowed = allowedLabels(catalogue);
  const selected = Object.fromEntries(
    categories.map((category) => [category, []]),
  );
  const seen = new Set();
  for (const label of pullRequest.labels) {
    requireMetadata(
      label && typeof label.name === "string" && !seen.has(label.name),
      "Der Pull Request enthält ungültige oder doppelte Labels.",
    );
    seen.add(label.name);
    for (const category of categories) {
      if (!label.name.startsWith(category + ":")) continue;
      requireMetadata(
        allowed.has(label.name),
        `Ein Label der Kategorie ${category} ist nicht im gemeinsamen Katalog enthalten.`,
      );
      selected[category].push(label.name);
    }
  }
  requireMetadata(
    selected.type.length === 1,
    "Genau ein type:-Label ist erforderlich.",
  );
  requireMetadata(
    selected.risk.length === 1,
    "Genau ein risk:-Label ist erforderlich.",
  );
  requireMetadata(
    selected.area.length > 0,
    "Mindestens ein area:-Label ist erforderlich.",
  );
  return {
    number: event.number,
    type: selected.type[0],
    risk: selected.risk[0],
    areas: selected.area.sort(),
  };
}

async function main() {
  requireMetadata(process.env.GITHUB_EVENT_PATH, "GITHUB_EVENT_PATH fehlt.");
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
    "Der GitHub-Prüflauf benötigt sein eingeschränktes Lesetoken.",
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
      throw new Error(
        "Die aktuellen Pull-Request-Metadaten konnten nicht gelesen werden.",
      );
    }
    requireMetadata(response.ok, "GitHub hat die Metadatenabfrage abgelehnt.");
    try {
      context.livePullRequest = await response.json();
    } catch {
      throw new Error(
        "GitHub hat keine gültigen Pull-Request-Metadaten geliefert.",
      );
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
    console.error(`PR-Metadaten ungültig: ${error.message}`);
    process.exitCode = 1;
  });
}
