/**
 * Checks the real workflow boundary between automatic acceptance and deliberately
 * requested delivery. All fixtures are local: no GitHub, Docker or hosted writes.
 */
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runInNewContext} from "node:vm";
import test from "node:test";
import {parsers} from "prettier/plugins/yaml";
import {renderGatewayRoutingListener} from "../deploy/hostinger/selfhost/gateway-check.mjs";

/** Decode the pinned formatter's YAML AST without interpreting tags or aliases.
 * Keeping plain scalar strings also preserves the Actions key `on` exactly.
 */
function yamlValue(node) {
    if (!node) return null;
    if ("value" in node) return node.value;
    if (["mapping", "flowMapping"].includes(node.type)) {
        const entries = node.children.map((item) => {
            assert.equal(item.type, "mappingItem");
            return [yamlValue(item.children[0]), yamlValue(item.children[1])];
        });
        assert.equal(new Set(entries.map(([key]) => key)).size, entries.length);
        return Object.fromEntries(entries);
    }
    if (["sequence", "flowSequence"].includes(node.type))
        return node.children.map(yamlValue);
    if (node.type === "document")
        return yamlValue(
            node.children.find((child) => child.type === "documentBody"),
        );
    if (node.type === "root") {
        assert.equal(
            node.children.length,
            1,
            "One Actions YAML document is required.",
        );
        return yamlValue(node.children[0]);
    }
    assert.ok(
        [
            "documentBody",
            "mappingKey",
            "mappingValue",
            "sequenceItem",
            "flowSequenceItem",
        ].includes(node.type),
        `Unsupported YAML structure must be reviewed: ${node.type}`,
    );
    assert.ok(node.children.length <= 1);
    return yamlValue(node.children[0]);
}

test("the isolated Envoy fixture adds its route header to the real virtual host", () => {
    const template = readFileSync(
        new URL("../deploy/hostinger/selfhost/envoy/lds.template.yaml", import.meta.url),
        "utf8",
    );
    const server = Object.fromEntries(
        [...template.matchAll(/\$\{([A-Z_]+)\}/g)].map(([, key]) => [key, "fictional"]),
    );
    const rendered = renderGatewayRoutingListener(template, server);
    // Only the virtual host is under test. Keep the embedded Lua script out of the parser.
    const listener = rendered.split(/^ +http_filters:$/m)[0];
    const [{filter_chains}] = yamlValue(parsers.yaml.parse(listener)).resources;
    const [{filters}] = filter_chains;
    const {route_config} = filters[0].typed_config;
    const [host] = route_config.virtual_hosts;
    assert.deepEqual(host.response_headers_to_add, [
        {header: {key: "x-portal-test-route", value: "%ROUTE_NAME%"}},
    ]);
    assert.ok(host.request_headers_to_add.length);
    assert.ok(host.routes.length);
});

/** Parse maintained workflows with the already-pinned Prettier YAML parser. */
function workflow(name) {
    return yamlValue(
        parsers.yaml.parse(
            readFileSync(
                new URL(`../.github/workflows/${name}.yml`, import.meta.url),
                "utf8",
            ),
        ),
    );
}

test("workflow concurrency preserves pushes and isolates manual revisions", () => {
    for (const name of ["ci", "security"]) {
        const {concurrency} = workflow(name);
        const cancellation = concurrency["cancel-in-progress"];
        assert.equal(allows(cancellation, {event_name: "push"}), false);
        assert.equal(allows(cancellation, {event_name: "pull_request"}), true);
        assert.equal(allows(cancellation, {event_name: "workflow_dispatch"}), true);
        assert.ok(concurrency.group.includes("github.head_ref || github.ref_name"));
        assert.ok(concurrency.group.includes(
            "github.event_name == 'workflow_dispatch' && format('-manual-{0}', github.sha) || github.event_name == 'push' && format('-push-{0}', github.run_id) || ''",
        ));
    }
});

/** Exercise the maintained Actions condition, restricted to its primitive gate
 * variables and boolean operators rather than executing arbitrary source text.
 */
function allows(condition, github, inputs = {}, needs = {}) {
    const expression = condition
        .replace(/^\s*\$\{\{/, "")
        .replace(/\}\}\s*$/, "");
    const remaining = expression
        .replace(/'[^']*'/g, "")
        .replace(
            /\b(?:github\.(?:event_name|ref|sha|repository|event\.workflow_run\.(?:event|head_branch|head_repository\.full_name|conclusion|head_sha))|inputs\.(?:publish_release|expected_commit)|needs\.scope\.outputs\.profile)\b/g,
            "",
        )
        .replace(/\b(?:true|false)\b/g, "")
        .replace(/\s|&&|\|\||[()=!]/g, "");
    assert.equal(
        remaining,
        "",
        "Review any newly introduced gate expression syntax.",
    );
    return Boolean(
        runInNewContext(
            expression,
            {github, inputs, needs},
            {
                timeout: 100,
                contextCodeGeneration: {strings: false, wasm: false},
            },
        ),
    );
}

test("Draft checks are bounded while ready events and main/manual retain complete acceptance", () => {
    const ci = workflow("ci");
    assert.deepEqual(Object.keys(ci.on).sort(), [
        "pull_request",
        "push",
        "workflow_dispatch",
    ]);
    assert.deepEqual(ci.on.push.branches, ["main"]);
    for (const action of [
        "opened",
        "synchronize",
        "reopened",
        "ready_for_review",
    ])
        assert.ok(ci.on.pull_request.types.includes(action));
    assert.equal(ci.permissions.contents, "read");
    assert.deepEqual(
        ci.jobs.quality.strategy.matrix.include.map((item) => item.name),
        ["Build", "Typecheck", "Lint", "Formatting", "Code quality"],
    );
    assert.ok(
        ci.jobs.coverage.steps.some((step) => step.run === "npm run test:coverage"),
    );
    assert.equal(ci.jobs.scope.steps[0].with["fetch-depth"], "2");
    assert.equal(
        ci.jobs.scope.outputs.profile,
        "${{ steps.scope.outputs.profile }}",
    );
    assert.equal(ci.jobs.verify.needs, "scope");
    assert.equal(ci.jobs.verify.if, "always() && !cancelled()");
    const application = ci.jobs.verify.steps.find(
        (step) => step.id === "application",
    );
    assert.match(
        application.run,
        /node scripts\/runtime-test\.mjs --phase system/,
    );
    assert.doesNotMatch(application.run, /--phase all/);
    const browserJob = ci.jobs["verify-browser"];
    assert.equal(
        browserJob.name,
        "Isolated browser acceptance (${{ matrix.browser-project }})",
    );
    assert.deepEqual(browserJob.strategy.matrix["browser-project"], [
        "desktop-chromium",
        "mobile-chromium",
    ]);
    assert.equal(browserJob.needs, "scope");
    assert.equal(browserJob.if, "always() && !cancelled()");
    const browser = browserJob.steps.find((step) => step.id === "browser");
    assert.equal(browser.name, "Complete isolated browser acceptance");
    assert.equal(browser.run, "node scripts/runtime-test.mjs --phase browser");
    assert.equal(browser.if, "needs.scope.outputs.profile == 'full'");
    const libraries = browserJob.steps.find((step) =>
        step.run?.includes("playwright install-deps"),
    );
    assert.equal(libraries.if, browser.if);
    assert.ok(browserJob.steps.indexOf(libraries) < browserJob.steps.indexOf(browser));
    assert.equal(browser.env.PORTAL_BROWSER_SYSTEM_DEPS_READY, "1");
    const guards = ci.jobs.verify.steps.find(
        (step) => step.run === "node scripts/ci-pr-check.mjs guards",
    );
    const native = ci.jobs["verify-selfhost"].steps.find((step) =>
        step.run?.includes("selfhost-candidate-check.mjs --run"),
    );
    const selfhost = ci.jobs["verify-selfhost"];
    const ageInstall = selfhost.steps.find(
        (step) => step.name === "Install official age tools for the encrypted recovery drill",
    );
    const recovery = selfhost.steps.find(
        (step) => step.name === "Restore a fictional complete encrypted backup in isolation",
    );
    const sql = ci.jobs["verify-selfhost"].steps.find(
        (step) => step.run === "node scripts/ci-pr-check.mjs sql",
    );
    const baseline = ci.jobs["verify-selfhost"].steps.find((step) =>
        step.id === "baseline",
    );
    assert.equal(baseline.env.PREVIOUS_MAIN_SHA, "${{ github.event.before }}");
    assert.equal(native.env.BASELINE_COMMIT, "${{ steps.baseline.outputs.commit }}");
    assert.equal(ageInstall.if, "needs.scope.outputs.profile == 'full'");
    assert.match(ageInstall.run, /apt-get install -y age/);
    assert.equal(recovery.if, "needs.scope.outputs.profile == 'full'");
    assert.equal(
        recovery.run,
        'node deploy/hostinger/backups/test_complete_restore.mjs | tee -a "$GITHUB_STEP_SUMMARY"',
    );
    assert.ok(selfhost.steps.indexOf(ageInstall) < selfhost.steps.indexOf(recovery));
    assert.ok(selfhost.steps.indexOf(recovery) < selfhost.steps.indexOf(native));
    // Ready/risky PRs/main/manual run both complete suites; proven Draft UI/docs
    // take faster paths. SQL shards still exercise the new runner on a risky PR.
    for (const [event_name, profile] of [
        ["pull_request", "docs"],
        ["pull_request", "standard"],
        ["pull_request", "full"],
        ["push", "full"],
        ["workflow_dispatch", "full"],
    ]) {
        const github = {event_name};
        const needs = {scope: {outputs: {profile}}};
        assert.equal(allows(guards.if, github, {}, needs), profile !== "full");
        assert.equal(
            allows(sql.if, github, {}, needs),
            event_name === "pull_request" && profile !== "docs",
        );
        for (const step of [application, native, baseline])
            assert.equal(allows(step.if, github, {}, needs), profile === "full");
    }
    assert.equal(ci.jobs["verify-selfhost"].needs, "scope");
    for (const job of [ci.jobs.verify, ci.jobs["verify-selfhost"]]) {
        assert.equal(job.if, "always() && !cancelled()");
        const scopeCheck = job.steps[0];
        assert.equal(scopeCheck.env.SCOPE_RESULT, "${{ needs.scope.result }}");
        assert.equal(scopeCheck.env.PROFILE, "${{ needs.scope.outputs.profile }}");
        assert.equal(scopeCheck.env.EVENT_NAME, "${{ github.event_name }}");
        assert.equal(
            scopeCheck.env.PR_DRAFT,
            "${{ github.event.pull_request.draft }}",
        );
        assert.equal(scopeCheck.env.PR_ACTION, "${{ github.event.action }}");
        assert.match(
            scopeCheck.run,
            /if test "\$EVENT_NAME" != pull_request; then test "\$PROFILE" = full; fi/,
        );
        assert.match(scopeCheck.run, /test "\$SCOPE_RESULT" = success/);
        assert.match(
            scopeCheck.run,
            /case "\$PROFILE" in docs\|standard\|full\) ;; \*\) exit 1 ;; esac/,
        );
    }
    assert.equal(
        browserJob.steps[0].env.PR_DRAFT,
        "${{ github.event.pull_request.draft }}",
    );
    assert.equal(browserJob.steps[0].env.PR_ACTION, "${{ github.event.action }}");
    assert.equal(
        ci.jobs["preview-package"].if,
        "always() && github.event_name == 'pull_request'",
    );
    const finalPreflight = ci.jobs["preview-package"].steps[0];
    assert.deepEqual(finalPreflight.env, {
        SCOPE_RESULT: "${{ needs.scope.result }}",
        QUALITY_RESULT: "${{ needs.quality.result }}",
        COVERAGE_RESULT: "${{ needs.coverage.result }}",
        APPLICATION_RESULT: "${{ needs.verify.result }}",
        NATIVE_RESULT: "${{ needs.verify-selfhost.result }}",
        BROWSER_RESULT: "${{ needs.verify-browser.result }}",
    });
    for (const name of Object.keys(finalPreflight.env))
        assert(finalPreflight.run.includes(`test "$${name}" = success`));
    // Both suites must actually pass; skipping a required job is not this design.
    assert.deepEqual(ci.jobs["preview-package"].needs, [
        "quality",
        "coverage",
        "verify",
        "verify-selfhost",
        "verify-browser",
        "scope",
    ]);

    assert.ok(
        ci.jobs["verify-selfhost"].steps.some((step) =>
            step.run?.includes("selfhost-candidate-check.mjs --run"),
        ),
    );
    const security = workflow("security");
    assert.deepEqual(Object.keys(security.on).sort(), [
        "pull_request",
        "push",
        "schedule",
        "workflow_dispatch",
    ]);
    assert.deepEqual(security.on.push.branches, ["main"]);
    assert.ok(security.jobs.codeql);
    assert.ok(security.jobs["dependency-review"]);
});

test("only an explicitly requested exact-main release passes the delivery gate", () => {
    const ci = workflow("ci");
    const release = ci.jobs["release-cms"];
    assert.equal(ci.on.workflow_dispatch.inputs.publish_release.type, "boolean");
    assert.equal(ci.on.workflow_dispatch.inputs.publish_release.default, "false");
    assert.deepEqual(release.needs, [
        "quality",
        "coverage",
        "verify",
        "verify-selfhost",
        "verify-browser",
    ]);
    const sha = "a".repeat(40);
    const github = {
        repository: "Luminovia-Training-Consulting/Luminovia-Management-Tool",
        event_name: "workflow_dispatch",
        ref: "refs/heads/main",
        sha,
    };
    const approved = {publish_release: true, expected_commit: sha};
    assert.equal(allows(release.if, github, approved), true);
    for (const event_name of ["push", "pull_request", "schedule", "workflow_run"])
        assert.equal(
            allows(release.if, {...github, event_name}, approved),
            false,
            event_name,
        );
    for (const inputs of [
        {},
        {expected_commit: sha},
        {publish_release: false, expected_commit: sha},
        {publish_release: true},
        {publish_release: true, expected_commit: ""},
        {publish_release: true, expected_commit: "b".repeat(40)},
    ])
        assert.equal(
            allows(release.if, github, inputs),
            false,
            JSON.stringify(inputs),
        );
    assert.equal(
        allows(
            release.if,
            {...github, ref: "refs/heads/feature/example"},
            approved,
        ),
        false,
    );
});

test("release shell preflight independently rejects missing or mismatched revisions", () => {
    const release = workflow("ci").jobs["release-cms"];
    const preflight = release.steps[0];
    assert.equal(preflight.env.EXPECTED_COMMIT, "${{ inputs.expected_commit }}");
    assert.equal(preflight.env.PUBLISH_RELEASE, "${{ inputs.publish_release }}");
    assert.ok(
        preflight.run,
        "Verification precedes checkout, build and publication.",
    );
    const sha = "a".repeat(40);
    const approved = {
        PATH: process.env.PATH,
        GITHUB_SHA: sha,
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF: "refs/heads/main",
        EXPECTED_COMMIT: sha,
        PUBLISH_RELEASE: "true",
    };
    for (const [overrides, success] of [
        [{}, true],
        [{EXPECTED_COMMIT: ""}, false],
        [{EXPECTED_COMMIT: "b".repeat(40)}, false],
        [{PUBLISH_RELEASE: "false"}, false],
        [{GITHUB_EVENT_NAME: "push"}, false],
        [{GITHUB_REF: "refs/heads/feature/example"}, false],
    ]) {
        const result = spawnSync(
            "bash",
            ["-e", "-u", "-o", "pipefail", "-c", preflight.run],
            {
                env: {...approved, ...overrides},
                encoding: "utf8",
                timeout: 1000,
            },
        );
        assert.ifError(result.error);
        assert.equal(result.status === 0, success, JSON.stringify(overrides));
    }
});

test("automatic CMS publication only consumes trusted exact-main push completions", () => {
    const automatic = workflow("automatic-cms-release");
    assert.deepEqual(automatic.on, {workflow_run: {
        workflows: ["Portal checks", "Security analysis"],
        branches: ["main"],
        types: ["completed"],
    }});
    const job = automatic.jobs.publish;
    const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
    const sha = "a".repeat(40);
    const run = {event: "push", head_branch: "main", head_repository: {full_name: repository}, conclusion: "success", head_sha: sha};
    const github = {repository, ref: "refs/heads/main", sha, event_name: "workflow_run", event: {workflow_run: run}};
    assert.equal(allows(job.if, github), true);
    for (const change of [{event: "pull_request"}, {event: "workflow_dispatch"}, {head_branch: "topic"},
        {head_repository: {full_name: "fictional/fork"}}, {conclusion: "failure"}, {head_sha: "b".repeat(40)}]) {
        assert.equal(allows(job.if, {...github, event: {workflow_run: {...run, ...change}}}), false, JSON.stringify(change));
    }
    assert.equal(allows(job.if, {...github, event_name: "push"}), false);
    assert.equal(allows(job.if, {...github, repository: "fictional/fork"}), false);
    assert.deepEqual(job.permissions, {actions: "read", contents: "write", "pull-requests": "read"});
    assert.equal(
        job.concurrency.group,
        "cms-release-${{ github.sha }}",
    );
    assert.equal(
        workflow("ci").jobs["release-cms"].concurrency.group,
        "cms-release-${{ github.sha }}",
    );
    const [checkout, gate] = job.steps;
    assert.equal(gate.id, "gate");
    assert.match(checkout.uses, /^actions\/checkout@[a-f0-9]{40}$/);
    assert.deepEqual(checkout.with, {ref: "${{ github.sha }}", "persist-credentials": "false"});
    assert.match(gate.run, /test "\$\(git rev-parse HEAD\)" = "\$TARGET_SHA"\nif bash scripts\/verify-cms-release\.sh/);
    for (const step of job.steps.slice(2))
        assert.equal(step.if, "steps.gate.outputs.publish == 'true'");
    assert.ok(job.steps.some((step) => step.run?.includes("npm run build")));
    for (const publisher of [job, workflow("ci").jobs["release-cms"]]) {
        assert.ok(publisher.steps.slice(0, -1).some((step) => step.run?.includes("bash scripts/verify-cms-release.sh")));
        const publication = publisher.steps.at(-1).run;
        assert.match(publication, /bash scripts\/verify-cms-release\.sh\nRELEASE_TAG="cms-dev-\$TARGET_SHA"/);
        assert.match(publication, /bash scripts\/verify-cms-release\.sh\ngh release edit .*--draft=false/);
        assert.match(publication, /existing draft requires operator inspection/);
        assert.doesNotMatch(publication, /--clobber/);
    }
});

test("release metadata gate requires exact merged PR and both current push suites", () => {
    const dir = mkdtempSync(join(tmpdir(), "cms-gate-"));
    try {
        const gh = join(dir, "gh");
        writeFileSync(gh, `#!/usr/bin/env bash
set -eu
case "$*" in
  *"/branches/main"*)
    if [[ -f "$FAKE_BRANCH_ACCESSED" ]]; then printf '%s\n' "$FAKE_MAIN_FINAL";
    else touch "$FAKE_BRANCH_ACCESSED"; printf '%s\n' "$FAKE_MAIN"; fi ;;
  *"/commits/$TARGET_SHA/pulls"*) printf '%s\n' "$FAKE_PULLS" ;;
  *"/ci.yml/runs?branch=main&event=push&head_sha=$TARGET_SHA&"*) printf '%s\n' "$FAKE_CI" ;;
  *"/security.yml/runs?branch=main&event=push&head_sha=$TARGET_SHA&"*) printf '%s\n' "$FAKE_SECURITY" ;;
  *) exit 7 ;;
esac
`);
        chmodSync(gh, 0o700);
        const sha = "a".repeat(40);
        const otherSha = "b".repeat(40);
        const repo = {full_name: "Luminovia-Training-Consulting/Luminovia-Management-Tool"};
        const pr = {base: {ref: "main", repo}, state: "closed", merged_at: "2026-11-26T03:00:00Z", merge_commit_sha: sha};
        const ci = {id: 1, created_at: "2026-11-26T03:00:00Z", head_sha: sha, head_branch: "main",
            event: "push", path: ".github/workflows/ci.yml", repository: repo, head_repository: repo,
            status: "completed", conclusion: "success"};
        const runs = (...workflow_runs) => JSON.stringify({workflow_runs});
        const security = {...ci, path: ".github/workflows/security.yml"};
        const cases = [
            ["two exact green push runs and merged PR", {}, 0],
            ["stale target", {FAKE_MAIN: otherSha}, 3],
            ["main advances during check", {FAKE_MAIN_FINAL: otherSha}, 3],
            ["missing PR", {FAKE_PULLS: "[[]]"}, 3],
            ["open PR", {FAKE_PULLS: JSON.stringify([[{...pr, state: "open", merged_at: null}]])}, 3],
            ["different merged commit", {FAKE_PULLS: JSON.stringify([[{...pr, merge_commit_sha: otherSha}]])}, 3],
            ["missing application suite", {FAKE_CI: runs()}, 3],
            ["wrong SHA on security suite", {FAKE_SECURITY: runs({...security, head_sha: otherSha})}, 3],
            ["manual security run", {FAKE_SECURITY: runs({...security, event: "workflow_dispatch"})}, 3],
            ["wrong workflow path", {FAKE_SECURITY: runs(ci)}, 3],
            ["fork workflow run", {FAKE_SECURITY: runs({...security, head_repository: {full_name: "fictional/fork"}})}, 3],
            ["pending security suite", {FAKE_SECURITY: runs({...security, status: "in_progress", conclusion: null})}, 3],
            ["cancelled application suite", {FAKE_CI: runs({...ci, conclusion: "cancelled"})}, 3],
            ["newer failed run wins", {FAKE_CI: runs({...ci, id: 2, conclusion: "failure"}, ci)}, 3],
            ["malformed input", {TARGET_SHA: "invalid"}, 1],
            ["malformed response", {FAKE_SECURITY: "not json"}, 1],
        ];
        for (const [label, overrides, status] of cases) {
            const marker = join(dir, "branch-accessed");
            rmSync(marker, {force: true});
            const result = spawnSync("bash", ["scripts/verify-cms-release.sh"], {
                cwd: new URL("../", import.meta.url),
                env: {PATH: `${dir}:${process.env.PATH}`, GH_REPO: repo.full_name, TARGET_SHA: sha,
                    FAKE_BRANCH_ACCESSED: marker, FAKE_MAIN: sha, FAKE_MAIN_FINAL: sha,
                    FAKE_PULLS: JSON.stringify([[pr]]), FAKE_CI: runs(ci), FAKE_SECURITY: runs(security), ...overrides},
                encoding: "utf8",
                timeout: 3000,
            });
            assert.ifError(result.error);
            assert.equal(result.status, status, `${label}: ${result.stderr}`);
        }
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
});

test("PR deployment metadata is manual and runs only trusted main metadata code", () => {
    const preview = workflow("pr-previews");
    assert.deepEqual(Object.keys(preview.on), ["workflow_dispatch"]);
    const inputs = preview.on.workflow_dispatch.inputs;
    assert.equal(inputs.action.type, "choice");
    assert.equal(inputs.action.default, "cleanup");
    assert.deepEqual([...inputs.action.options].sort(), ["cleanup", "publish"]);
    assert.equal(inputs.run_id.type, "string");
    assert.equal(inputs.run_attempt.type, "string");
    assert.deepEqual(preview.permissions, {
        contents: "read",
        actions: "read",
        "pull-requests": "read",
        deployments: "write",
    });
    assert.deepEqual(Object.keys(preview.jobs), ["publish"]);
    const publisher = preview.jobs.publish;
    assert.equal(
        allows(publisher.if, {
            event_name: "workflow_dispatch",
            ref: "refs/heads/main",
        }),
        true,
    );
    assert.equal(
        allows(publisher.if, {
            event_name: "workflow_dispatch",
            ref: "refs/heads/feature/example",
        }),
        false,
    );
    assert.equal(
        allows(publisher.if, {
            event_name: "workflow_run",
            ref: "refs/heads/main",
        }),
        false,
    );
    const actions = publisher.steps.filter((step) => step.uses);
    assert.equal(
        actions.length,
        1,
        "No contribution artifact/cache/dependency execution is allowed.",
    );
    assert.match(actions[0].uses, /^actions\/checkout@[a-f0-9]{40}$/);
    assert.deepEqual(actions[0].with, {
        repository: "${{ github.repository }}",
        ref: "${{ github.event.repository.default_branch }}",
        "persist-credentials": "false",
    });
    const commands = publisher.steps.filter((step) => step.run);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].run, "node scripts/pr-preview-deployments.mjs");
});

// Exercise the maintained shell gate: a fast ready/main/manual classification must
// independently fail even if a future classifier regresses.
test("scope shell preflight rejects fast ready profiles and accepts only explicit Draft fast paths", () => {
    for (const job of Object.values({
        verify: workflow("ci").jobs.verify,
        selfhost: workflow("ci").jobs["verify-selfhost"],
        browser: workflow("ci").jobs["verify-browser"],
    })) {
        const preflight = job.steps[0].run;
        for (const [event, profile, result, draft, action, allowed] of [
            ["pull_request", "docs", "success", "true", "synchronize", true],
            ["pull_request", "standard", "success", "true", "opened", true],
            ["pull_request", "full", "success", "false", "synchronize", true],
            ["pull_request", "full", "success", "false", "ready_for_review", true],
            ["pull_request", "docs", "success", "false", "synchronize", false],
            ["pull_request", "standard", "success", "false", "synchronize", false],
            ["pull_request", "docs", "success", "true", "ready_for_review", false],
            [
                "pull_request",
                "standard",
                "success",
                "true",
                "ready_for_review",
                false,
            ],
            ["pull_request", "docs", "success", "", "synchronize", false],
            ["pull_request", "standard", "success", "TRUE", "synchronize", false],
            ["push", "full", "success", "", "", true],
            ["workflow_dispatch", "full", "success", "", "", true],
            ["push", "standard", "success", "", "", false],
            ["workflow_dispatch", "docs", "success", "", "", false],
            ["pull_request", "full", "failure", "true", "synchronize", false],
            ["pull_request", "full", "skipped", "true", "synchronize", false],
            ["pull_request", "", "success", "true", "synchronize", false],
            ["pull_request", "unknown", "success", "true", "synchronize", false],
        ]) {
            const execution = spawnSync(
                "bash",
                ["-e", "-u", "-o", "pipefail", "-c", preflight],
                {
                    env: {
                        PATH: process.env.PATH,
                        EVENT_NAME: event,
                        PROFILE: profile,
                        SCOPE_RESULT: result,
                        PR_DRAFT: draft,
                        PR_ACTION: action,
                    },
                    timeout: 1000,
                    encoding: "utf8",
                },
            );
            assert.ifError(execution.error);
            assert.equal(
                execution.status === 0,
                allowed,
                `${event}/${profile}/${result}/${draft}/${action}`,
            );
        }
    }
});

// An unrequired canceled scope must not make every required dependent check
// skipped/successful. The required package job is the fail-closed final gate.
test("preview shell preflight rejects every failed skipped canceled or missing prerequisite", () => {
    const script = workflow("ci").jobs["preview-package"].steps[0].run;
    const results = {
        SCOPE_RESULT: "success",
        QUALITY_RESULT: "success",
        COVERAGE_RESULT: "success",
        APPLICATION_RESULT: "success",
        NATIVE_RESULT: "success",
        BROWSER_RESULT: "success",
    };
    const execute = (overrides) => {
        const result = spawnSync(
            "bash",
            ["-e", "-u", "-o", "pipefail", "-c", script],
            {
                env: {PATH: process.env.PATH, ...results, ...overrides},
                timeout: 1000,
                encoding: "utf8",
            },
        );
        assert.ifError(result.error);
        return result.status === 0;
    };
    assert.equal(execute({}), true);
    for (const name of Object.keys(results))
        for (const status of ["failure", "skipped", "cancelled", ""])
            assert.equal(execute({[name]: status}), false, `${name}/${status}`);
});

test("browser scope preflight accepts exact successful full profiles on every event", () => {
    const preflight = workflow("ci").jobs["verify-browser"].steps[0].run;
    for (const [event, profile, scopeResult, allowed] of [
        ["pull_request", "docs", "success", true],
        ["pull_request", "standard", "success", true],
        ["pull_request", "full", "success", true],
        ["push", "full", "success", true],
        ["workflow_dispatch", "full", "success", true],
        ["pull_request", "full", "failure", false],
        ["pull_request", "full", "skipped", false],
        ["pull_request", "full", "cancelled", false],
        ["pull_request", "", "success", false],
        ["pull_request", "unknown", "success", false],
    ])
        for (const [draft, action] of [
            ["true", "synchronize"],
            ["false", "synchronize"],
            ["true", "ready_for_review"],
            ["", ""],
        ]) {
            const result = spawnSync(
                "bash",
                ["-e", "-u", "-o", "pipefail", "-c", preflight],
                {
                    env: {
                        PATH: process.env.PATH,
                        EVENT_NAME: event,
                        PROFILE: profile,
                        SCOPE_RESULT: scopeResult,
                        PR_DRAFT: draft,
                        PR_ACTION: action,
                    },
                    timeout: 1000,
                    encoding: "utf8",
                },
            );
            assert.ifError(result.error);
            assert.equal(
                result.status === 0,
                allowed &&
                (profile === "full" ||
                    (draft === "true" && action !== "ready_for_review")),
                `${event}/${profile}/${scopeResult}/${draft}/${action}`,
            );
        }
});


test("native upgrade archives previous main across a multi-commit push", () => {
    const ci = yamlValue(parsers.yaml.parse(readFileSync(
        new URL("../.github/workflows/ci.yml", import.meta.url), "utf8",
    )));
    const job = ci.jobs["verify-selfhost"];
    assert.equal(job.steps.find((step) => step.uses?.startsWith("actions/checkout@")).with["fetch-depth"], "0");
    const {run} = job.steps.find((step) => step.id === "baseline");
    const fixture = mkdtempSync(join(tmpdir(), "native-main-baseline-"));
    try {
        const git = (...args) => {
            const result = spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
                "-c", "commit.gpgsign=false", ...args], {cwd: fixture, encoding: "utf8"});
            assert.equal(result.status, 0, result.stderr);
            return result.stdout.trim();
        };
        const file = join(fixture, "migration.sql");
        const commit = (content) => {
            writeFileSync(file, content);
            git("add", "migration.sql");
            git("commit", "-qm", content);
            return git("rev-parse", "HEAD");
        };
        git("init", "-q");
        const previousMain = commit("Previously released");
        const intermediate = commit("Unreleased intermediate");
        const head = commit("Final candidate");
        git("checkout", "--detach", previousMain);
        const unrelated = commit("Unrelated history");
        git("checkout", "--detach", head);
        const archive = (event, previous, runId) => {
            const directory = join(fixture, runId);
            mkdirSync(directory);
            const output = join(directory, "outputs");
            const result = spawnSync("bash", ["-ec", run], {
                cwd: fixture, encoding: "utf8",
                env: {...process.env, GITHUB_EVENT_NAME: event, PREVIOUS_MAIN_SHA: previous,
                    RUNNER_TEMP: directory, GITHUB_OUTPUT: output},
            });
            return {result, directory, output};
        };
        for (const [event, sha, expected, content] of [
            ["push", previousMain, previousMain, "Previously released"],
            ["pull_request", "", intermediate, "Unreleased intermediate"],
            ["workflow_dispatch", "", intermediate, "Unreleased intermediate"],
        ]) {
            const {result, directory, output} = archive(event, sha, event);
            assert.equal(result.status, 0, result.stderr);
            assert.equal(readFileSync(output, "utf8").trim(), `commit=${expected}`);
            assert.equal(readFileSync(join(directory, "selfhost-baseline", "migration.sql"), "utf8"), content);
        }
        assert.notEqual(archive("push", head, "invalid-current").result.status, 0);
        assert.notEqual(archive("push", "", "invalid-missing").result.status, 0);
        assert.notEqual(archive("push", unrelated, "invalid-history").result.status, 0);
    } finally {
        rmSync(fixture, {recursive: true, force: true});
    }
});
