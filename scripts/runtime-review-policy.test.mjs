/**
 * Guard the checked-in main rules against accidental review-authority expansion.
 * These network-free source/negative fixtures prove the recorded policy contract,
 * not GitHub activation or a successful merge. No App workflow is exercised here.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const personalActor = {
  actor_id: 29256704,
  actor_type: "User",
  bypass_mode: "pull_request",
};
const requiredChecks = [
  ["Build", 15368],
  ["Typecheck", 15368],
  ["Lint", 15368],
  ["Formatting", 15368],
  ["Code quality", 15368],
  ["Tests and coverage", 15368],
  ["verify", 15368],
  ["Actual isolated selfhost image compatibility", 15368],
  ["PR metadata", 15368],
  ["CodeQL (javascript-typescript)", 15368],
  ["CodeQL (python)", 15368],
  ["CodeQL (actions)", 15368],
  ["Dependency review", 15368],
  ["CodeQL", 57789],
  ["PR preview package", 15368],
].map(([context, integration_id]) => ({ context, integration_id }));
const reviewRule = {
  type: "pull_request",
  parameters: {
    required_approving_review_count: 1,
    dismiss_stale_reviews_on_push: true,
    required_reviewers: [],
    require_code_owner_review: false,
    dismissal_restriction: { enabled: false, allowed_actors: [] },
    require_last_push_approval: true,
    required_review_thread_resolution: true,
    require_extra_approval_for_unattributed_changes: true,
    allowed_merge_methods: ["merge", "squash", "rebase"],
  },
};
const historyRules = [
  { type: "deletion" },
  { type: "non_fast_forward" },
  { type: "required_signatures" },
  {
    type: "required_deployments",
    parameters: { required_deployment_environments: [] },
  },
  { type: "code_quality", parameters: { severity: "errors" } },
];

/** Read only public rule snapshots; private live-readback evidence is not imported. */
function readPolicies() {
  return Object.fromEntries(
    ["history", "review", "checks"].map((name) => [
      name,
      JSON.parse(
        readFileSync(
          new URL(`../.github/rulesets/${name}.json`, import.meta.url),
          "utf8",
        ),
      ),
    ]),
  );
}

/** Check each independent layer, so a personal review exception cannot waive CI/integrity. */
function assertPolicy({ history, review, checks }) {
  for (const policy of [history, review, checks]) {
    assert.equal(policy.target, "branch");
    assert.equal(policy.enforcement, "active");
    assert.deepEqual(policy.conditions, {
      ref_name: { exclude: [], include: ["~DEFAULT_BRANCH"] },
    });
  }
  assert.deepEqual(review.bypass_actors, [personalActor]);
  assert.deepEqual(review.rules, [reviewRule]);
  assert.deepEqual(history.bypass_actors, []);
  assert.deepEqual(history.rules, historyRules);
  assert.deepEqual(checks.bypass_actors, []);
  assert.deepEqual(checks.rules, [
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        do_not_enforce_on_create: false,
        required_status_checks: requiredChecks,
      },
    },
  ]);
}

test("main source grants only Carina a PR-only review exception and preserves all fifteen checks/signatures", () => {
  assertPolicy(readPolicies());
});

// Each adverse fixture first passes the complete valid contract. Its deliberate
// change must be the reason for rejection, even before the source actor fix lands.
const roleActor = (actor_id) => ({
  actor_id,
  actor_type: "RepositoryRole",
  bypass_mode: "pull_request",
});
const appActor = {
  actor_id: 5776881,
  actor_type: "Integration",
  bypass_mode: "pull_request",
};
for (const [name, mutate] of [
  [
    "Maintain role 2 review exemption",
    (p) => (p.review.bypass_actors = [roleActor(2)]),
  ],
  [
    "Admin role 5 review exemption",
    (p) => (p.review.bypass_actors = [roleActor(5)]),
  ],
  [
    "another personal account",
    (p) => (p.review.bypass_actors[0].actor_id = 29256705),
  ],
  [
    "unconditional personal bypass",
    (p) => (p.review.bypass_actors[0].bypass_mode = "always"),
  ],
  ["App review exemption", (p) => (p.review.bypass_actors = [appActor])],
  [
    "additional role beside Carina",
    (p) => p.review.bypass_actors.push(roleActor(2)),
  ],
  ["disabled review", (p) => (p.review.enforcement = "disabled")],
  ["disabled checks", (p) => (p.checks.enforcement = "disabled")],
  ["disabled integrity", (p) => (p.history.enforcement = "disabled")],
  [
    "extra review-layer rule",
    (p) => p.review.rules.push({ type: "required_signatures" }),
  ],
  ["missing PR rule", (p) => (p.review.rules = [])],
  [
    "no independent approval",
    (p) => (p.review.rules[0].parameters.required_approving_review_count = 0),
  ],
  [
    "retained stale approvals",
    (p) => (p.review.rules[0].parameters.dismiss_stale_reviews_on_push = false),
  ],
  [
    "unapproved latest push",
    (p) => (p.review.rules[0].parameters.require_last_push_approval = false),
  ],
  [
    "unresolved conversations",
    (p) =>
      (p.review.rules[0].parameters.required_review_thread_resolution = false),
  ],
  ["personal CI bypass", (p) => p.checks.bypass_actors.push(personalActor)],
  ["App CI bypass", (p) => p.checks.bypass_actors.push(appActor)],
  [
    "personal integrity bypass",
    (p) => p.history.bypass_actors.push(personalActor),
  ],
  ["App integrity bypass", (p) => p.history.bypass_actors.push(appActor)],
  [
    "missing signatures",
    (p) =>
      (p.history.rules = p.history.rules.filter(
        (r) => r.type !== "required_signatures",
      )),
  ],
  [
    "non-strict base checks",
    (p) =>
      (p.checks.rules[0].parameters.strict_required_status_checks_policy = false),
  ],
  [
    "unenforced branch creation",
    (p) => (p.checks.rules[0].parameters.do_not_enforce_on_create = true),
  ],
  [
    "missing preview acceptance",
    (p) =>
      (p.checks.rules[0].parameters.required_status_checks =
        p.checks.rules[0].parameters.required_status_checks.filter(
          (c) => c.context !== "PR preview package",
        )),
  ],
  [
    "wrong Actions producer",
    (p) =>
      (p.checks.rules[0].parameters.required_status_checks[0].integration_id = 57789),
  ],
  [
    "wrong CodeQL findings producer",
    (p) =>
      (p.checks.rules[0].parameters.required_status_checks.find(
        (c) => c.context === "CodeQL",
      ).integration_id = 15368),
  ],
  [
    "duplicate status instead of the fifteenth context",
    (p) =>
      (p.checks.rules[0].parameters.required_status_checks[14] =
        structuredClone(
          p.checks.rules[0].parameters.required_status_checks[0],
        )),
  ],
  [
    "default-branch exclusion",
    (p) => p.review.conditions.ref_name.exclude.push("refs/heads/main"),
  ],
]) {
  test(`review policy rejects ${name}`, () => {
    const policies = readPolicies();
    policies.review.bypass_actors = [structuredClone(personalActor)];
    assertPolicy(policies);
    mutate(policies);
    assert.throws(() => assertPolicy(policies), assert.AssertionError);
  });
}
