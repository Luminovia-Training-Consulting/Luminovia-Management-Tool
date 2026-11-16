/**
 * Real temporary Git repositories check the local preview/update contract.
 * Fictional runtime programs exercise ownership, source protection and persistence without hosted services.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { GitHubPreview } from "./runtime-github.mjs";
import { githubPreviewConfig } from "./runtime-github-config.mjs";
import { root } from "./runtime-lib.mjs";

// The surrounding canonical QA run deliberately rewrites its own TOML to
// 553xx/5273. A fictional upstream must retain the NORMAL upstream layout;
// copying the runner's already-overlaid config couples independent fixtures.
const fixtureConfig = `project_id = "luminovia-portal"
[api]
port = 54321
[db]
port = 54322
shadow_port = 54320
major_version = 17
[db.pooler]
port = 54329
[studio]
port = 54323
[inbucket]
port = 54324
[auth]
site_url = "http://127.0.0.1:5173"
additional_redirect_urls = ["http://127.0.0.1:5173/auth/callback"]
[edge_runtime]
inspector_port = 8083
`;

/** Runs Git only inside the currently owned temporary fixture repository. */
function git(directory, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fictional Preview Fixture",
      "-c",
      "user.email=preview@example.invalid",
      "-C",
      directory,
      ...args,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
}
const fixtureRuntime = `import {readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const action=process.argv[2];mkdirSync('.local',{recursive:true,mode:0o700});
assert.equal(process.env.GH_TOKEN,undefined);assert.equal(process.env.SUPABASE_SERVICE_ROLE_KEY,undefined);
appendFileSync('.local/calls',action+'\\n');
if(action==='start'){
 const config=readFileSync('supabase/config.toml','utf8');assert.match(config,/site_url = "http:\\/\\/127.0.0.1:5373"/);assert.match(config,/port = 56321/);
 if(!existsSync('.local/password'))writeFileSync('.local/password','fictional-private-password');
 if(!existsSync('.local/object.bin'))writeFileSync('.local/object.bin',Buffer.from([0,1,255,42]));
 writeFileSync('.env.local','VITE_SUPABASE_URL=http://127.0.0.1:56321\\n');
}
if(action==='test'){
 assert.match(readFileSync('supabase/config.toml','utf8'),/site_url = "http:\\/\\/127.0.0.1:5173"/);
 writeFileSync('.local/test-proof','isolated-test-invocation');
}
console.log('fixture '+action);
`;

/** Creates a temporary upstream, seed checkout and launcher with a fictional runtime; tests own subsequent cleanup. */
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "portal-github-fixture-"));
  const remote = join(directory, "remote.git");
  const seed = join(directory, "seed");
  const checkout = join(directory, "launcher");
  for (const path of [remote, seed, checkout]) mkdirSync(path, { mode: 0o700 });
  git(remote, "init", "--bare", "--quiet");
  git(seed, "init", "--initial-branch=main", "--quiet");
  for (const path of ["scripts", "supabase/migrations"])
    mkdirSync(join(seed, path), { recursive: true });
  writeFileSync(join(seed, "portal"), "#!/bin/sh\nexit 0\n");
  writeFileSync(join(seed, "package.json"), "{}\n");
  writeFileSync(join(seed, "package-lock.json"), "{}\n");
  writeFileSync(join(seed, "supabase/config.toml"), fixtureConfig);
  copyFileSync(join(root, ".gitignore"), join(seed, ".gitignore"));
  writeFileSync(join(seed, "scripts/runtime-cli.mjs"), fixtureRuntime);
  writeFileSync(
    join(seed, "supabase/migrations/20260101000000_first.sql"),
    "begin;\ncreate table public.preview_fixture(id uuid);\ncommit;\n",
  );
  mkdirSync(join(checkout, "deploy/hostinger/updates"), { recursive: true });
  copyFileSync(
    join(root, "deploy/hostinger/updates/updater.py"),
    join(checkout, "deploy/hostinger/updates/updater.py"),
  );
  git(seed, "remote", "add", "origin", pathToFileURL(remote).href);
  /** Creates the next fictional source revision whose exact SHA is checked by the preview contract. */
  function commit(message = "fixture source") {
    git(seed, "add", ".");
    git(seed, "commit", "--quiet", "-m", message);
    git(seed, "push", "--quiet", "--force", "origin", "main");
    return git(seed, "rev-parse", "HEAD");
  }
  const first = commit();
  const preview = new GitHubPreview({
    checkout,
    fixtureRepository: pathToFileURL(remote).href,
  });
  return {
    directory,
    remote,
    seed,
    checkout,
    first,
    preview,
    commit,
    /** Removes resources created by this run; cleanup must not hide a business assertion failure. */
    cleanup() {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

test("latest checkout is pinned, updates preserve its own private bytes and never edit launcher data", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.checkout, ".local"));
    writeFileSync(join(f.checkout, ".local/normal-password"), "normal-keep");
    writeFileSync(join(f.checkout, "dirty-source.txt"), "uncommitted-keep");
    const first = await f.preview.fetchLatest();
    assert.equal(first.sha, f.first);
    await f.preview.apply(first);
    assert.equal(f.preview.state().sha, f.first);
    const ownData = join(f.preview.source, ".local");
    writeFileSync(join(ownData, "password"), "changed-preview-password");
    const object = readFileSync(join(ownData, "object.bin"));
    writeFileSync(join(f.seed, "new-feature.txt"), "new remote version");
    const second = f.commit();
    await f.preview.apply(await f.preview.fetchLatest());
    assert.equal(f.preview.state().sha, second);
    assert.equal(
      readFileSync(join(ownData, "password"), "utf8"),
      "changed-preview-password",
    );
    assert.deepEqual(readFileSync(join(ownData, "object.bin")), object);
    assert.equal(
      readFileSync(join(ownData, "calls"), "utf8"),
      "start\nstop\nstart\n",
    );
    assert.equal(
      readFileSync(join(f.checkout, ".local/normal-password"), "utf8"),
      "normal-keep",
    );
    assert.equal(
      readFileSync(join(f.checkout, "dirty-source.txt"), "utf8"),
      "uncommitted-keep",
    );
    assert.match(
      readFileSync(join(f.preview.source, "supabase/config.toml"), "utf8"),
      /project_id = "luminovia-portal-github-[a-f0-9]{12}"/,
    );
    assert.equal(
      git(f.preview.source, "remote", "get-url", "--push", "origin"),
      "disabled://preview-never-push",
    );
  } finally {
    f.cleanup();
  }
});

test("edited preview source or generated config is refused without overwriting it", async () => {
  const f = fixture();
  try {
    await f.preview.apply(await f.preview.fetchLatest());
    const path = join(f.preview.source, "portal");
    writeFileSync(path, "my-uncommitted-edit");
    await assert.rejects(f.preview.fetchLatest(), /edited or untracked source/);
    assert.equal(readFileSync(path, "utf8"), "my-uncommitted-edit");
    git(f.preview.source, "checkout", "HEAD", "--", "portal");
    const config = join(f.preview.source, "supabase/config.toml");
    writeFileSync(config, "manual-project-redirect");
    await assert.rejects(f.preview.fetchLatest(), /configuration was edited/);
    assert.equal(readFileSync(config, "utf8"), "manual-project-redirect");
    assert.equal(
      readFileSync(join(f.preview.source, ".local/calls"), "utf8"),
      "start\n",
    );
  } finally {
    f.cleanup();
  }
});

test("rewritten migrations and PostgreSQL-major changes cannot update persistent preview", async () => {
  const f = fixture();
  try {
    await f.preview.apply(await f.preview.fetchLatest());
    writeFileSync(
      join(f.seed, "supabase/migrations/20260101000000_first.sql"),
      "begin;\ndrop table public.preview_fixture;\ncommit;\n",
    );
    f.commit();
    await assert.rejects(f.preview.fetchLatest(), /Historical migration/);
    git(
      f.seed,
      "checkout",
      f.first,
      "--",
      "supabase/migrations/20260101000000_first.sql",
    );
    const path = join(f.seed, "supabase/config.toml");
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        "major_version = 17",
        "major_version = 18",
      ),
    );
    f.commit();
    await assert.rejects(f.preview.fetchLatest(), /PostgreSQL major/);
    assert.equal(f.preview.state().sha, f.first);
    assert.equal(
      readFileSync(join(f.preview.source, ".local/calls"), "utf8"),
      "start\n",
    );
  } finally {
    f.cleanup();
  }
});

test("new risky migrations require the exact current plan before any stop/update", async () => {
  const f = fixture();
  try {
    await f.preview.apply(await f.preview.fetchLatest());
    writeFileSync(
      join(f.seed, "supabase/migrations/20260102000000_review.sql"),
      "begin;\nalter table public.preview_fixture drop column id;\ncommit;\n",
    );
    f.commit();
    const plan = await f.preview.fetchLatest();
    assert.equal(plan.review.length, 1);
    await assert.rejects(f.preview.apply(plan), /require review/);
    await assert.rejects(
      f.preview.apply(plan, "0".repeat(64)),
      /require review/,
    );
    assert.equal(
      readFileSync(join(f.preview.source, ".local/calls"), "utf8"),
      "start\n",
    );
    await f.preview.apply(plan, plan.digest);
    assert.equal(f.preview.state().sha, plan.sha);
    assert.equal(
      readFileSync(join(f.preview.source, ".local/password"), "utf8"),
      "fictional-private-password",
    );
  } finally {
    f.cleanup();
  }
});

test("latest full test uses another exact worktree without updating or stopping preview", async () => {
  const f = fixture();
  try {
    await f.preview.apply(await f.preview.fetchLatest());
    writeFileSync(join(f.seed, "new-feature.txt"), "new-not-yet-in-preview");
    const latest = f.commit();
    await f.preview.testLatest(await f.preview.fetchLatest());
    assert.equal(f.preview.state().sha, f.first);
    assert.equal(git(f.preview.source, "rev-parse", "HEAD"), f.first);
    assert.equal(
      readFileSync(join(f.preview.source, ".local/calls"), "utf8"),
      "start\n",
    );
    assert(!existsSync(join(f.preview.source, "new-feature.txt")));
    assert.equal(
      readFileSync(
        join(f.preview.base, `test-${latest}/.local/test-proof`),
        "utf8",
      ),
      "isolated-test-invocation",
    );
  } finally {
    f.cleanup();
  }
});

test("remote changes, rewinds and symlinked private state are refused", async () => {
  const f = fixture();
  try {
    await f.preview.apply(await f.preview.fetchLatest());
    git(
      f.preview.source,
      "remote",
      "set-url",
      "origin",
      "https://untrusted.example.invalid/repo.git",
    );
    await assert.rejects(f.preview.fetchLatest(), /remote was changed/);
    git(
      f.preview.source,
      "remote",
      "set-url",
      "origin",
      pathToFileURL(f.remote).href,
    );
    writeFileSync(join(f.seed, "feature"), "next");
    const second = f.commit();
    await f.preview.apply(await f.preview.fetchLatest());
    git(f.seed, "reset", "--hard", f.first);
    git(f.seed, "push", "--quiet", "--force", "origin", "main");
    await assert.rejects(f.preview.fetchLatest(), /no longer descends/);
    assert.equal(f.preview.state().sha, second);
    const victim = join(f.directory, "victim");
    mkdirSync(victim);
    writeFileSync(join(victim, "proof"), "unchanged");
    symlinkSync(victim, join(f.preview.source, ".local/foreign"));
    await assert.rejects(f.preview.runtime("stop"), /symlinked private/);
    assert.equal(readFileSync(join(victim, "proof"), "utf8"), "unchanged");
  } finally {
    f.cleanup();
  }
});

test("dangling test and private-state symlinks are rejected before Git or runtime can follow them", async () => {
  const f = fixture();
  try {
    const plan = await f.preview.fetchLatest();
    await f.preview.apply(plan);
    const outside = join(f.directory, "outside-not-created");
    const testDirectory = join(f.preview.base, `test-${plan.sha}`);
    symlinkSync(outside, testDirectory);
    await assert.rejects(
      f.preview.testLatest(plan),
      /symlinked GitHub preview directory/,
    );
    assert(!existsSync(outside));
    rmSync(testDirectory);
    rmSync(join(f.preview.source, ".local"), { recursive: true });
    symlinkSync(outside, join(f.preview.source, ".local"));
    await assert.rejects(
      f.preview.runtime("start"),
      /symlinked private preview state/,
    );
    assert(!existsSync(outside));
  } finally {
    f.cleanup();
  }
});

test("preview config has independent loopback identities and fails on incompatible origins", () => {
  const source = fixtureConfig;
  const result = githubPreviewConfig(
    source,
    "luminovia-portal-github-aabbccddeeff",
  );
  assert.match(result, /site_url = "http:\/\/127.0.0.1:5373"/);
  assert.match(result, /shadow_port = 56320/);
  assert.match(result, /port = 56321/);
  assert.match(result, /inspector_port = 56383/);
  assert.throws(
    () => githubPreviewConfig(source, "../../other"),
    /Invalid owned/,
  );
  assert.throws(
    () =>
      githubPreviewConfig(
        source.replace(
          "http://127.0.0.1:5173",
          "https://hosted.example.invalid",
        ),
        "luminovia-portal-github-aabbccddeeff",
      ),
    /Unexpected Auth/,
  );
});

test("recorded interruption between checkout and config write recovers without resetting data", async () => {
  const f = fixture();
  try {
    await f.preview.apply(await f.preview.fetchLatest());
    writeFileSync(join(f.seed, "new-feature.txt"), "new source");
    const latest = f.commit();
    await f.preview.fetchLatest();
    writeFileSync(
      join(f.preview.base, "transition.json"),
      JSON.stringify({ from: f.first, to: latest }),
    );
    git(f.preview.source, "checkout", "HEAD", "--", "supabase/config.toml");
    git(f.preview.source, "checkout", "--detach", latest);
    const plan = await f.preview.fetchLatest();
    assert.equal(plan.sha, latest);
    assert.equal(f.preview.state().sha, latest);
    assert(!existsSync(join(f.preview.base, "transition.json")));
    assert.match(
      readFileSync(join(f.preview.source, "supabase/config.toml"), "utf8"),
      /port = 56321/,
    );
    assert.equal(
      readFileSync(join(f.preview.source, ".local/password"), "utf8"),
      "fictional-private-password",
    );
    assert.equal(
      readFileSync(join(f.preview.source, ".local/calls"), "utf8"),
      "start\n",
    );
  } finally {
    f.cleanup();
  }
});

test("kernel lock serialises commands and releases after its owning subprocess exits", async () => {
  const f = fixture();
  const ready = join(f.directory, "ready");
  const code = `import {GitHubPreview} from ${JSON.stringify(pathToFileURL(join(root, "scripts/runtime-github.mjs")).href)};
import {writeFileSync} from 'node:fs';const p=new GitHubPreview(${JSON.stringify({ checkout: f.checkout, fixtureRepository: pathToFileURL(f.remote).href })});
await p.locked(async()=>{writeFileSync(${JSON.stringify(ready)},'ready');await new Promise(r=>setTimeout(r,15000));});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    stdio: "ignore",
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  try {
    const deadline = Date.now() + 3000;
    while (!existsSync(ready) && Date.now() < deadline) await delay(10);
    assert(existsSync(ready));
    await assert.rejects(
      f.preview.locked(async () => {}),
      /läuft bereits/,
    );
    child.kill("SIGKILL");
    await closed;
    await f.preview.locked(async () =>
      assert.equal(readFileSync(ready, "utf8"), "ready"),
    );
  } finally {
    child.kill("SIGKILL");
    await closed;
    f.cleanup();
  }
});

test("canonical QA and preview overlays cannot be nested", () => {
  assert.throws(
    () =>
      githubPreviewConfig(
        fixtureConfig.replaceAll("543", "553").replaceAll(":5173", ":5273"),
        "luminovia-portal-github-abcdef012345",
      ),
    /Unknown local port layout/,
  );
  const preview = githubPreviewConfig(
    fixtureConfig,
    "luminovia-portal-github-abcdef012345",
  );
  assert.throws(
    () => githubPreviewConfig(preview, "luminovia-portal-github-abcdef012345"),
    /Unknown local port layout/,
  );
});
