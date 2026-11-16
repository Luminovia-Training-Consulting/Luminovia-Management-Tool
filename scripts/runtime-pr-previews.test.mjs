/** Exercises manual metadata publication and isolated runnable packages with
 * fictional GitHub responses and temporary Git repositories only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createPreviewPackage } from "./pr-preview-package.mjs";
import { publishPullRequestPreview } from "./pr-preview-deployments.mjs";
import { preparePackagedPreview } from "./runtime-pr-preview.mjs";

const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
const head = "a".repeat(40);
const now = Date.parse("2026-11-16T10:00:00Z");
const canonicalConfig = `project_id = "luminovia-portal"
[api]
port = 54321
[db]
port = 54322
shadow_port = 54320
[local_smtp]
port = 54324
[edge_runtime]
inspector_port = 8083
[auth]
site_url = "http://127.0.0.1:5173"
additional_redirect_urls = ["http://127.0.0.1:5173/auth/callback"]
`;
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

function fixture() {
  const state = {
    run: {
      id: 41,
      workflow_id: 7,
      run_attempt: 1,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      repository: { full_name: repository },
      head_sha: head,
      head_branch: "feature/example",
      pull_requests: [{ number: 5 }],
    },
    pr: {
      number: 5,
      state: "open",
      head: { sha: head, repo: { full_name: "external/fork" } },
      base: { repo: { full_name: repository } },
      title: "$(touch /tmp/never-execute)",
      body: "untrusted",
    },
    jobs: expectedJobs.map((name) => ({ name, conclusion: "success" })),
    workflow: { name: "Portal checks", path: ".github/workflows/ci.yml" },
    artifacts: [
      {
        id: 91,
        name: "portal-pr-preview-41-1",
        expired: false,
        size_in_bytes: 12,
        digest: "sha256:" + "b".repeat(64),
        expires_at: "2026-11-23T10:00:00Z",
      },
    ],
    deployments: [],
    statuses: new Map(),
    writes: [],
    reads: [],
    newId: 70,
  };
  const request = async (path, options = {}) => {
    const prefix = `/repos/${repository}`;
    assert.ok(path.startsWith(prefix + "/"));
    const route = path.slice(prefix.length).split("?")[0];
    if (options.method === "POST") {
      state.writes.push({ path, body: options.body });
      if (route === "/deployments") {
        const deployment = {
          id: ++state.newId,
          ...options.body,
          sha: options.body.ref,
          created_at: "2026-11-16T09:00:00Z",
        };
        state.deployments.unshift(deployment);
        return structuredClone(deployment);
      }
      const match = /^\/deployments\/(\d+)\/statuses$/.exec(route);
      if (match) {
        const id = Number(match[1]);
        state.statuses.set(id, [
          structuredClone(options.body),
          ...(state.statuses.get(id) || []),
        ]);
        return options.body;
      }
      assert.fail(`Unexpected write: ${route}`);
    }
    state.reads.push(path);
    if (route === "/actions/runs/41") return structuredClone(state.run);
    if (route === "/actions/workflows/7")
      return structuredClone(state.workflow);
    if (route === "/actions/workflows/7/runs")
      return {
        workflow_runs: state.newerRun
          ? [state.newerRun, state.run]
          : [state.run],
      };
    if (route === "/pulls/5")
      return structuredClone(state.readPr ? state.readPr() : state.pr);
    if (route === `/commits/${head}/pulls`) return [{ number: 5 }];
    if (route === "/deployments") return structuredClone(state.deployments);
    const match = /^\/deployments\/(\d+)\/statuses$/.exec(route);
    if (match)
      return structuredClone(state.statuses.get(Number(match[1])) || []);
    if (route === "/actions/runs/41/attempts/1/jobs")
      return { jobs: state.jobs };
    if (route === "/actions/runs/41/artifacts")
      return { artifacts: state.artifacts };
    if (route === "/actions/artifacts/91") return state.artifacts[0] || null;
    assert.fail(`Unexpected read: ${route}`);
  };
  const event = {
    repository: { full_name: repository },
    inputs: { action: "publish", run_id: "41", run_attempt: "1" },
  };
  const publish = (overrides = {}) =>
    publishPullRequestPreview({
      event,
      eventName: "workflow_dispatch",
      currentRef: "refs/heads/main",
      currentRepository: repository,
      request,
      now,
      ...overrides,
    });
  return { state, event, publish };
}

test("manual publication links a fork PR's exact-head package after every required check passed", async () => {
  const { state, publish } = fixture();
  const result = await publish();
  assert.match(result[0], /no hosted website/);
  assert.equal(state.deployments.length, 1);
  const deployment = state.deployments[0];
  assert.equal(deployment.ref, head);
  assert.equal(deployment.environment, "pr-5-local-preview");
  assert.equal(deployment.production_environment, false);
  assert.equal(deployment.transient_environment, true);
  assert.equal(deployment.auto_merge, false);
  assert.deepEqual(deployment.required_contexts, []);
  const ready = state.statuses.get(deployment.id)[0];
  assert.equal(ready.state, "success");
  assert.equal(
    ready.environment_url,
    `https://github.com/${repository}/actions/runs/41/artifacts/91`,
  );
  assert.match(ready.description, /no hosted website/);
  assert.ok(state.reads.every((path) => !/zip|download|archive/.test(path)));
  const count = state.writes.length;
  await publish();
  assert.equal(
    state.writes.length,
    count,
    "duplicate completion must not create records/status spam",
  );
});

test("manual publication rejects running/failed CI before creating any deployment", async () => {
  for (const [status, conclusion] of [
    ["in_progress", null],
    ["completed", "failure"],
    ["completed", "cancelled"],
  ]) {
    const { state, publish } = fixture();
    Object.assign(state.run, { status, conclusion });
    await assert.rejects(publish(), /completed successful/);
    assert.deepEqual(state.writes, []);
  }
});

test("automatic events, other refs and malformed manual inputs cannot read or write metadata", async () => {
  for (const eventName of [
    "workflow_run",
    "pull_request_target",
    "schedule",
    "push",
  ]) {
    const { state, publish } = fixture();
    await assert.rejects(publish({ eventName }), /explicit manual dispatch/);
    assert.deepEqual(state.reads, []);
    assert.deepEqual(state.writes, []);
  }
  for (const overrides of [
    { currentRef: "refs/heads/feature/example" },
    { currentRef: undefined },
    { inputs: {} },
    { inputs: { action: "deploy", run_id: "41", run_attempt: "1" } },
    ...[
      "",
      "0",
      "-1",
      "1.5",
      "01",
      "9007199254740992",
      "$(touch /tmp/never-execute)",
    ].flatMap((value) => [
      { inputs: { action: "publish", run_id: value, run_attempt: "1" } },
      { inputs: { action: "publish", run_id: "41", run_attempt: value } },
    ]),
  ]) {
    const { state, event, publish } = fixture();
    const { inputs, ...context } = overrides;
    await assert.rejects(
      publish({
        ...context,
        event: { ...event, ...(inputs ? { inputs } : {}) },
      }),
    );
    assert.deepEqual(state.reads, []);
    assert.deepEqual(state.writes, []);
  }
});

test("actual GitHub stale-run metadata cannot substitute its dynamically updated PR association head", async () => {
  const { state, publish } = fixture();
  // Observed REST identity shape from PR16/run43793409118. The run is tied
  // to an old one-parent source commit; its association now names a NEW head.
  const oldHead = "1de2de31f533f63df69b27b1e4ef246a221776cc";
  const currentHead = "32453eb5f022168a0870a107d185e08e879418f7";
  state.run.head_sha = oldHead;
  state.run.pull_requests = [
    {
      number: 5,
      head: { sha: currentHead },
      base: { sha: "3256d1a244ca0d6eac8a7242495f44f37d7e3124" },
    },
  ];
  state.pr.head.sha = currentHead;
  await publish();
  assert.deepEqual(state.writes, []);
});

test("fork workflow payloads without PR associations use the commit association API", async () => {
  const { state, publish } = fixture();
  state.run.pull_requests = [];
  await publish();
  assert.equal(state.deployments.length, 1);
  assert.ok(
    state.reads.some((path) =>
      path.startsWith(`/repos/${repository}/commits/${head}/pulls?`),
    ),
  );
});

test("old heads, old attempts and older completed runs cannot replace newer previews", async () => {
  for (const change of [
    (state) => {
      state.pr.head.sha = "c".repeat(40);
    },
    (state) => {
      state.run.run_attempt = 2;
    },
    (state) => {
      state.newerRun = { id: 42, head_sha: head };
    },
    (state) => {
      state.pr.state = "closed";
    },
  ]) {
    const { state, publish } = fixture();
    change(state);
    await publish();
    assert.deepEqual(state.writes, []);
  }
});

test("a successful summary cannot hide missing/failed jobs or a missing/wrong/expired package", async () => {
  const changes = [
    (state) => {
      state.jobs = state.jobs.filter((job) => job.name !== "verify");
    },
    (state) => {
      state.jobs[6].conclusion = "skipped";
    },
    (state) => {
      state.jobs.push(state.jobs[0]);
    },
    (state) => {
      state.artifacts = [];
    },
    (state) => {
      state.artifacts[0].name = "portal-pr-preview-40-1";
    },
    (state) => {
      state.artifacts.push(state.artifacts[0]);
    },
    (state) => {
      state.artifacts[0].expired = true;
    },
    (state) => {
      state.artifacts[0].digest = "invalid";
    },
    (state) => {
      state.artifacts[0].expires_at = "2026-11-15T10:00:00Z";
    },
    (state) => {
      state.artifacts[0].size_in_bytes = 0;
    },
  ];
  for (const change of changes) {
    const { state, publish } = fixture();
    change(state);
    await assert.rejects(publish(), /required complete checks/);
    assert.equal(
      state.statuses.get(state.deployments[0].id)[0].state,
      "failure",
    );
    assert.ok(!state.writes.some((write) => write.body.state === "success"));
  }
});

test("only the owning repository's actual application PR workflow can publish", async () => {
  for (const change of [
    (state) => {
      state.run.repository.full_name = "external/fork";
    },
    (state) => {
      state.run.event = "push";
    },
    (state) => {
      state.workflow.path = ".github/workflows/spoof.yml";
    },
    (state) => {
      state.run.head_sha = "$(touch /tmp/never-execute)";
    },
    (state) => {
      state.pr.base.repo.full_name = "external/fork";
    },
  ]) {
    const { state, publish } = fixture();
    change(state);
    await assert.rejects(publish());
    assert.deepEqual(state.writes, []);
  }
});

test("a PR changed during publication is made inactive before any success", async () => {
  const { state, publish } = fixture();
  let reads = 0;
  state.readPr = () => ({
    ...state.pr,
    head: { sha: ++reads === 1 ? head : "c".repeat(40) },
  });
  await publish();
  assert.equal(
    state.statuses.get(state.deployments[0].id)[0].state,
    "inactive",
  );
  assert.ok(!state.writes.some((write) => write.body.state === "success"));
});

test("manual cleanup deactivates closed owned previews and preserves unrelated/production deployments", async () => {
  const { state, event, publish } = fixture();
  await publish();
  state.deployments.push({
    id: 900,
    task: "deploy",
    environment: "production",
    production_environment: true,
  });
  state.pr.state = "closed";
  const cleanup = {
    repository: event.repository,
    inputs: { action: "cleanup" },
  };
  await publish({ event: cleanup });
  assert.equal(
    state.statuses.get(state.deployments[0].id)[0].state,
    "inactive",
  );
  assert.equal(state.statuses.get(900), undefined);
});

test("manual cleanup uses actual artifact expiry and closes stale links", async () => {
  for (const change of [
    (state) => {
      state.artifacts[0].expired = true;
    },
    (state) => {
      state.artifacts = [];
    },
    (state) => {
      state.pr.state = "closed";
    },
    (state) => {
      state.pr.head.sha = "c".repeat(40);
    },
  ]) {
    const { state, event, publish } = fixture();
    await publish();
    change(state);
    await publish({
      event: { repository: event.repository, inputs: { action: "cleanup" } },
    });
    assert.equal(
      state.statuses.get(state.deployments[0].id)[0].state,
      "inactive",
    );
  }
  const { state, event, publish } = fixture();
  await publish();
  const count = state.writes.length;
  await publish({
    event: { repository: event.repository, inputs: { action: "cleanup" } },
  });
  assert.equal(
    state.writes.length,
    count,
    "an unexpired current package remains available",
  );
});

function withRepository(operation) {
  const directory = mkdtempSync(join(tmpdir(), "luminovia-pr-package-"));
  try {
    const cwd = join(directory, "source");
    mkdirSync(cwd);
    const git = (...args) =>
      execFileSync("git", ["-c", "commit.gpgsign=false", ...args], {
        cwd,
        encoding: "utf8",
      }).trim();
    git("init", "--quiet");
    git("config", "user.name", "Fictional preview test");
    git("config", "user.email", "preview@example.invalid");
    writeFileSync(join(cwd, "portal"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    writeFileSync(join(cwd, ".env.example"), "EXAMPLE=fictional\n");
    mkdirSync(join(cwd, "supabase"));
    writeFileSync(join(cwd, "supabase/config.toml"), canonicalConfig);
    mkdirSync(join(cwd, "scripts"));
    for (const name of [
      "runtime-pr-preview.mjs",
      "runtime-github-config.mjs",
      "runtime-snapshot.mjs",
    ])
      writeFileSync(
        join(cwd, "scripts", name),
        readFileSync(new URL(name, import.meta.url)),
      );
    writeFileSync(
      join(cwd, "scripts/runtime-cli.mjs"),
      `import {readFileSync,mkdirSync,writeFileSync,existsSync} from 'node:fs';
const action=process.argv[2];
if(action==='start'){mkdirSync('.local',{recursive:true});if(!existsSync('.local/fictional.txt'))writeFileSync('.local/fictional.txt','retained fictional state');}
console.log(JSON.stringify({action,cwd:process.cwd(),config:readFileSync('supabase/config.toml','utf8'),tokenPresent:Boolean(process.env.GH_TOKEN||process.env.GITHUB_TOKEN||process.env.SUPABASE_URL)}));`,
    );
    git("add", ".");
    git("commit", "--quiet", "-m", "fictional preview fixture");
    const testedSha = git("rev-parse", "HEAD");
    return operation({ cwd, directory, git, testedSha });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("actual archive is committed exact source with an inspectable checksum, never generated QA secrets", () => {
  withRepository(({ cwd, directory, testedSha }) => {
    mkdirSync(join(cwd, ".local"));
    writeFileSync(
      join(cwd, ".local/ACCOUNTS.txt"),
      "never-publish-fixture-password",
    );
    writeFileSync(join(cwd, ".env.test.local"), "never-publish-fixture-key");
    const output = join(directory, "package");
    const manifest = createPreviewPackage({
      cwd,
      output,
      headSha: head,
      testedSha,
      runId: 41,
      runAttempt: 1,
      number: 5,
    });
    const archive = join(output, "portal-source.tar.gz");
    const entries = execFileSync("tar", ["-tzf", archive], {
      encoding: "utf8",
    });
    assert.match(entries, /portal\/portal/);
    assert.match(entries, /portal\/\.env.example/);
    assert.doesNotMatch(entries, /ACCOUNTS|env.test|\.git\//);
    assert.equal(
      manifest.archive_sha256,
      createHash("sha256").update(readFileSync(archive)).digest("hex"),
    );
    assert.equal(manifest.tested_revision, testedSha);
    assert.equal(manifest.source_head, head);
    assert.equal(manifest.hosted, false);
    assert.equal(manifest.verification_profile, "standard");
    assert.equal(
      manifest.verification_scope,
      "pr-quality-runtime-edge-postgresql",
    );
    assert.match(
      readFileSync(join(output, "README.txt"), "utf8"),
      /node preview.mjs start/,
    );
    assert.throws(
      () =>
        createPreviewPackage({
          cwd,
          output,
          headSha: head,
          testedSha,
          runId: 41,
          runAttempt: 1,
          number: 5,
        }),
      /EEXIST/,
    );
  });
});

function packageFixture({ cwd, directory, testedSha }, name = "package") {
  const output = join(directory, name);
  createPreviewPackage({
    cwd,
    output,
    headSha: head,
    testedSha,
    runId: 41,
    runAttempt: 1,
    number: 5,
  });
  execFileSync("tar", [
    "-xzf",
    join(output, "portal-source.tar.gz"),
    "-C",
    output,
  ]);
  return output;
}

test("actual packaged launcher isolates project/ports/copies and preserves owned state across commands", () => {
  withRepository((fixture) => {
    const output = packageFixture(fixture);
    const canonical = readFileSync(
      join(output, "portal/supabase/config.toml"),
      "utf8",
    );
    const archive = readFileSync(join(output, "portal-source.tar.gz"));
    const run = (action) =>
      JSON.parse(
        execFileSync(process.execPath, [join(output, "preview.mjs"), action], {
          encoding: "utf8",
          env: {
            ...process.env,
            GH_TOKEN: "fictional-removed-token",
            GITHUB_TOKEN: "fictional-removed-token",
            SUPABASE_URL: "https://example.invalid",
          },
        }),
      );
    const started = run("start");
    assert.equal(started.cwd, join(output, ".preview/source"));
    assert.equal(started.tokenPresent, false);
    assert.match(
      started.config,
      /project_id = "luminovia-portal-pr-5-[a-f0-9]{12}"/,
    );
    assert.match(started.config, /port = 57321/);
    assert.match(started.config, /site_url = "http:\/\/127.0.0.1:5473"/);
    assert.doesNotMatch(started.config, /^project_id = "luminovia-portal"$/m);
    writeFileSync(
      join(output, ".preview/source/.local/fictional.txt"),
      "edited retained fictional state",
    );
    assert.equal(run("stop").action, "stop");
    assert.equal(run("start").action, "start");
    assert.equal(
      readFileSync(
        join(output, ".preview/source/.local/fictional.txt"),
        "utf8",
      ),
      "edited retained fictional state",
    );
    assert.equal(
      readFileSync(join(output, "portal/supabase/config.toml"), "utf8"),
      canonical,
    );
    assert.deepEqual(
      readFileSync(join(output, "portal-source.tar.gz")),
      archive,
    );
    assert.equal(existsSync(join(output, "portal/.local")), false);
    const second = packageFixture(fixture, "other-package");
    assert.notEqual(
      preparePackagedPreview(second).project,
      preparePackagedPreview(output).project,
    );
  });
});

test("preview preparation refuses changed archive/config, foreign ownership markers and symlink state", () => {
  withRepository((fixture) => {
    for (const [index, mutate] of [
      (output) =>
        writeFileSync(join(output, "portal-source.tar.gz"), "changed archive"),
      (output) =>
        writeFileSync(
          join(output, "portal/supabase/config.toml"),
          'project_id="luminovia-portal"',
        ),
      (output) => {
        preparePackagedPreview(output);
        writeFileSync(join(output, ".preview/owner.json"), "{}");
      },
      (output) => {
        preparePackagedPreview(output);
        writeFileSync(
          join(output, ".preview/source/supabase/config.toml"),
          'project_id="luminovia-portal"',
        );
      },
      (output) => {
        preparePackagedPreview(output);
        symlinkSync(fixture.cwd, join(output, ".preview/source/.local"));
      },
    ].entries()) {
      const output = packageFixture(fixture, `refused-${index}`);
      mutate(output);
      assert.throws(
        () => preparePackagedPreview(output),
        /checksum|pristine|another source|identity or ports|symlink/,
      );
    }
  });
});

test("package fixtures stay canonical inside the complete runner's rewritten test source", () => {
  const directory = mkdtempSync(
    join(tmpdir(), "luminovia-pr-overlay-fixture-"),
  );
  try {
    mkdirSync(join(directory, "supabase"));
    writeFileSync(
      join(directory, "supabase/config.toml"),
      canonicalConfig.replaceAll("543", "553").replaceAll(":5173", ":5273"),
    );
    mkdirSync(join(directory, "scripts"));
    for (const name of [
      "runtime-pr-previews.test.mjs",
      "pr-preview-package.mjs",
      "pr-preview-deployments.mjs",
      "runtime-pr-preview.mjs",
      "runtime-github-config.mjs",
      "runtime-snapshot.mjs",
    ])
      cpSync(new URL(name, import.meta.url), join(directory, "scripts", name));
    const result = execFileSync(
      process.execPath,
      [
        "--test",
        "--test-name-pattern=actual packaged launcher isolates",
        "scripts/runtime-pr-previews.test.mjs",
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 15_000,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !key.startsWith("NODE_TEST_"),
          ),
        ),
      },
    );
    assert.match(result, /pass 1/);
    assert.equal(
      readFileSync(join(directory, "supabase/config.toml"), "utf8"),
      canonicalConfig.replaceAll("543", "553").replaceAll(":5173", ":5273"),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("committed private files or an incorrect tested revision refuse package creation", () => {
  withRepository(({ cwd, directory, git, testedSha }) => {
    const args = {
      cwd,
      output: join(directory, "refused"),
      headSha: head,
      testedSha,
      runId: 41,
      runAttempt: 1,
      number: 5,
    };
    assert.throws(
      () => createPreviewPackage({ ...args, testedSha: "d".repeat(40) }),
      /differs/,
    );
    assert.equal(existsSync(args.output), false);
    writeFileSync(join(cwd, ".env.test.local"), "fictional-fixture-key");
    git("add", ".");
    git(
      "commit",
      "--quiet",
      "-m",
      "fixture containing disallowed generated file",
    );
    assert.throws(
      () =>
        createPreviewPackage({ ...args, testedSha: git("rev-parse", "HEAD") }),
      /Private or generated/,
    );
    assert.equal(existsSync(args.output), false);
  });
});

test("privileged workflow uses only trusted default-branch metadata code; producer stays read-only", () => {
  const writer = readFileSync(
    new URL("../.github/workflows/pr-previews.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    writer,
    /ref: \$\{\{ github.event.repository.default_branch \}\}/,
  );
  assert.match(writer, /deployments: write/);
  assert.match(writer, /workflow_dispatch:/);
  assert.doesNotMatch(writer, /workflow_run:|pull_request_target:|schedule:/);
  assert.doesNotMatch(
    writer,
    /secrets\.|npm |download-artifact@|head\.sha|head_ref|contents: write|pull-requests: write/,
  );
  const ci = readFileSync(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    ci,
    /preview-package:[\s\S]*?needs: \[quality, coverage, verify, verify-selfhost, scope\]/,
  );
  assert.match(ci, /retention-days: 7/);
  const producer = ci.slice(
    ci.indexOf("  preview-package:"),
    ci.indexOf("  release-cms:"),
  );
  assert.doesNotMatch(producer, /secrets\.|deployments: write|GH_TOKEN/);
});
