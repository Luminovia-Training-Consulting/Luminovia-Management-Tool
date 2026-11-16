import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const task = "deploy:local-preview";
const kind = "luminovia-pr-local-preview";
const base = `/repos/${repository}`;
const web = `https://github.com/${repository}`;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const shaPattern = /^[a-f0-9]{40}$/;
const expectedJobs = [
  "Build",
  "Typecheck",
  "Lint",
  "Formatting",
  "Code quality",
  "Tests and coverage",
  "verify",
  "Actual isolated selfhost image compatibility",
  "PR preview package",
];
const environment = (number) => `pr-${number}-local-preview`;

function requireValue(value, message) {
  if (!value) throw new Error(message);
}

async function list(request, path, key) {
  const values = [];
  // A finite upper bound fails closed instead of silently ignoring deployments.
  for (let page = 1; page <= 20; page++) {
    const result = await request(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const items = key ? result?.[key] : result;
    requireValue(
      Array.isArray(items),
      "GitHub returned an invalid collection.",
    );
    values.push(...items);
    if (items.length < 100) return values;
  }
  throw new Error(
    "GitHub preview collection exceeded the reviewed pagination limit.",
  );
}

function ownedDeployment(deployment) {
  return (
    positive(deployment?.id) &&
    deployment.task === task &&
    deployment.payload?.kind === kind &&
    positive(deployment.payload.pull_request) &&
    positive(deployment.payload.run_id) &&
    positive(deployment.payload.run_attempt) &&
    shaPattern.test(deployment.sha) &&
    deployment.environment === environment(deployment.payload.pull_request) &&
    deployment.transient_environment === true &&
    deployment.production_environment === false
  );
}

async function status(
  request,
  deployment,
  state,
  description,
  logUrl,
  artifactUrl,
) {
  const previous = await request(
    `${base}/deployments/${deployment.id}/statuses?per_page=1`,
  );
  requireValue(
    Array.isArray(previous),
    "GitHub returned invalid deployment statuses.",
  );
  if (
    previous[0]?.state === state &&
    (previous[0]?.environment_url || "") === (artifactUrl || "")
  )
    return;
  await request(`${base}/deployments/${deployment.id}/statuses`, {
    method: "POST",
    body: {
      state,
      description,
      auto_inactive: false,
      ...(logUrl ? { log_url: logUrl } : {}),
      ...(artifactUrl ? { environment_url: artifactUrl } : {}),
    },
  });
}

/** The writer reads only GitHub REST metadata. It never downloads/unpacks an
 * artifact, loads contributor code, interpolates PR strings or calls a host. */
export async function publishPullRequestPreview({
  event,
  eventName,
  currentRepository,
  request,
  now = Date.now(),
}) {
  requireValue(
    currentRepository === repository &&
      event?.repository?.full_name === repository,
    "Preview publication is restricted to the owning repository.",
  );
  const results = [];
  if (eventName === "pull_request_target") {
    requireValue(
      event.action === "closed" &&
        positive(event.number) &&
        event.pull_request?.number === event.number &&
        event.pull_request.base?.repo?.full_name === repository,
      "Only a closed PR metadata event may clean up preview records.",
    );
    const pr = await request(`${base}/pulls/${event.number}`);
    requireValue(
      pr.state === "closed" &&
        pr.number === event.number &&
        pr.base?.repo?.full_name === repository,
      "A reopened or foreign PR must not be cleaned up by an old close event.",
    );
    const records = await list(
      request,
      `${base}/deployments?environment=${environment(event.number)}&task=${encodeURIComponent(task)}`,
    );
    for (const deployment of records.filter(ownedDeployment))
      await status(
        request,
        deployment,
        "inactive",
        "PR closed; local preview package is no longer current.",
      );
    return [`PR #${event.number}: preview records deactivated.`];
  }
  if (eventName === "schedule") {
    const records = await list(
      request,
      `${base}/deployments?task=${encodeURIComponent(task)}`,
    );
    for (const deployment of records.filter(ownedDeployment)) {
      const statuses = await request(
        `${base}/deployments/${deployment.id}/statuses?per_page=1`,
      );
      if (
        !["success", "in_progress", "pending", "queued"].includes(
          statuses?.[0]?.state,
        )
      )
        continue;
      const pr = await request(
        `${base}/pulls/${deployment.payload.pull_request}`,
      );
      const link = statuses[0].environment_url || "";
      const artifactId =
        link.startsWith(
          `${web}/actions/runs/${deployment.payload.run_id}/artifacts/`,
        ) &&
        /^https:\/\/github\.com\/Luminovia-Training-Consulting\/Luminovia-Management-Tool\/actions\/runs\/\d+\/artifacts\/(\d+)$/.exec(
          link,
        )?.[1];
      let expired =
        now - Date.parse(deployment.created_at) > 24 * 60 * 60 * 1000;
      if (artifactId) {
        const artifact = await request(
          `${base}/actions/artifacts/${artifactId}`,
          { allowMissing: true },
        );
        expired =
          !artifact ||
          artifact.id !== Number(artifactId) ||
          artifact.name !==
            `portal-pr-preview-${deployment.payload.run_id}-${deployment.payload.run_attempt}` ||
          artifact.expired !== false ||
          !(Date.parse(artifact.expires_at) > now);
      }
      if (pr.state === "closed" || pr.head?.sha !== deployment.sha || expired) {
        await status(
          request,
          deployment,
          "inactive",
          "Local preview closed, superseded or expired; no hosted site.",
        );
        results.push(
          `PR #${deployment.payload.pull_request}: old preview deactivated.`,
        );
      }
    }
    return results;
  }
  requireValue(
    eventName === "workflow_run" &&
      ["in_progress", "completed"].includes(event.action) &&
      positive(event.workflow_run?.id),
    "Invalid preview workflow event.",
  );
  const run = await request(`${base}/actions/runs/${event.workflow_run.id}`);
  requireValue(
    run.id === event.workflow_run.id &&
      run.repository?.full_name === repository &&
      run.event === "pull_request" &&
      shaPattern.test(run.head_sha) &&
      positive(run.run_attempt) &&
      positive(run.workflow_id),
    "Preview source must be an actual PR workflow run of the owning repository.",
  );
  if (run.run_attempt !== event.workflow_run.run_attempt)
    return ["Superseded run attempt ignored."];
  const workflow = await request(
    `${base}/actions/workflows/${run.workflow_id}`,
  );
  requireValue(
    workflow.path === ".github/workflows/ci.yml" &&
      workflow.name === "Portal checks",
    "Only the complete application workflow can publish local previews.",
  );
  const runs = await list(
    request,
    `${base}/actions/workflows/${run.workflow_id}/runs?event=pull_request&head_sha=${run.head_sha}`,
    "workflow_runs",
  );
  if (
    runs.some(
      (item) =>
        positive(item.id) && item.id > run.id && item.head_sha === run.head_sha,
    )
  )
    return ["A newer exact-head workflow run supersedes this result."];
  if (run.status !== "completed" && event.action === "completed")
    return ["Run is not yet complete."];
  const candidates = run.pull_requests?.length
    ? run.pull_requests
    : await list(request, `${base}/commits/${run.head_sha}/pulls`);
  requireValue(
    Array.isArray(candidates) && candidates.every((pr) => positive(pr.number)),
    "Invalid associated pull requests.",
  );
  for (const number of [...new Set(candidates.map((pr) => pr.number))]) {
    let pr = await request(`${base}/pulls/${number}`);
    requireValue(
      pr.number === number && pr.base?.repo?.full_name === repository,
      "Foreign PR association refused.",
    );
    const records = (
      await list(
        request,
        `${base}/deployments?environment=${environment(number)}&task=${encodeURIComponent(task)}`,
      )
    ).filter(ownedDeployment);
    const sameRun = (item) =>
      item.payload.run_id === run.id &&
      item.payload.run_attempt === run.run_attempt &&
      item.sha === run.head_sha;
    if (pr.state !== "open" || pr.head?.sha !== run.head_sha) {
      for (const old of records.filter(sameRun))
        await status(
          request,
          old,
          "inactive",
          "PR changed or closed; stale preview result ignored.",
        );
      results.push(`PR #${number}: stale result ignored.`);
      continue;
    }
    for (const old of records.filter((item) => !sameRun(item)))
      await status(
        request,
        old,
        "inactive",
        "Superseded by a newer exact-head local preview run.",
      );
    let deployment = records.find(sameRun);
    if (!deployment) {
      deployment = await request(`${base}/deployments`, {
        method: "POST",
        body: {
          ref: run.head_sha,
          task,
          auto_merge: false,
          required_contexts: [],
          environment: environment(number),
          transient_environment: true,
          production_environment: false,
          description: `PR #${number}: downloadable local preview, no hosted website`,
          payload: {
            kind,
            pull_request: number,
            run_id: run.id,
            run_attempt: run.run_attempt,
          },
        },
      });
      requireValue(
        ownedDeployment(deployment) && deployment.sha === run.head_sha,
        "GitHub did not create the requested preview record.",
      );
    }
    const logUrl = `${web}/actions/runs/${run.id}/attempts/${run.run_attempt}`;
    if (run.status !== "completed") {
      await status(
        request,
        deployment,
        "in_progress",
        "Preparing and testing a downloadable local preview package.",
        logUrl,
      );
      results.push(`PR #${number}: local preview checks running.`);
      continue;
    }
    if (run.conclusion !== "success") {
      await status(
        request,
        deployment,
        "failure",
        "Application checks did not pass; no preview package published.",
        logUrl,
      );
      results.push(`PR #${number}: checks failed; no ready preview.`);
      continue;
    }
    const jobs = await list(
      request,
      `${base}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      "jobs",
    );
    const complete = expectedJobs.every(
      (name) =>
        jobs.filter((job) => job.name === name && job.conclusion === "success")
          .length === 1,
    );
    const artifacts = await list(
      request,
      `${base}/actions/runs/${run.id}/artifacts`,
      "artifacts",
    );
    const matching = artifacts.filter(
      (item) => item.name === `portal-pr-preview-${run.id}-${run.run_attempt}`,
    );
    const artifact = matching.length === 1 ? matching[0] : null;
    if (
      !complete ||
      !artifact ||
      !positive(artifact.id) ||
      artifact.expired !== false ||
      !(artifact.size_in_bytes > 0) ||
      !(Date.parse(artifact.expires_at) > now) ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest || "")
    ) {
      await status(
        request,
        deployment,
        "failure",
        "Required checks or the exact-run preview artifact are missing.",
        logUrl,
      );
      throw new Error(
        "Successful workflow lacks the required complete checks and live exact-run package.",
      );
    }
    // A close/new commit while metadata was read must not advertise stale success.
    pr = await request(`${base}/pulls/${number}`);
    if (pr.state !== "open" || pr.head?.sha !== run.head_sha) {
      await status(
        request,
        deployment,
        "inactive",
        "PR changed or closed before preview publication.",
        logUrl,
      );
      continue;
    }
    await status(
      request,
      deployment,
      "success",
      "Local preview package ready to download; no hosted website.",
      logUrl,
      `${web}/actions/runs/${run.id}/artifacts/${artifact.id}`,
    );
    results.push(
      `PR #${number}: exact-head local preview package ready; no hosted website.`,
    );
  }
  return results;
}

async function main() {
  requireValue(
    process.env.GITHUB_EVENT_PATH && process.env.GH_TOKEN,
    "A trusted event and restricted GitHub token are required.",
  );
  const event = JSON.parse(
    await readFile(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  const request = async (
    path,
    { method = "GET", body, allowMissing = false } = {},
  ) => {
    requireValue(
      path.startsWith(base + "/"),
      "Foreign GitHub API path refused.",
    );
    let response;
    try {
      response = await fetch(`https://api.github.com${path}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${process.env.GH_TOKEN}`,
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new Error("GitHub preview metadata request failed.");
    }
    if (allowMissing && response.status === 404) return null;
    requireValue(
      response.ok,
      `GitHub preview metadata request rejected (${response.status}).`,
    );
    return await response.json();
  };
  const results = await publishPullRequestPreview({
    event,
    eventName: process.env.GITHUB_EVENT_NAME,
    currentRepository: process.env.GITHUB_REPOSITORY,
    request,
  });
  for (const result of results) console.log(result);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      results.join("\n\n") + "\n",
    );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
