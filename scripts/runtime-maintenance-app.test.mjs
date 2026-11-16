/** Preserve M7's credential-isolation regressions against the accepted PR-based
 * maintenance publisher. Network fixtures cannot grant live GitHub privileges. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { signatureProbe } from "../deploy/hostinger/maintenance/promote.mjs";
const read = (path) =>
  readFileSync(new URL("../" + path, import.meta.url), "utf8");
const workflow = read(".github/workflows/daily-maintenance.yml");
const jobs = Object.fromEntries(
  [
    ...workflow
      .slice(workflow.indexOf("\njobs:\n") + 7)
      .matchAll(/^ {2}([a-z-]+):\n([\s\S]*?)(?=^ {2}[a-z-]+:\n|$(?![\s\S]))/gm),
  ].map((m) => [m[1], m[2]]),
);
test("maintainer review exceptions are PR-only and signing plus all15CI checks have no bypass", () => {
  const history = JSON.parse(read(".github/rulesets/history.json")),
    review = JSON.parse(read(".github/rulesets/review.json")),
    checks = JSON.parse(read(".github/rulesets/checks.json"));
  assert.equal(history.enforcement, "active");
  assert.deepEqual(history.bypass_actors, []);
  assert.ok(history.rules.some((r) => r.type === "required_signatures"));
  assert.ok(history.rules.some((r) => r.type === "non_fast_forward"));
  assert.ok(history.rules.some((r) => r.type === "deletion"));
  assert.equal(review.enforcement, "active");
  assert.equal(checks.enforcement, "active");
  assert.deepEqual(review.bypass_actors, [
    { actor_id: 2, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
    { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
  ]);
  assert.deepEqual(checks.bypass_actors, []);
  const required = review.rules.find(
    (r) => r.type === "pull_request",
  ).parameters;
  assert.equal(required.required_approving_review_count, 1);
  assert.equal(required.dismiss_stale_reviews_on_push, true);
  assert.equal(required.require_last_push_approval, true);
  assert.equal(required.required_review_thread_resolution, true);
  const statuses = checks.rules.find(
    (r) => r.type === "required_status_checks",
  ).parameters;
  assert.equal(statuses.strict_required_status_checks_policy, true);
  assert.deepEqual(statuses.required_status_checks, [
    { context: "Build", integration_id: 15368 },
    { context: "Typecheck", integration_id: 15368 },
    { context: "Lint", integration_id: 15368 },
    { context: "Formatting", integration_id: 15368 },
    { context: "Code quality", integration_id: 15368 },
    { context: "Tests and coverage", integration_id: 15368 },
    { context: "verify", integration_id: 15368 },
    {
      context: "Actual isolated selfhost image compatibility",
      integration_id: 15368,
    },
    { context: "PR metadata", integration_id: 15368 },
    { context: "CodeQL (javascript-typescript)", integration_id: 15368 },
    { context: "CodeQL (python)", integration_id: 15368 },
    { context: "CodeQL (actions)", integration_id: 15368 },
    { context: "Dependency review", integration_id: 15368 },
    { context: "CodeQL", integration_id: 57789 },
    { context: "PR preview package", integration_id: 15368 },
  ]);
  for (const policy of [history, review, checks])
    assert.deepEqual(policy.conditions.ref_name, {
      include: ["~DEFAULT_BRANCH"],
      exclude: [],
    });
});
test("App credentials stay in main-only privileged jobs, exact repository tokens, automatic revocation and no personal token fallback", () => {
  assert.deepEqual(Object.keys(jobs), [
    "signature-probe",
    "discover",
    "candidates",
    "combined",
    "fallback",
    "promote",
  ]);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/m);
  for (const [name, source] of Object.entries(jobs)) {
    if (!["signature-probe", "promote"].includes(name)) {
      assert.doesNotMatch(
        source,
        /secrets\.|MAINTENANCE_APP_PRIVATE_KEY|create-github-app-token|environment: maintenance-signing/,
      );
      continue;
    }
    assert.match(
      source,
      /^ {4}if:.*github\.repository == 'Luminovia-Training-Consulting\/Luminovia-Management-Tool'.*github\.ref == 'refs\/heads\/main'/m,
    );
    assert.match(source, /^ {4}environment: maintenance-signing$/m);
    assert.match(source, /^ {4}permissions:\n {6}contents: read$/m);
    assert.match(source, /test "\$APP_ID" = "5776881"/);
    assert.match(source, /test "\$APP_SLUG" = "luminovia-portal-maintenance"/);
    assert.match(
      source,
      /uses: actions\/create-github-app-token@64ab729a6294000f5aa4a4bc0b73d1f32bc45510/,
    );
    assert.match(
      source,
      /private-key: \$\{\{ secrets\.MAINTENANCE_APP_PRIVATE_KEY \}\}/,
    );
    assert.match(source, /owner: \$\{\{ github\.repository_owner \}\}/);
    assert.match(
      source,
      /repositories: \$\{\{ github\.event\.repository\.name \}\}/,
    );
    assert.doesNotMatch(
      source,
      /skip-token-revoke|permission-(administration|actions|workflows|secrets|members|checks):/,
    );
    assert.equal((source.match(/permission-contents: write/g) ?? []).length, 1);
    assert.equal((source.match(/permission-actions: write/g) ?? []).length, 0);
    assert.equal(
      (source.match(/permission-pull-requests: write/g) ?? []).length,
      1,
    );
    assert.ok(
      source.indexOf("APP_SLUG") <
        source.indexOf("run: node deploy/hostinger/maintenance/promote.mjs"),
    );
    for (const match of source.matchAll(/GH_TOKEN: (.+)$/gm))
      assert.equal(
        match[1],
        "${{ steps.maintenance-app-token.outputs.token }}",
      );
    assert.doesNotMatch(
      source,
      /GH_TOKEN:.*github\.token|persist-credentials: true|secrets\.(?:PAT|GITHUB_TOKEN)/,
    );
  }
});
test("probe never attempts broad cleanup if branch creation is denied", async () => {
  const calls = [];
  await assert.rejects(
    signatureProbe(async (path, options = {}) => {
      calls.push({ path, options });
      if (path.endsWith("/branches/main"))
        return { commit: { sha: "a".repeat(40) } };
      if (path.includes("/git/ref/heads/")) return null;
      assert.equal(options.method, "POST");
      assert.match(
        options.body.ref,
        /^refs\/heads\/codex\/maintenance-signature-probe-/,
      );
      throw Error("Fictional rules denied");
    }),
    /Fictional rules denied/,
  );
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.options.method !== "DELETE"));
});
test("probe cleans only its exact newly created branch after a signed-commit API failure and never dispatches main CI", async () => {
  const calls = [];
  let owned;
  let created = false;
  await assert.rejects(
    signatureProbe(async (path, options = {}) => {
      calls.push({ path, options });
      if (path.endsWith("/branches/main"))
        return { commit: { sha: "a".repeat(40) } };
      if (path.includes("/git/ref/heads/"))
        return created
          ? { ref: "refs/heads/" + owned, object: { sha: "a".repeat(40) } }
          : null;
      if (options.method === "DELETE") {
        assert.ok(path.endsWith(owned));
        return null;
      }
      if (path.endsWith("/git/refs")) {
        owned = options.body.ref.slice("refs/heads/".length);
        created = true;
        return {};
      }
      assert.equal(path, "/graphql");
      assert.equal(options.body.variables.input.branch.branchName, owned);
      assert.equal(
        options.body.variables.input.expectedHeadOid,
        "a".repeat(40),
      );
      return { errors: [{ message: "Fictional refusal" }] };
    }),
    /Signed commit mutation was refused/,
  );
  assert.equal(calls.filter((c) => c.options.method === "DELETE").length, 1);
  assert.ok(calls.every((c) => !c.path.includes("/dispatches")));
});
