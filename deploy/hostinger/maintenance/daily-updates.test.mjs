/**
 * Maintenance tests use an owned temporary checkout and injected metadata/commands. Exercise discovery, fixed file boundaries and candidate approval without registry, GitHub or server mutations.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import {
  IMAGE_POLICIES,
  FILE_TYPE_SOURCE,
  JOSE_SOURCE,
  PG_PROOF,
  NODE_VERSION,
  ROOT,
  SDK_FILES,
  applyPlan,
  assembleCandidates,
  composeImages,
  capturePgProof,
  discover,
  exportCandidate,
  migrationInventory,
  migrationInventorySha256,
  packageGroup,
  passedComponents,
  sha,
  stableVersion,
  validatePgProof,
  validatePlan,
} from "./daily-updates.mjs";
import {
  promote,
  signatureProbe,
  validateFileChange,
  validatePatch,
} from "./promote.mjs";

const BACKEND = "deploy/hostinger/selfhost/compose.yml",
  WEB = "deploy/hostinger/compose.yml";
// Create controlled owned fixtures with replaceable external responses.
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "luminovia-maintenance-test-"));
  for (const file of [
    BACKEND,
    WEB,
    JOSE_SOURCE,
    FILE_TYPE_SOURCE,
    ...SDK_FILES,
  ]) {
    await mkdir(dirname(resolve(root, file)), { recursive: true });
    await writeFile(resolve(root, file), await readFile(resolve(ROOT, file)));
  }
  // Keep this fixture a floating-major baseline even after daily maintenance
  // has pinned the actual source to a complete JSR version.
  await writeFile(
    resolve(root, JOSE_SOURCE),
    (await readFile(resolve(root, JOSE_SOURCE), "utf8")).replace(
      /jsr:@panva\/jose@\d+(?:\.\d+){0,2}/,
      "jsr:@panva/jose@6",
    ),
  );
  const originalPackage = JSON.parse(
    await readFile(resolve(ROOT, "package.json"), "utf8"),
  );
  await writeFile(
    resolve(root, "package.json"),
    JSON.stringify(
      {
        name: "fictional-maintenance-fixture",
        version: "1.0.0",
        dependencies: {
          react: "1.0.0",
          "@supabase/supabase-js":
            originalPackage.dependencies["@supabase/supabase-js"],
        },
        devDependencies: {
          typescript: "1.0.0",
          "file-type": originalPackage.devDependencies["file-type"],
        },
        overrides: {},
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    resolve(root, "package-lock.json"),
    JSON.stringify({
      name: "fictional-maintenance-fixture",
      lockfileVersion: 3,
      packages: {},
    }) + "\n",
  );
  await writeFile(resolve(root, "README.md"), "Fixture\n");
  await writeFile(resolve(root, NODE_VERSION), "26.13.1\n");
  await mkdir(resolve(root, "supabase/migrations"), { recursive: true });
  await writeFile(
    resolve(root, "supabase/migrations/20261115111133_fictional_fixture.sql"),
    "BEGIN;\nCREATE TABLE public.fictional_fixture(id integer);\nCOMMIT;\n",
  );
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git(["init", "--quiet"]);
  git(["add", "."]);
  git([
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Maintenance Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return {
    root,
    base: git(["rev-parse", "HEAD"]),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
// Derive the image candidate only from this fixture's injected metadata and checkout.
async function imagePlan(context) {
  const text = await readFile(resolve(context.root, BACKEND), "utf8");
  const from = composeImages(text).get("rest");
  return {
    schemaVersion: 1,
    repository: "Luminovia-Training-Consulting/Luminovia-Management-Tool",
    baseCommit: context.base,
    components: [
      {
        id: "docker-rest",
        kind: "image",
        label: "rest",
        changes: [
          {
            kind: "image",
            file: BACKEND,
            service: "rest",
            from,
            to: "postgrest/postgrest:v16.5@sha256:" + "a".repeat(64),
          },
        ],
      },
    ],
    held: [],
  };
}

test("stable versions and ecosystem grouping reject prereleases and coordinate peers", () => {
  assert(stableVersion("17.12.0.000"));
  assert(stableVersion("16.5"));
  assert(!stableVersion("2.0.0-beta.1"));
  assert(!stableVersion("latest"));
  assert.equal(
    packageGroup("@fullcalendar/core"),
    packageGroup("@fullcalendar/react"),
  );
  assert.equal(packageGroup("react"), packageGroup("@types/react-dom"));
});

test("discovery upgrades the test runner and exact-peer coverage provider together", async () => {
  const context = await fixture();
  try {
    const path = resolve(context.root, "package.json");
    const pkg = JSON.parse(await readFile(path, "utf8"));
    Object.assign(pkg.devDependencies, {
      vitest: "5.0.0",
      "@vitest/coverage-v8": "5.0.0",
    });
    await writeFile(path, JSON.stringify(pkg));
    const plan = await discover(context.root, async (url) => {
      const endpoint = new URL(url);
      if (endpoint.origin !== "https://registry.npmjs.org")
        throw new Error("Unrelated upstream is unavailable in this fixture.");
      const name = decodeURIComponent(endpoint.pathname.split("/").at(-2));
      return {
        name,
        version:
          name === "vitest" || name === "@vitest/coverage-v8"
            ? "5.1.0"
            : (pkg.dependencies[name] ?? pkg.devDependencies[name]),
      };
    });
    const npm = plan.components.filter((entry) => entry.kind === "npm");
    assert.equal(npm.length, 1);
    assert.deepEqual(
      npm[0].changes.map(({ name, from, to }) => ({ name, from, to })),
      [
        { name: "vitest", from: "5.0.0", to: "5.1.0" },
        { name: "@vitest/coverage-v8", from: "5.0.0", to: "5.1.0" },
      ],
    );
    assert(
      plan.held.length > 0,
      "Independent upstream failures remain visible.",
    );
  } finally {
    await context.cleanup();
  }
});

test("daily discovery selects independent stable majors and rebuilt digests without inventing PG evidence", async () => {
  const context = await fixture();
  try {
    const images = new Map([
      ...composeImages(await readFile(resolve(context.root, BACKEND), "utf8")),
      ...composeImages(await readFile(resolve(context.root, WEB), "utf8")),
    ]);
    const metadata = async (url) => {
      if (url === "https://nodejs.org/dist/index.json")
        return [
          { version: "v99.0.0-alpha.1" },
          { version: "v27.0.0" },
          { version: "v26.13.1" },
        ];
      if (url === "https://jsr.io/@panva/jose/meta.json")
        return { latest: "6.2.17", versions: { "6.2.17": {} } };
      const endpoint = new URL(url);
      if (endpoint.origin === "https://registry.npmjs.org") {
        const name = decodeURIComponent(endpoint.pathname.split("/").at(-2));
        return { name, version: name === "typescript" ? "2.0.0" : "1.0.0" };
      }
      if (url.endsWith("supabase/postgres/releases?per_page=100"))
        return [
          { tag_name: "17.99.0.000-cli" },
          {
            tag_name: "18.1.0.000",
            html_url:
              "https://github.com/supabase/postgres/releases/tag/18.1.0.000",
          },
          {
            tag_name: "17.13.0.000",
            html_url:
              "https://github.com/supabase/postgres/releases/tag/17.13.0.000",
          },
        ];
      if (url.includes("supabase/postgres/tags/"))
        return { digest: "sha256:" + "f".repeat(64) };
      if (url.endsWith("/releases/latest")) {
        const p = IMAGE_POLICIES.find((item) =>
          url.includes("/repos/" + item.release + "/"),
        );
        return {
          tag_name: p.prefix + "2.0.0",
          html_url: "https://github.com/" + p.release + "/releases/tag/2.0.0",
        };
      }
      const p = IMAGE_POLICIES.find((item) =>
        url.includes("/repositories/" + item.image + "/tags/"),
      );
      const currentDigest = images.get(p.service).split("@")[1];
      return {
        digest:
          p.service === "rest"
            ? "sha256:" + "a".repeat(64)
            : p.service === "clamav"
              ? "sha256:" + "e".repeat(64)
              : currentDigest,
        images: [
          {
            os: "linux",
            architecture: "amd64",
            digest:
              p.service === "rest" ? "sha256:" + "a".repeat(64) : currentDigest,
          },
        ],
      };
    };
    const plan = await discover(context.root, metadata);
    validatePlan(plan);
    assert(
      plan.components.some(
        (item) => item.kind === "npm" && item.changes[0].name === "typescript",
      ),
    );
    assert(plan.components.some((item) => item.id === "docker-rest"));
    const pg = plan.components.find((item) => item.id === "docker-db");
    assert(pg.requiresLiveDataPreflight);
    assert(pg.changes[0].to.includes("17.13.0.000"));
    assert(!plan.components.some((item) => item.id === "docker-clamav"));
    assert(plan.components.some((item) => item.id === "jsr-jose"));
    assert.equal(
      plan.components.find((item) => item.id === "node-build").changes[0].to,
      "27.0.0",
    );
    assert(plan.held.some((item) => item.component === "docker:db-major"));
    assert.equal(
      await readFile(resolve(context.root, BACKEND), "utf8"),
      await readFile(resolve(ROOT, BACKEND), "utf8"),
    );
  } finally {
    await context.cleanup();
  }
});

test("Node compiler updates change only its exact version file and reject unstable or downgraded text", async () => {
  const context = await fixture();
  try {
    const plan = {
      schemaVersion: 1,
      repository: "Luminovia-Training-Consulting/Luminovia-Management-Tool",
      baseCommit: context.base,
      components: [
        {
          id: "node-build",
          kind: "node",
          changes: [
            { kind: "node", file: NODE_VERSION, from: "26.13.1", to: "27.0.0" },
          ],
        },
      ],
    };
    assert.deepEqual(await applyPlan(plan, ["node-build"], context.root), [
      NODE_VERSION,
    ]);
    validatePatch(
      await exportCandidate(plan, "combined", "passed", context.root),
      context.root,
    );
    assert.throws(
      () => validateFileChange(NODE_VERSION, "26.13.1\n", "27.0.0-alpha.1\n"),
      /exact stable/,
    );
    assert.throws(
      () => validateFileChange(NODE_VERSION, "26.13.1\n", "22.0.0\n"),
      /without downgrade/,
    );
  } finally {
    await context.cleanup();
  }
});

test("fictional PG proof unit fixture binds same-major pin, exact source inventory and baseline; missing proof cannot promote", async () => {
  const context = await fixture(),
    input = context.root + "-fictional-proof.json";
  try {
    const from = composeImages(
        await readFile(resolve(context.root, BACKEND), "utf8"),
      ).get("db"),
      to = "supabase/postgres:17.99.0.000@sha256:" + "f".repeat(64);
    const plan = {
      schemaVersion: 1,
      repository: "Luminovia-Training-Consulting/Luminovia-Management-Tool",
      baseCommit: context.base,
      components: [
        {
          id: "docker-db",
          kind: "image",
          requiresLiveDataPreflight: true,
          changes: [{ kind: "image", service: "db", file: BACKEND, from, to }],
        },
      ],
    };
    await applyPlan(plan, ["docker-db"], context.root);
    const noProof = await exportCandidate(
      plan,
      "combined",
      "passed",
      context.root,
    );
    assert.throws(
      () => validatePatch(noProof, context.root),
      /separate genuine restore gate/,
    );
    const proof = {
      schemaVersion: 1,
      postgresMajor: 17,
      sourceImage: from,
      targetImage: to,
      sourceCommit: context.base,
      migrationInventory: await migrationInventory(context.root),
      migrationInventorySha256: await migrationInventorySha256(context.root),
      requiresLiveDataPreflight: true,
      validation: {
        kind: "isolated-selfhost-upgrade-fixture",
        passed: true,
        migrationSourcesExact: true,
        existingCredentialsAndFileExact: true,
        roleAndMembershipExact: true,
      },
    };
    await writeFile(
      input,
      JSON.stringify({ ...proof, migrationInventorySha256: "e".repeat(64) }),
    );
    await assert.rejects(
      capturePgProof(plan, input, context.root),
      /inventory bound to its digest/,
    );
    await writeFile(input, JSON.stringify(proof));
    await capturePgProof(plan, input, context.root);
    const patch = await exportCandidate(
      plan,
      "combined",
      "passed",
      context.root,
    );
    assert.equal(
      patch.files.find((item) => item.path === PG_PROOF).baseSha256,
      null,
    );
    validatePatch(patch, context.root);
    await writeFile(
      resolve(
        context.root,
        "supabase/migrations/20261116111133_appended_fixture.sql",
      ),
      "BEGIN;\nCREATE TABLE public.appended_fixture(id integer);\nCOMMIT;\n",
    );
    validatePgProof(proof);
    await assert.rejects(
      capturePgProof(plan, input, context.root),
      /sources differ/,
      "Fresh image proof capture must cover every current migration, even if its prefix is exact.",
    );
    assert.throws(
      () => validatePatch(patch, context.root),
      /migration sources differ/,
      "Privileged promotion must reject a partial inventory for a fresh image upgrade.",
    );
    for (const alter of [
      (candidate) => {
        delete candidate.migrationInventory;
      },
      (candidate) => {
        candidate.migrationInventory = [];
      },
      (candidate) => {
        candidate.migrationInventory[0].path = "../private.sql";
      },
      (candidate) => {
        candidate.migrationInventory[0].sha256 = "INVALID";
      },
      (candidate) => {
        candidate.migrationInventory.push(candidate.migrationInventory[0]);
      },
      (candidate) => {
        candidate.migrationInventory[0].extra = true;
      },
    ]) {
      const candidate = structuredClone(proof);
      alter(candidate);
      candidate.migrationInventorySha256 = sha(
        JSON.stringify(candidate.migrationInventory ?? []),
      );
      assert.throws(
        () => validatePgProof(candidate),
        /inventory bound to its digest/,
      );
    }
    const invalid = structuredClone(plan);
    invalid.components[0].changes[0].to = to.replace(":17.", ":18.");
    assert.throws(() => validatePlan(invalid), /same-major/);
  } finally {
    await context.cleanup();
    await rm(input, { force: true });
  }
});

test("npm candidates keep literal SDK/file-type imports aligned and JSR candidate becomes exact", async () => {
  const context = await fixture();
  try {
    const pkg = JSON.parse(
      await readFile(resolve(context.root, "package.json"), "utf8"),
    );
    const fromSdk = pkg.dependencies["@supabase/supabase-js"],
      fromType = pkg.devDependencies["file-type"];
    const plan = {
      schemaVersion: 1,
      repository: "Luminovia-Training-Consulting/Luminovia-Management-Tool",
      baseCommit: context.base,
      components: [
        {
          id: "npm-import-pins",
          kind: "npm",
          changes: [
            {
              kind: "npm",
              section: "dependencies",
              name: "@supabase/supabase-js",
              from: fromSdk,
              to: "999.0.0",
            },
            {
              kind: "npm",
              section: "devDependencies",
              name: "file-type",
              from: fromType,
              to: "999.0.0",
            },
          ],
        },
        {
          id: "jsr-jose",
          kind: "jsr",
          changes: [
            { kind: "jsr", file: JOSE_SOURCE, from: "6", to: "6.2.17" },
          ],
        },
      ],
    };
    let installs = 0;
    await applyPlan(
      plan,
      ["npm-import-pins", "jsr-jose"],
      context.root,
      (_root, executable, args) => {
        assert.equal(executable, "npm");
        assert(args.includes("--ignore-scripts"));
        assert(!args.includes("--force"));
        installs++;
        return "";
      },
    );
    assert.equal(installs, 1);
    for (const file of SDK_FILES)
      assert(
        (await readFile(resolve(context.root, file), "utf8")).includes(
          "npm:@supabase/supabase-js@999.0.0",
        ),
      );
    assert(
      (
        await readFile(resolve(context.root, FILE_TYPE_SOURCE), "utf8")
      ).includes("npm:file-type@999.0.0"),
    );
    assert(
      (await readFile(resolve(context.root, JOSE_SOURCE), "utf8")).includes(
        "jsr:@panva/jose@6.2.17",
      ),
    );
    validatePatch(
      await exportCandidate(plan, "combined", "passed", context.root),
      context.root,
    );
  } finally {
    await context.cleanup();
  }
});

test("candidate applies only one service pin and exports byte-exact base hashes", async () => {
  const context = await fixture();
  try {
    const plan = await imagePlan(context);
    const before = await readFile(resolve(context.root, BACKEND));
    assert.deepEqual(await applyPlan(plan, ["docker-rest"], context.root), [
      BACKEND,
    ]);
    const patch = await exportCandidate(
      plan,
      "combined",
      "passed",
      context.root,
    );
    assert.equal(patch.files[0].baseSha256, sha(before));
    validatePatch(patch, context.root);
    assert.equal(patch.files.length, 1);
    await writeFile(
      resolve(context.root, "README.md"),
      "unrelated source mutation\n",
    );
    await assert.rejects(
      exportCandidate(plan, "combined", "passed", context.root),
      /allowlist/,
    );
  } finally {
    await context.cleanup();
  }
});

test("fallback ignores failed, stale and unchanged results and deterministically selects one passed change", async () => {
  const context = await fixture();
  try {
    const plan = await imagePlan(context);
    plan.components.unshift({
      id: "npm-lock",
      kind: "lock",
      label: "unchanged lockfile",
      changes: [],
    });
    const result = (component, status = "passed", files = [{}]) => ({
      schemaVersion: 1,
      repository: plan.repository,
      baseCommit: plan.baseCommit,
      component,
      status,
      files,
    });
    const failed = result("docker-rest", "failed"),
      stale = { ...result("docker-rest"), baseCommit: "c".repeat(40) };
    const noChange = result("npm-lock", "passed", []);
    assert.deepEqual(
      passedComponents(plan, [failed, stale, noChange], { firstOnly: true }),
      [],
    );
    assert.deepEqual(
      passedComponents(plan, [result("docker-rest"), noChange], {
        firstOnly: true,
      }),
      ["docker-rest"],
    );
    assert.deepEqual(passedComponents({ ...plan, components: [] }, []), []);
  } finally {
    await context.cleanup();
  }
});

test("a failed combination can reapply only one independently passed component from a fresh base", async () => {
  const context = await fixture();
  try {
    const plan = await imagePlan(context);
    const baseline = await readFile(resolve(context.root, BACKEND), "utf8");
    const oldStorage = composeImages(baseline).get("storage");
    const newStorage = "supabase/storage-api:v1.95.0@sha256:" + "b".repeat(64);
    plan.components.push({
      id: "docker-storage",
      kind: "image",
      label: "storage",
      changes: [
        {
          kind: "image",
          file: BACKEND,
          service: "storage",
          from: oldStorage,
          to: newStorage,
        },
      ],
    });
    await applyPlan(plan, ["docker-rest"], context.root);
    const rest = await exportCandidate(
      plan,
      "docker-rest",
      "passed",
      context.root,
    );
    await writeFile(resolve(context.root, BACKEND), baseline);
    await applyPlan(plan, ["docker-storage"], context.root);
    const storage = await exportCandidate(
      plan,
      "docker-storage",
      "passed",
      context.root,
    );
    await writeFile(resolve(context.root, BACKEND), baseline);
    const result = await assembleCandidates(plan, [storage, rest], {
      firstOnly: true,
      root: context.root,
    });
    assert.deepEqual(
      result.accepted,
      ["docker-rest"],
      "Plan order determines the fallback, not artifact download order.",
    );
    assert.deepEqual(result.names, [BACKEND]);
    const applied = composeImages(
      await readFile(resolve(context.root, BACKEND), "utf8"),
    );
    assert.equal(applied.get("rest"), plan.components[0].changes[0].to);
    assert.equal(
      applied.get("storage"),
      oldStorage,
      "The incompatible combination must not be forced.",
    );
    validatePatch(
      await exportCandidate(plan, "combined", "passed", context.root),
      context.root,
    );
    await writeFile(resolve(context.root, BACKEND), baseline);
    const next = await assembleCandidates(
      plan,
      [{ ...rest, status: "failed", files: [] }, storage],
      { firstOnly: true, root: context.root },
    );
    assert.deepEqual(next.accepted, ["docker-storage"]);
    assert.equal(
      composeImages(await readFile(resolve(context.root, BACKEND), "utf8")).get(
        "rest",
      ),
      composeImages(baseline).get("rest"),
    );
  } finally {
    await context.cleanup();
  }
});

test("promotion refuses script, source, publisher, PG and nonregistry lockfile mutations", async () => {
  const context = await fixture();
  try {
    const backend = await readFile(resolve(context.root, BACKEND), "utf8");
    assert.throws(
      () =>
        validateFileChange(BACKEND, backend, backend + "# unrelated config\n"),
      /only change Compose/,
    );
    const db = composeImages(backend).get("db");
    assert.throws(
      () =>
        validateFileChange(
          BACKEND,
          backend,
          backend.replace(
            db,
            "supabase/postgres:17.13.0.000@sha256:" + "e".repeat(64),
          ),
        ),
      /separate genuine restore gate/,
    );
    const rest = composeImages(backend).get("rest");
    assert.throws(
      () =>
        validateFileChange(
          BACKEND,
          backend,
          backend.replace(
            rest,
            "evil/postgrest:v16.5@sha256:" + "e".repeat(64),
          ),
        ),
      /publisher changed/,
    );
    assert.throws(
      () =>
        validateFileChange(
          "package.json",
          '{"dependencies":{"react":"1.0.0"}}',
          '{"dependencies":{"react":"2.0.0"},"scripts":{"postinstall":"malicious"}}',
        ),
      /scripts/,
    );
    assert.throws(
      () =>
        validateFileChange(
          "package-lock.json",
          '{"name":"fixture","lockfileVersion":3}',
          JSON.stringify({
            name: "fixture",
            lockfileVersion: 3,
            packages: {
              evil: { resolved: "https://evil.invalid/package.tgz" },
            },
          }),
        ),
      /official npm registry/,
    );
    assert.throws(
      () =>
        validateFileChange(
          "supabase/functions/files/index.ts",
          "import 'npm:@supabase/supabase-js@2.1.0';",
          "import 'npm:@supabase/supabase-js@2.2.0';\nconsole.log('unrelated');",
        ),
      /only change the Edge SDK/,
    );
  } finally {
    await context.cleanup();
  }
});

/** Model the GitHub boundaries rather than accepting arbitrary API writes. */
/** Stateful, network-free GitHub transcript for the publisher. The fixture
 * models lost responses after server mutations and rejects unexpected routes,
 * allowing retries to prove idempotency without touching a real repository. */
function publisherApi(context, patch, options = {}) {
  const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
  const prefix = "/repos/" + repository;
  const commit = "b".repeat(40);
  const calls = [];
  const state = {
    head: options.existingHead ?? null,
    pr: null,
    failureUsed: false,
  };
  let branch;
  const failOnce = (step) => {
    if (options.failOnce === step && !state.failureUsed) {
      state.failureUsed = true;
      throw new Error("Fictional lost response after " + step);
    }
  };
  const api = async (path, request = {}) => {
    calls.push({ path, request });
    const method = request.method ?? "GET";
    if (path === prefix + "/branches/main") {
      assert.equal(method, "GET");
      return { commit: { sha: options.main ?? context.base } };
    }
    if (path.startsWith(prefix + "/git/ref/heads/")) {
      assert.equal(method, "GET");
      branch = path.slice((prefix + "/git/ref/heads/").length);
      assert.match(
        branch,
        /^codex\/daily-maintenance-[a-f0-9]{12}-[a-f0-9]{24}$/,
      );
      return state.head === null
        ? null
        : { ref: "refs/heads/" + branch, object: { sha: state.head } };
    }
    if (path === prefix + "/git/refs") {
      assert.equal(method, "POST");
      assert.equal(request.body.ref, "refs/heads/" + branch);
      assert.equal(request.body.sha, context.base);
      assert.equal(state.head, null);
      state.head = context.base;
      failOnce("branch-created");
      return { ref: request.body.ref, object: { sha: state.head } };
    }
    if (path === prefix + "/git/commits/" + state.head) {
      assert.equal(method, "GET");
      return {
        sha: state.head,
        verification: {
          verified: options.verified !== false,
          reason: options.verified === false ? "unsigned" : "valid",
        },
        parents: [{ sha: options.parent ?? context.base }],
      };
    }
    if (path === prefix + "/compare/" + context.base + "..." + state.head) {
      assert.equal(method, "GET");
      return {
        status: "ahead",
        total_commits: options.totalCommits ?? 1,
        files:
          options.files ??
          patch.files.map((item) => {
            const bytes = Buffer.from(item.contents, "base64");
            return {
              filename: item.path,
              status: "modified",
              sha: createHash("sha1")
                .update("blob " + bytes.length + "\0")
                .update(bytes)
                .digest("hex"),
            };
          }),
      };
    }
    if (path === prefix + "/pulls?state=open&base=main&per_page=100") {
      assert.equal(method, "GET");
      return options.stalePr
        ? [
            {
              number: 29,
              head: {
                ref: "codex/daily-maintenance-older-candidate",
                repo: { full_name: repository },
              },
              body: "<!-- luminovia-maintenance:fictional-older-digest -->",
            },
          ]
        : state.pr?.state === "open"
          ? [structuredClone(state.pr)]
          : [];
    }
    if (path.startsWith(prefix + "/pulls?state=all&head=")) {
      assert.equal(method, "GET");
      assert.equal(
        new URL(path, "https://api.github.com").searchParams.get("head"),
        repository.split("/")[0] + ":" + branch,
      );
      return state.pr ? [structuredClone(state.pr)] : [];
    }
    if (path === prefix + "/pulls" && method === "POST") {
      assert.equal(state.pr, null);
      assert.equal(request.body.head, branch);
      assert.equal(request.body.base, "main");
      state.pr = {
        number: 31,
        node_id: "PR_fictional",
        state: "open",
        draft: false,
        body: request.body.body,
        head: { sha: state.head, ref: branch, repo: { full_name: repository } },
        base: { ref: "main", repo: { full_name: repository } },
        labels: [],
        mergeable: options.clean === true,
        mergeable_state: options.clean ? "clean" : "blocked",
      };
      failOnce("pr-created");
      return structuredClone(state.pr);
    }
    if (path === prefix + "/pulls/31") {
      assert.equal(method, "GET");
      assert(state.pr);
      const current = structuredClone(state.pr);
      if (options.classificationChanged && current.labels.length > 0)
        current.labels.push({ name: "risk:low" });
      return current;
    }
    if (path === prefix + "/pulls/31/merge") {
      assert.equal(method, "PUT");
      assert.deepEqual(request.body, { sha: commit, merge_method: "merge" });
      if (options.mergeError)
        throw new Error("Fictional native rule rejection");
      state.pr.state = "closed";
      state.pr.merged = true;
      return { merged: true, sha: "c".repeat(40) };
    }
    if (path === "/graphql") {
      assert.equal(method, "POST");
      const { query, variables } = request.body;
      if (query.includes("createCommitOnBranch")) {
        const input = variables.input;
        assert.equal(input.branch.repositoryNameWithOwner, repository);
        assert.equal(input.branch.branchName, branch);
        assert.equal(input.expectedHeadOid, context.base);
        assert.equal(state.head, context.base);
        assert.deepEqual(
          input.fileChanges.additions,
          patch.files.map(({ path, contents }) => ({ path, contents })),
        );
        state.head = commit;
        failOnce("signed-commit");
        return { data: { createCommitOnBranch: { commit: { oid: commit } } } };
      }
      if (query.includes("repository(owner:"))
        return {
          data: {
            repository: Object.fromEntries(
              ["type", "area", "risk"].map((key, index) => [
                key,
                {
                  id: "L_" + key,
                  name: ["type:dependencies", "area:devops", "risk:high"][
                    index
                  ],
                },
              ]),
            ),
          },
        };
      if (query.includes("addLabelsToLabelable")) {
        assert(
          query.includes("labelable{... on PullRequest{id}}"),
          "Labelable has no id field; require the actual PullRequest fragment.",
        );
        assert.deepEqual(variables.input, {
          labelableId: "PR_fictional",
          labelIds: ["L_type", "L_area", "L_risk"],
        });
        state.pr.labels = ["type:dependencies", "area:devops", "risk:high"].map(
          (name) => ({ name }),
        );
        failOnce("labels");
        return {
          data: { addLabelsToLabelable: { labelable: { id: "PR_fictional" } } },
        };
      }
      if (query.includes("enablePullRequestAutoMerge")) {
        assert.deepEqual(variables.input, {
          pullRequestId: "PR_fictional",
          expectedHeadOid: commit,
          mergeMethod: "MERGE",
        });
        state.pr.auto_merge = { merge_method: "merge" };
        failOnce("queued");
        return {
          data: {
            enablePullRequestAutoMerge: {
              pullRequest: {
                id: "PR_fictional",
                number: 31,
                state: "OPEN",
                headRefOid: commit,
                autoMergeRequest: { mergeMethod: "MERGE" },
              },
            },
          },
        };
      }
    }
    assert.fail("Unexpected publisher API boundary: " + method + " " + path);
  };
  return { api, calls, state };
}
/** Build one fictional dependency-only candidate from the disposable Git
 * baseline; no container, upstream package or business database is changed. */
async function publishingCandidate(context) {
  const plan = await imagePlan(context);
  await applyPlan(plan, ["docker-rest"], context.root);
  return exportCandidate(plan, "combined", "passed", context.root);
}
/** Isolate API mutations from evidence reads so stale/rejected fixtures can
 * assert that no PR, branch or main write escaped the relevant guard. */
function publicationWrites(source) {
  return source.calls.filter(
    ({ request }) => request.method && request.method !== "GET",
  );
}

test("publication creates a signed isolated candidate PR, labels it and queues native gated auto-merge", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    const source = publisherApi(context, patch);
    const result = await promote(patch, {
      root: context.root,
      api: source.api,
    });
    assert.equal(
      result.status,
      "maintenance_pr_waiting_for_required_checks_and_review",
    );
    assert.equal(result.commit, "b".repeat(40));
    assert.equal(result.pullRequest, 31);
    assert.equal(
      source.calls.filter(({ path }) => path.endsWith("/pulls")).length,
      1,
    );
    assert(
      publicationWrites(source).every(
        ({ path, request }) =>
          !path.includes("/actions/") &&
          !path.endsWith("/heads/main") &&
          request.method !== "DELETE",
      ),
    );
    const count = publicationWrites(source).length;
    const repeat = await promote(
      { ...patch, files: [...patch.files].reverse() },
      { root: context.root, api: source.api },
    );
    assert.deepEqual(repeat, result);
    assert.equal(
      publicationWrites(source).length,
      count,
      "A retry must not create a branch, commit, PR or queue twice.",
    );
  } finally {
    await context.cleanup();
  }
});

test("publication rejects stale/invalid candidates before mutation and refuses mismatched existing branch content", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    const stale = publisherApi(context, patch, { main: "c".repeat(40) });
    assert.deepEqual(
      await promote(patch, { root: context.root, api: stale.api }),
      { status: "stale_candidate_main_moved" },
    );
    assert.deepEqual(publicationWrites(stale), []);
    const malformed = structuredClone(patch);
    malformed.files[0].sha256 = "d".repeat(64);
    await assert.rejects(
      promote(malformed, { root: context.root, api: stale.api }),
    );
    assert.equal(stale.calls.length, 1);
    for (const options of [
      { verified: false },
      { parent: "c".repeat(40) },
      { files: [] },
      {
        files: [
          {
            filename: patch.files[0].path,
            status: "modified",
            sha: "d".repeat(40),
          },
        ],
      },
      { totalCommits: 2 },
    ]) {
      const source = publisherApi(context, patch, {
        existingHead: "b".repeat(40),
        ...options,
      });
      await assert.rejects(
        promote(patch, { root: context.root, api: source.api }),
      );
      assert.deepEqual(
        publicationWrites(source),
        [],
        "Existing unverified/mismatched content must never be overwritten or queued.",
      );
    }
  } finally {
    await context.cleanup();
  }
});

test("an older open maintenance PR holds new publication without editing or accumulating reviewed candidates", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    const source = publisherApi(context, patch, { stalePr: true });
    assert.deepEqual(
      await promote(patch, { root: context.root, api: source.api }),
      {
        status: "maintenance_existing_pr_requires_resolution",
        pullRequest: 29,
      },
    );
    assert.deepEqual(publicationWrites(source), []);
  } finally {
    await context.cleanup();
  }
});

test("publication safely resumes each lost mutation response without duplicate PRs or overwriting branch edits", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    for (const failOnce of [
      "branch-created",
      "signed-commit",
      "pr-created",
      "labels",
      "queued",
    ]) {
      const source = publisherApi(context, patch, { failOnce });
      await assert.rejects(
        promote(patch, { root: context.root, api: source.api }),
        /Fictional lost response/,
      );
      const result = await promote(patch, {
        root: context.root,
        api: source.api,
      });
      assert.equal(
        result.status,
        "maintenance_pr_waiting_for_required_checks_and_review",
      );
      assert.equal(
        source.calls.filter(
          ({ path, request }) =>
            path.endsWith("/pulls") && request.method === "POST",
        ).length,
        1,
      );
      assert.equal(
        source.calls.filter(({ request }) =>
          request.body?.query?.includes("createCommitOnBranch"),
        ).length,
        1,
      );
    }
  } finally {
    await context.cleanup();
  }
});

test("publication respects closed/draft PRs and changed identity or classification", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    for (const change of [
      (pr) => {
        pr.state = "closed";
      },
      (pr) => {
        pr.state = "closed";
        pr.merged = true;
      },
      (pr) => {
        pr.draft = true;
      },
      (pr) => {
        pr.head.sha = "c".repeat(40);
      },
      (pr) => {
        pr.body = "Maintainer changed ownership marker";
      },
      (pr) => {
        pr.labels = [{ name: "risk:low" }];
      },
    ]) {
      const source = publisherApi(context, patch);
      await promote(patch, { root: context.root, api: source.api });
      change(source.state.pr);
      const before = publicationWrites(source).length;
      const expectedReject =
        source.state.pr.head.sha !== "b".repeat(40) ||
        !source.state.pr.body.includes("luminovia-maintenance:") ||
        source.state.pr.labels.some(({ name }) => name === "risk:low");
      if (expectedReject)
        await assert.rejects(
          promote(patch, { root: context.root, api: source.api }),
        );
      else
        assert.match(
          (await promote(patch, { root: context.root, api: source.api }))
            .status,
          /maintenance_pr_(closed|merged|on_hold)/,
        );
      assert.equal(publicationWrites(source).length, before);
    }
  } finally {
    await context.cleanup();
  }
});

test("classification changed after label confirmation cannot queue or merge the PR", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    const source = publisherApi(context, patch, {
      classificationChanged: true,
      clean: true,
    });
    await assert.rejects(
      promote(patch, { root: context.root, api: source.api }),
      /labels changed before auto-merge/,
    );
    assert(
      !source.calls.some(
        ({ path, request }) =>
          path.endsWith("/merge") ||
          request.body?.query?.includes("enablePullRequestAutoMerge"),
      ),
    );
  } finally {
    await context.cleanup();
  }
});

test("a clean maintenance PR uses the head-conditioned native merge and native rejection cannot be reported as success", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    for (const mergeError of [false, true]) {
      const source = publisherApi(context, patch, { clean: true, mergeError });
      const result = promote(patch, { root: context.root, api: source.api });
      if (mergeError) await assert.rejects(result, /native rule rejection/);
      else assert.equal((await result).status, "maintenance_pr_merged");
      assert(
        !source.calls.some(({ request }) =>
          request.body?.query?.includes("enablePullRequestAutoMerge"),
        ),
      );
      assert(!source.calls.some(({ path }) => path.includes("/actions/")));
    }
  } finally {
    await context.cleanup();
  }
});

test("the real promote CLI reaches the PR publisher and never writes main or dispatches main CI", async () => {
  const context = await fixture();
  try {
    const patch = await publishingCandidate(context);
    const directory = resolve(context.root, "deploy/hostinger/maintenance");
    await mkdir(directory, { recursive: true });
    for (const name of ["promote.mjs", "daily-updates.mjs"])
      await writeFile(
        resolve(directory, name),
        await readFile(new URL(name, import.meta.url)),
      );
    const patchFile = resolve(context.root, "candidate.json"),
      loader = resolve(context.root, "fictional-github.mjs"),
      transcript = resolve(context.root, "api-transcript.json");
    await writeFile(patchFile, JSON.stringify(patch));
    await writeFile(
      loader,
      `import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {writeFileSync} from "node:fs";
const publisherApi=${publisherApi.toString()};
const source=publisherApi(${JSON.stringify({ base: context.base })},${JSON.stringify(patch)});
globalThis.fetch=async(url,request)=>{const target=new URL(url);assert.equal(target.origin,"https://api.github.com");try{const result=await source.api(target.pathname+target.search,{method:request.method,body:request.body===undefined?undefined:JSON.parse(request.body)});return new Response(JSON.stringify(result),{status:result===null?404:200});}finally{writeFileSync(${JSON.stringify(transcript)},JSON.stringify(source.calls));}};
`,
    );
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        loader,
        resolve(directory, "promote.mjs"),
        "promote",
        patchFile,
      ],
      {
        cwd: context.root,
        encoding: "utf8",
        env: {
          ...process.env,
          GH_TOKEN: "fictional-offline-test-token",
          GITHUB_STEP_SUMMARY: "",
        },
      },
    );
    assert.equal(
      JSON.parse(output).status,
      "maintenance_pr_waiting_for_required_checks_and_review",
    );
    const calls = JSON.parse(await readFile(transcript, "utf8"));
    assert(
      calls.some(
        ({ path, request }) =>
          path.endsWith("/pulls") && request.method === "POST",
      ),
    );
    assert(
      calls.some(({ request }) =>
        request.body?.query?.includes("enablePullRequestAutoMerge"),
      ),
    );
    assert(!calls.some(({ path }) => path.includes("/actions/")));
    assert(
      calls
        .filter(({ path }) => path.endsWith("/main"))
        .every(({ request }) => request.method === "GET"),
    );
  } finally {
    await context.cleanup();
  }
});

function signatureProbeApi(options = {}) {
  const repository = "Luminovia-Training-Consulting/Luminovia-Management-Tool";
  const prefix = "/repos/" + repository;
  const base = "a".repeat(40),
    commit = "b".repeat(40);
  const state = {
    pr: null,
    branch: null,
    head: null,
    deleted: false,
    mainReads: 0,
  };
  const calls = [];
  const api = async (path, request = {}) => {
    calls.push({ path, request });
    const method = request.method ?? "GET";
    if (path === prefix + "/branches/main") {
      assert.equal(method, "GET");
      return {
        commit: {
          sha:
            options.failAt === "main-moved" && state.mainReads++ > 0
              ? "c".repeat(40)
              : base,
        },
      };
    }
    if (
      path.startsWith(
        prefix + "/git/ref/heads/codex/maintenance-signature-probe-",
      )
    ) {
      assert.equal(method, "GET");
      state.branch = path.slice((prefix + "/git/ref/heads/").length);
      if (options.preflightExisting && state.head === null) state.head = base;
      if (options.failAt === "branch-moved" && state.head !== null)
        state.head = "c".repeat(40);
      return state.head === null
        ? null
        : { ref: "refs/heads/" + state.branch, object: { sha: state.head } };
    }
    if (path === prefix + "/git/refs") {
      assert.equal(method, "POST");
      assert.equal(request.body.sha, base);
      state.branch = request.body.ref.slice("refs/heads/".length);
      assert.match(
        state.branch,
        /^codex\/maintenance-signature-probe-[a-f0-9-]{36}$/,
      );
      state.head = base;
      if (options.failAt === "lost-ref")
        throw new Error("Fictional lost ref creation response");
      return {};
    }
    if (path === "/graphql") {
      assert.equal(method, "POST");
      assert(
        request.body.query.includes("createCommitOnBranch"),
        "Probe must never enable auto-merge.",
      );
      const input = request.body.variables.input;
      assert.equal(input.branch.branchName, state.branch);
      assert.equal(input.expectedHeadOid, base);
      state.head = commit;
      if (options.failAt === "lost-signature")
        throw new Error("Fictional lost signed-commit response");
      return { data: { createCommitOnBranch: { commit: { oid: commit } } } };
    }
    if (path === prefix + "/git/commits/" + commit) {
      assert.equal(method, "GET");
      return {
        verification: {
          verified: options.failAt !== "verify",
          reason: options.failAt === "verify" ? "unsigned" : "valid",
        },
        parents: [{ sha: base }],
      };
    }
    if (path === prefix + "/pulls" && method === "POST") {
      assert.equal(request.body.head, state.branch);
      assert.equal(request.body.base, "main");
      assert.equal(request.body.draft, true);
      assert.match(
        request.body.body,
        /<!-- luminovia-maintenance-pr-probe:[a-f0-9-]{36} -->/,
      );
      if (options.failAt === "create-pr")
        throw new Error("Fictional PR creation refusal");
      state.pr = {
        number: 47,
        state: "open",
        draft: true,
        body: request.body.body,
        head: {
          ref: state.branch,
          sha: commit,
          repo: { full_name: repository },
        },
        base: { ref: "main", repo: { full_name: repository } },
        labels: [],
      };
      if (options.failAt === "lost-create")
        throw new Error("Fictional lost PR creation response");
      return structuredClone(state.pr);
    }
    if (path.startsWith(prefix + "/pulls?state=all&head=")) {
      assert.equal(method, "GET");
      assert.equal(
        new URL(path, "https://api.github.com").searchParams.get("head"),
        repository.split("/")[0] + ":" + state.branch,
      );
      const matches = state.pr ? [structuredClone(state.pr)] : [];
      if (options.foreignPr)
        matches.push({
          ...structuredClone(state.pr),
          number: 99,
          body: "Foreign marker; never close this PR",
        });
      return matches;
    }
    if (path === prefix + "/issues/47/labels") {
      assert.equal(method, "POST");
      assert.deepEqual(request.body, {
        labels: ["type:tests", "area:github", "risk:low"],
      });
      if (options.failAt === "labels")
        throw new Error("Fictional PR label refusal");
      state.pr.labels = request.body.labels.map((name) => ({ name }));
      return structuredClone(state.pr.labels);
    }
    if (path === prefix + "/pulls/47") {
      assert(state.pr);
      if (method === "PATCH") {
        assert.deepEqual(request.body, { state: "closed" });
        if (options.failAt === "close")
          throw new Error("Fictional PR close refusal");
        state.pr.state = "closed";
      } else assert.equal(method, "GET");
      const observed = structuredClone(state.pr);
      if (options.failAt === "readback-labels") observed.labels = [];
      if (options.failAt === "pr-identity-changed")
        observed.body = "Maintainer changed probe identity; preserve it";
      return observed;
    }
    if (path === prefix + "/git/refs/heads/" + state.branch) {
      assert.equal(method, "DELETE");
      if (options.failAt === "delete")
        throw new Error("Fictional branch cleanup refusal");
      state.deleted = true;
      state.head = null;
      return null;
    }
    assert.fail("Unexpected probe boundary: " + method + " " + path);
  };
  return { api, calls, state };
}

test("signing/PR probe confirms its draft and labels, closes only that PR, removes its branch and leaves main unchanged", async () => {
  const source = signatureProbeApi();
  const result = await signatureProbe(source.api);
  assert.deepEqual(result, {
    status: "passed",
    commit: "b".repeat(40),
    probePullRequest: 47,
    mainUnchanged: true,
    temporaryPrClosed: true,
    temporaryBranchCleaned: true,
  });
  assert.equal(source.state.pr.state, "closed");
  assert.equal(source.state.deleted, true);
  const close = source.calls.findIndex(
    ({ path, request }) =>
      path.endsWith("/pulls/47") && request.method === "PATCH",
  );
  const cleanup = source.calls.findIndex(
    ({ request }) => request.method === "DELETE",
  );
  assert(close >= 0 && cleanup > close);
  assert(
    !source.calls.some(
      ({ path }) => path.includes("/actions/") || path.endsWith("/merge"),
    ),
  );
  assert(
    source.calls
      .filter(({ path }) => path.endsWith("/main"))
      .every(({ request }) => !request.method || request.method === "GET"),
  );
});

test("probe failure cleans proved resources, preserves altered or unverified state and never reports unconfirmed cleanup as passed", async () => {
  for (const failAt of [
    "verify",
    "lost-ref",
    "lost-signature",
    "branch-moved",
    "pr-identity-changed",
    "create-pr",
    "lost-create",
    "labels",
    "readback-labels",
    "close",
    "delete",
    "main-moved",
  ]) {
    const source = signatureProbeApi({
      failAt,
      foreignPr: failAt === "lost-create",
    });
    await assert.rejects(signatureProbe(source.api));
    assert.equal(
      source.state.deleted,
      ![
        "delete",
        "verify",
        "lost-signature",
        "branch-moved",
        "pr-identity-changed",
      ].includes(failAt),
    );
    if (
      [
        "lost-create",
        "labels",
        "readback-labels",
        "delete",
        "main-moved",
      ].includes(failAt)
    )
      assert.equal(source.state.pr.state, "closed");
    assert(
      !source.calls.some(
        ({ path, request }) =>
          path.endsWith("/pulls/99") && request.method === "PATCH",
      ),
      "Lost-response recovery must never close a foreign PR.",
    );
    if (failAt === "verify")
      assert(!source.calls.some(({ path }) => path.endsWith("/pulls")));
  }
});

test("probe preflight preserves an existing UUID ref without any mutation", async () => {
  const source = signatureProbeApi({ preflightExisting: true });
  await assert.rejects(signatureProbe(source.api), /ref already exists/);
  assert.equal(source.state.deleted, false);
  assert(
    !source.calls.some(
      ({ request }) => request.method && request.method !== "GET",
    ),
  );
});

test("real signature-probe CLI reaches draft PR/label/cleanup paths without queueing or merging", async () => {
  const context = await fixture();
  try {
    const directory = resolve(context.root, "deploy/hostinger/maintenance");
    await mkdir(directory, { recursive: true });
    for (const name of ["promote.mjs", "daily-updates.mjs"])
      await writeFile(
        resolve(directory, name),
        await readFile(new URL(name, import.meta.url)),
      );
    const loader = resolve(context.root, "probe-github.mjs"),
      transcript = resolve(context.root, "probe-api.json");
    await writeFile(
      loader,
      `import assert from "node:assert/strict";\nimport {writeFileSync} from "node:fs";\nconst signatureProbeApi=${signatureProbeApi.toString()};\nconst source=signatureProbeApi();\nglobalThis.fetch=async(url,request)=>{const target=new URL(url);assert.equal(target.origin,"https://api.github.com");try{const result=await source.api(target.pathname+target.search,{method:request.method,body:request.body===undefined?undefined:JSON.parse(request.body)});return result===null?new Response(null,{status:request.method==="GET"?404:204}):new Response(JSON.stringify(result),{status:200});}finally{writeFileSync(${JSON.stringify(transcript)},JSON.stringify(source.calls));}};\n`,
    );
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        loader,
        resolve(directory, "promote.mjs"),
        "signature-probe",
      ],
      {
        cwd: context.root,
        encoding: "utf8",
        env: {
          ...process.env,
          GH_TOKEN: "fictional-offline-test-token",
          GITHUB_STEP_SUMMARY: "",
        },
      },
    );
    const observed = JSON.parse(output);
    assert.equal(observed.status, "passed");
    assert.equal(observed.probePullRequest, 47);
    assert.equal(observed.temporaryPrClosed, true);
    assert.equal(observed.temporaryBranchCleaned, true);
    const calls = JSON.parse(await readFile(transcript, "utf8"));
    assert(
      calls.some(
        ({ path, request }) =>
          path.endsWith("/issues/47/labels") && request.method === "POST",
      ),
    );
    assert(
      calls.some(
        ({ path, request }) =>
          path.endsWith("/pulls/47") && request.method === "PATCH",
      ),
    );
    assert(
      !calls.some(
        ({ path, request }) =>
          path.endsWith("/merge") ||
          request.body?.query?.includes("enablePullRequestAutoMerge"),
      ),
    );
  } finally {
    await context.cleanup();
  }
});

// Exercise the retired command through the real CLI: intentionally unpublished main
// must never be mistaken for failed CI and trigger another remote workflow.
test("the retired retry-main CLI fails without any GitHub request", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "luminovia-no-main-retry-"));
  try {
    const loader = resolve(root, "reject-network.mjs");
    const transcript = resolve(root, "unexpected-request.json");
    await writeFile(
      loader,
      `import {writeFileSync} from "node:fs";
globalThis.fetch=async(url)=>{writeFileSync(${JSON.stringify(transcript)},String(url));throw new Error("Unexpected GitHub request");};
`,
    );
    assert.throws(
      () =>
        execFileSync(
          process.execPath,
          [
            "--import",
            loader,
            resolve(ROOT, "deploy/hostinger/maintenance/promote.mjs"),
            "retry-main",
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            env: {
              ...process.env,
              GH_TOKEN: "fictional-offline-test-token",
              GITHUB_STEP_SUMMARY: "",
            },
          },
        ),
      (error) =>
        error.status === 1 &&
        error.stdout === "" &&
        /private response withheld/.test(error.stderr),
    );
    await assert.rejects(readFile(transcript), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
