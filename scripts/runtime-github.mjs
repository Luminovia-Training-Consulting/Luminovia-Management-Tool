/**
 * Manages an owned local GitHub preview pinned to exact main SHAs.
 * Ownership, unchanged migration history and reviewed transitions protect its persistent development data.
 */
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  command,
  cleanEnvironment,
  privateWrite,
  root,
} from "./runtime-lib.mjs";
import { acquireTestLock } from "./runtime-test-lock.mjs";
import { githubPreviewConfig } from "./runtime-github-config.mjs";

const repository =
  "https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git";
/** Calculates a stable content fingerprint; a hash does not replace resource authorisation. */
const hash = (value) => createHash("sha256").update(value).digest("hex");
const shaPattern = /^[a-f0-9]{40}$/;
const migrationPattern = /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/;

/** Requires an owned real directory without symlinks and keeps the preview area private. */
function ownedDirectory(path) {
  let info = lstatSync(path, { throwIfNoEntry: false });
  if (!info) {
    mkdirSync(path, { mode: 0o700 });
    info = lstatSync(path);
  }
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid()
  )
    throw new Error("Unowned or symlinked GitHub preview directory refused.");
  chmodSync(path, 0o700);
}
/** Reads only an owned regular file; symlinked or foreign state is rejected by the ownership checks. */
function regularFile(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid())
    throw new Error("Unowned or symlinked GitHub preview file refused.");
  return readFileSync(path, "utf8");
}
/** Decodes the checked private record while preserving a clear error boundary. */
function jsonFile(path) {
  const source = regularFile(path);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error("Invalid private GitHub preview JSON record.");
  }
}
/** Removes Git variables that redirect commands and disables interactive credential prompts. */
function gitEnvironment() {
  const env = cleanEnvironment();
  for (const key of Object.keys(env))
    if (
      /^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG|TRACE|CURL_VERBOSE)/.test(
        key,
      )
    )
      delete env[key];
  return { ...env, GIT_TERMINAL_PROMPT: "0" };
}
/** Also removes Git/npm tokens before starting the local runtime fetched from GitHub. */
function runtimeEnvironment() {
  const env = cleanEnvironment();
  for (const key of Object.keys(env))
    if (
      /^(?:GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN|GIT_.*)$/.test(
        key,
      )
    )
      delete env[key];
  return env;
}
const policyScript = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("portal_preview_policy",sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
results=[]
for item in json.load(open(sys.argv[2])):
 try: module.compatible_migration(item["source"])
 except module.UpdateError as error: results.append({"path":item["path"],"reason":str(error)})
print(json.dumps(results))`;

/** One private clone per launcher checkout. Fixture transport is deliberately
 * internal-only: the CLI never accepts a URL, ref, checkout path or token. */
export class GitHubPreview {
  /** Binds clone, project and owner to this checkout; the test transport exception accepts only temporary file fixtures. */
  constructor({ checkout = root, fixtureRepository } = {}) {
    this.checkout = realpathSync(checkout);
    this.repository = repository;
    if (fixtureRepository) {
      const url = new URL(fixtureRepository);
      if (
        url.protocol !== "file:" ||
        url.hostname ||
        !realpathSync(fileURLToPath(url)).startsWith(
          realpathSync(tmpdir()) + "/",
        )
      )
        throw new Error(
          "Only an owned local temporary Git fixture is allowed.",
        );
      this.repository = fixtureRepository;
    }
    this.base = join(this.checkout, ".local/github-preview");
    this.source = join(this.base, "source");
    this.project = `luminovia-portal-github-${hash(this.checkout).slice(0, 12)}`;
    this.owner = {
      version: 1,
      checkout: this.checkout,
      repository: this.repository,
      project: this.project,
    };
  }
  /** Registers the private preview owner and rejects an existing unregistered source tree. */
  initialise() {
    ownedDirectory(join(this.checkout, ".local"));
    ownedDirectory(this.base);
    const file = join(this.base, "owner.json");
    if (existsSync(file)) {
      if (JSON.stringify(jsonFile(file)) !== JSON.stringify(this.owner))
        throw new Error(
          "GitHub preview belongs to another checkout or source.",
        );
    } else {
      if (existsSync(this.source))
        throw new Error("Unregistered preview source refused.");
      privateWrite(file, JSON.stringify(this.owner));
    }
  }
  /** Serialises preview commands with the owned kernel lock and releases it in finally. */
  async locked(operation) {
    this.initialise();
    let release;
    try {
      release = acquireTestLock({
        directory: join(this.base, "command-lock"),
        checkout: this.checkout,
      });
    } catch (error) {
      if (error.message.includes("Ein isolierter Portal-Test läuft bereits"))
        throw new Error(
          "Ein GitHub-Vorschaubefehl läuft bereits; warte auf dessen Abschluss.",
          { cause: error },
        );
      throw error;
    }
    try {
      return await operation();
    } finally {
      release();
    }
  }
  /** Runs Git without repository hooks and without passing arbitrary transport diagnostics to the caller. */
  async git(args, cwd = this.source) {
    return await command(
      "git",
      ["-c", "core.hooksPath=/dev/null", "-C", cwd, ...args],
      {
        cwd: this.checkout,
        env: gitEnvironment(),
        quiet: true,
        timeoutMs: 120000,
      },
    ).catch(() => {
      // Git transport diagnostics can include a credential-helper URL. Report
      // the operation without forwarding arbitrary transport output.
      throw new Error(
        `Git ${args[0]} failed; check access/network and the managed checkout. No stale source was started.`,
      );
    });
  }
  /** Validates the recorded source SHA and configuration hash before use. */
  state() {
    const file = join(this.base, "source.json");
    if (!existsSync(file)) return null;
    const state = jsonFile(file);
    if (!shaPattern.test(state.sha) || !/^[a-f0-9]{64}$/.test(state.configHash))
      throw new Error("Invalid GitHub preview source record.");
    return state;
  }
  /** Checks remote, HEAD, overlay hash and edits; manually changed source is never overwritten. */
  async validateSource() {
    if (!existsSync(this.source)) return;
    ownedDirectory(this.source);
    ownedDirectory(join(this.source, ".git"));
    if (
      (await this.git(["remote", "get-url", "origin"])).trim() !==
      this.repository
    )
      throw new Error(
        "GitHub preview remote was changed; refusing its source.",
      );
    await this.recoverTransition();
    const state = this.state();
    if (!state) {
      const head = await this.git(["rev-parse", "--verify", "HEAD"]).catch(
        () => "",
      );
      if (head.trim())
        throw new Error("Unregistered GitHub preview HEAD refused.");
      return;
    }
    if ((await this.git(["rev-parse", "HEAD"])).trim() !== state.sha)
      throw new Error("GitHub preview HEAD was changed manually.");
    const config = regularFile(join(this.source, "supabase/config.toml"));
    if (hash(config) !== state.configHash)
      throw new Error(
        "Generated preview configuration was edited; no data was touched.",
      );
    const dirty = (
      await this.git(["status", "--porcelain", "--untracked-files=all"])
    ).trim();
    if (
      dirty &&
      dirty !== "M supabase/config.toml" &&
      dirty !== " M supabase/config.toml"
    )
      throw new Error(
        "Preview contains edited or untracked source; preserve your changes before updating.",
      );
  }
  /** Repairs only the recorded checkout/overlay write interruption window; this is not database rollback. */
  async recoverTransition() {
    const path = join(this.base, "transition.json");
    if (!existsSync(path)) return;
    const transition = jsonFile(path);
    if (
      !shaPattern.test(transition.to) ||
      (transition.from !== null && !shaPattern.test(transition.from))
    )
      throw new Error("Invalid interrupted GitHub update record.");
    const head = (
      await this.git(["rev-parse", "--verify", "HEAD"]).catch(() => "")
    ).trim();
    if (!head && transition.from === null) {
      unlinkSync(path);
      return;
    }
    if (head !== transition.to && head !== transition.from)
      throw new Error(
        "Interrupted preview update has an unexpected HEAD; source is unchanged.",
      );
    const dirty = (
      await this.git(["status", "--porcelain", "--untracked-files=all"])
    ).trim();
    if (
      dirty &&
      dirty !== "M supabase/config.toml" &&
      dirty !== " M supabase/config.toml"
    )
      throw new Error(
        "Interrupted preview update contains user edits; refusing recovery.",
      );
    const canonical = await this.git(["show", `${head}:supabase/config.toml`]);
    const overlay = githubPreviewConfig(canonical, this.project);
    const current = regularFile(join(this.source, "supabase/config.toml"));
    if (current !== canonical && current !== overlay)
      throw new Error(
        "Interrupted preview configuration was manually changed; refusing recovery.",
      );
    // Recover only the recorded checkout/config write window. No database or
    // object rollback happens here; the native runtime owns migration history.
    privateWrite(join(this.source, "supabase/config.toml"), overlay);
    privateWrite(
      join(this.base, "source.json"),
      JSON.stringify({ sha: head, configHash: hash(overlay) }) + "\n",
    );
    unlinkSync(path);
  }
  /** Pins latest main to an exact SHA, checks history/migrations and builds a source-bound review plan. */
  async fetchLatest() {
    this.initialise();
    if (!existsSync(this.source)) {
      ownedDirectory(this.source);
      await this.git(["init", "--quiet"]);
      await this.git(["remote", "add", "origin", this.repository]);
      await this.git([
        "config",
        "remote.origin.pushurl",
        "disabled://preview-never-push",
      ]);
    }
    await this.validateSource();
    await this.git([
      "fetch",
      "--no-tags",
      "origin",
      "+refs/heads/main:refs/remotes/origin/main",
    ]);
    const sha = (
      await this.git(["rev-parse", "refs/remotes/origin/main"])
    ).trim();
    if (!shaPattern.test(sha))
      throw new Error("GitHub did not return an exact main commit.");
    const state = this.state();
    if (state && state.sha !== sha)
      await this.git(["merge-base", "--is-ancestor", state.sha, sha]).catch(
        () => {
          throw new Error(
            "GitHub main no longer descends from the preview; rollback/reset is refused.",
          );
        },
      );
    const entries = (await this.git(["ls-tree", "-r", "--name-only", sha]))
      .trim()
      .split("\n");
    for (const path of entries)
      if (
        /^(?:\.local\/|node_modules\/|\.env(?!\.example$)|supabase\/\.(?:temp|branches)\/)/.test(
          path,
        )
      )
        throw new Error(
          "Latest source tracks private/generated state; refusing checkout.",
        );
    for (const path of [
      "portal",
      "package.json",
      "package-lock.json",
      "scripts/runtime-cli.mjs",
      "supabase/config.toml",
    ])
      if (!entries.includes(path))
        throw new Error(
          "Latest source does not support the local Portal runtime.",
        );
    const config = await this.git(["show", `${sha}:supabase/config.toml`]);
    githubPreviewConfig(config, this.project);
    const major = /^major_version\s*=\s*(\d+)/m.exec(config)?.[1];
    if (state) {
      const before = await this.git([
        "show",
        `${state.sha}:supabase/config.toml`,
      ]);
      if (/^major_version\s*=\s*(\d+)/m.exec(before)?.[1] !== major)
        throw new Error(
          "PostgreSQL major changes need an explicit migration; preview data is unchanged.",
        );
    }
    const paths = entries.filter((path) => migrationPattern.test(path)).sort();
    const oldPaths = state
      ? (
          await this.git([
            "ls-tree",
            "-r",
            "--name-only",
            state.sha,
            "supabase/migrations",
          ])
        )
          .trim()
          .split("\n")
          .filter((path) => migrationPattern.test(path))
      : [];
    for (const path of oldPaths) {
      if (
        !paths.includes(path) ||
        (await this.git(["rev-parse", `${state.sha}:${path}`])).trim() !==
          (await this.git(["rev-parse", `${sha}:${path}`])).trim()
      )
        throw new Error(
          "Historical migration changed or disappeared; preview data is unchanged.",
        );
    }
    const migrations = [];
    for (const path of paths.filter((path) => !oldPaths.includes(path))) {
      if (oldPaths.length && path <= oldPaths.at(-1))
        throw new Error(
          "Backdated migration refused; preview data is unchanged.",
        );
      const source = await this.git(["show", `${sha}:${path}`]);
      migrations.push({ path, source, sha256: hash(source) });
    }
    let review = [];
    if (state && migrations.length) {
      const policyFile = join(this.base, "migration-sources.json");
      privateWrite(policyFile, JSON.stringify(migrations));
      review = JSON.parse(
        await command(
          "python3",
          [
            "-c",
            policyScript,
            join(this.checkout, "deploy/hostinger/updates/updater.py"),
            policyFile,
          ],
          { quiet: true },
        ),
      );
    }
    const digest = hash(
      JSON.stringify({
        sha,
        previous: state?.sha ?? null,
        migrations: migrations.map(({ path, sha256 }) => ({ path, sha256 })),
      }),
    );
    const plan = {
      sha,
      previous: state?.sha ?? null,
      project: this.project,
      migrations: migrations.map(({ path }) => path),
      review,
      digest,
    };
    privateWrite(
      join(this.base, "plan.json"),
      JSON.stringify(plan, null, 2) + "\n",
    );
    return plan;
  }
  /** Checks private preview files recursively before starting that source's CLI with a sanitised environment. */
  async runtime(action, directory = this.source) {
    for (const name of [".env.local", ".env.test.local"])
      if (existsSync(join(directory, name))) regularFile(join(directory, name));
    /** Checks ownership and absence of symlinks throughout the private runtime tree. */
    const inspect = (path) => {
      const info = lstatSync(path);
      if (info.isSymbolicLink() || info.uid !== process.getuid())
        throw new Error("Foreign or symlinked private preview state refused.");
      if (info.isDirectory())
        for (const name of readdirSync(path)) inspect(join(path, name));
    };
    if (lstatSync(join(directory, ".local"), { throwIfNoEntry: false }))
      inspect(join(directory, ".local"));
    return await command(
      process.execPath,
      [join(directory, "scripts/runtime-cli.mjs"), action],
      {
        cwd: directory,
        env: runtimeEnvironment(),
        timeoutMs: action === "test" ? 1800000 : 720000,
      },
    );
  }
  /** Requires the exact plan digest for reviewed migrations and records the source transition so it can resume. */
  async apply(plan, accepted) {
    if (plan.review.length && accepted !== plan.digest)
      throw new Error(
        `New migrations require review. Run ./portal github plan, inspect its files, then explicitly use ./portal github update --accept-migration-plan ${plan.digest}`,
      );
    const before = this.state();
    if (before?.sha !== plan.sha) {
      privateWrite(
        join(this.base, "transition.json"),
        JSON.stringify({ from: before?.sha ?? null, to: plan.sha }) + "\n",
      );
      if (before) {
        await this.runtime("stop");
        await this.git(["checkout", "HEAD", "--", "supabase/config.toml"]);
      }
      await this.git([
        "checkout",
        "--detach",
        "--no-overwrite-ignore",
        plan.sha,
      ]);
      const path = join(this.source, "supabase/config.toml");
      const config = githubPreviewConfig(regularFile(path), this.project);
      privateWrite(path, config);
      privateWrite(
        join(this.base, "source.json"),
        JSON.stringify({ sha: plan.sha, configHash: hash(config) }) + "\n",
      );
      unlinkSync(join(this.base, "transition.json"));
    }
    console.log(
      `GitHub main: ${plan.sha}\nVorschau: http://127.0.0.1:5373\nEigenes Projekt: ${this.project}`,
    );
    await this.runtime("start");
  }
  /** Tests the same exact SHA in a separate managed worktree without switching the persistent preview. */
  async testLatest(plan) {
    const directory = join(this.base, `test-${plan.sha}`);
    // Validate even dangling symlinks before Git receives the target path.
    ownedDirectory(directory);
    if (
      !existsSync(join(directory, ".git")) &&
      readdirSync(directory).length === 0
    )
      await this.git(["worktree", "add", "--detach", directory, plan.sha]);
    const linked = /^gitdir: (.+)\n?$/.exec(
      regularFile(join(directory, ".git")),
    )?.[1];
    if (
      !linked ||
      !realpathSync(linked).startsWith(
        realpathSync(join(this.source, ".git")) + "/worktrees/",
      )
    )
      throw new Error(
        "Managed test metadata points outside its owning Git clone.",
      );
    if (
      (await this.git(["rev-parse", "HEAD"], directory)).trim() !== plan.sha ||
      (
        await this.git(
          ["status", "--porcelain", "--untracked-files=all"],
          directory,
        )
      ).trim()
    )
      throw new Error(
        "Managed test checkout was changed; refusing to overwrite it.",
      );
    console.log(
      `Teste exakten GitHub-Stand ${plan.sha}; Vorschau und Entwicklungsdaten bleiben erhalten.`,
    );
    await this.runtime("test", directory);
    console.log(`Testprotokolle: ${directory}/.local/tests/`);
  }
  /** Shows the recorded source revision and only an actual supervisor state matching this session. */
  status() {
    this.initialise();
    const source = this.state();
    let phase = "nicht gestartet";
    if (source) {
      const path = join(this.source, ".local/runtime.json");
      if (existsSync(path)) {
        const state = jsonFile(path);
        const valid =
          Number.isInteger(state.pid) &&
          state.pid > 1 &&
          /^[a-f0-9-]{36}$/.test(state.session ?? "");
        try {
          const args = valid
            ? readFileSync(`/proc/${state.pid}/cmdline`, "utf8")
            : "";
          phase =
            args.includes(
              join(this.source, "scripts/runtime-supervisor.mjs"),
            ) && args.includes(state.session)
              ? state.phase
              : "gestoppt";
        } catch {
          phase = "gestoppt";
        }
      }
    }
    console.log(
      `GitHub-Vorschau: ${phase}\nCommit: ${source?.sha ?? "noch keiner"}\nPortal: http://127.0.0.1:5373\nSupabase: http://127.0.0.1:56321\nMailpit: http://127.0.0.1:56324\nQuelle/Protokolle: ${this.source}`,
    );
  }
}

/** Validates the small allowed CLI command set; arbitrary remotes, tokens and target paths are not options. */
export async function githubPreviewCommand(args = []) {
  const action = args[0] ?? "start";
  const accepted =
    args.length === 3 &&
    args[1] === "--accept-migration-plan" &&
    /^[a-f0-9]{64}$/.test(args[2])
      ? args[2]
      : undefined;
  if (
    ![
      "start",
      "update",
      "test",
      "plan",
      "status",
      "stop",
      "credentials",
    ].includes(action) ||
    (args.length > 1 && !(action === "update" && accepted))
  )
    throw new Error(
      "Verwendung: ./portal github [start|update|test|plan|status|stop|credentials]; nur update akzeptiert --accept-migration-plan SHA256.",
    );
  const preview = new GitHubPreview();
  if (action === "status") return preview.status();
  return await preview.locked(async () => {
    if (["stop", "credentials"].includes(action)) {
      await preview.validateSource();
      if (!preview.state()) {
        if (action === "stop")
          return console.log(
            "GitHub-Vorschau ist bereits gestoppt; keine Dienste verändert.",
          );
        throw new Error("Noch keine GitHub-Vorschau angelegt.");
      }
      return await preview.runtime(action);
    }
    const plan = await preview.fetchLatest();
    if (action === "plan") return console.log(JSON.stringify(plan, null, 2));
    if (action === "test") return await preview.testLatest(plan);
    return await preview.apply(plan, accepted);
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  githubPreviewCommand(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
