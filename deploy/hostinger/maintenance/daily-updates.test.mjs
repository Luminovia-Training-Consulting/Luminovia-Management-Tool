import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
  retryMainChecks,
  signatureProbe,
  validateFileChange,
  validatePatch,
} from "./promote.mjs";

const BACKEND = "deploy/hostinger/selfhost/compose.yml",
  WEB = "deploy/hostinger/compose.yml";
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

test("signed promotion checks exact parent and dispatches exact main CI; main drift cannot mutate", async () => {
  const context = await fixture();
  try {
    const plan = await imagePlan(context);
    await applyPlan(plan, ["docker-rest"], context.root);
    const patch = await exportCandidate(
        plan,
        "combined",
        "passed",
        context.root,
      ),
      commit = "b".repeat(40),
      calls = [];
    const api = async (path, options = {}) => {
      calls.push({ path, options });
      if (path.endsWith("/branches/main"))
        return { commit: { sha: context.base } };
      if (path === "/graphql") {
        assert.equal(
          options.body.variables.input.expectedHeadOid,
          context.base,
        );
        assert.equal(options.body.variables.input.branch.branchName, "main");
        return { data: { createCommitOnBranch: { commit: { oid: commit } } } };
      }
      if (path.includes("/git/commits/"))
        return {
          verification: { verified: true, reason: "valid" },
          parents: [{ sha: context.base }],
        };
      assert.equal(options.body.inputs.expected_commit, commit);
      return null;
    };
    assert.equal(
      (await promote(patch, { root: context.root, api })).commit,
      commit,
    );
    assert.equal(calls.length, 4);
    const stale = [];
    assert.deepEqual(
      await promote(patch, {
        root: context.root,
        api: async (path) => {
          stale.push(path);
          return { commit: { sha: "c".repeat(40) } };
        },
      }),
      { status: "stale_candidate_main_moved" },
    );
    assert.equal(stale.length, 1);
    patch.files[0].sha256 = "d".repeat(64);
    assert.throws(() => validatePatch(patch, context.root));
  } finally {
    await context.cleanup();
  }
});

test("signature probe cleans only its new branch on both success and verification failure", async () => {
  for (const verified of [true, false]) {
    const calls = [];
    let branch;
    const api = async (path, options = {}) => {
      calls.push({ path, options });
      if (path.endsWith("/branches/main"))
        return { commit: { sha: "a".repeat(40) } };
      if (options.method === "DELETE") {
        assert(path.endsWith(branch));
        return null;
      }
      if (path.endsWith("/git/refs")) {
        branch = options.body.ref.slice("refs/heads/".length);
        assert(branch.startsWith("codex/maintenance-signature-probe-"));
        return {};
      }
      if (path === "/graphql")
        return {
          data: { createCommitOnBranch: { commit: { oid: "b".repeat(40) } } },
        };
      return {
        verification: { verified, reason: verified ? "valid" : "unsigned" },
        parents: [{ sha: "a".repeat(40) }],
      };
    };
    if (verified) assert.equal((await signatureProbe(api)).status, "passed");
    else
      await assert.rejects(signatureProbe(api), /signature was not verified/);
    assert.equal(
      calls.filter((item) => item.options.method === "DELETE").length,
      1,
    );
  }
});

test("a daily no-change run retries failed final main CI without duplicating active or released checks", async () => {
  for (const scenario of ["failed", "running", "released"]) {
    const calls = [],
      commit = "a".repeat(40);
    const api = async (path, options = {}) => {
      calls.push({ path, options });
      if (path.endsWith("/branches/main")) return { commit: { sha: commit } };
      if (path.includes("/releases/tags/"))
        return scenario === "released"
          ? { immutable: true, draft: false }
          : null;
      if (path.includes("/runs?"))
        return {
          workflow_runs: [
            {
              head_sha: commit,
              status: scenario === "running" ? "in_progress" : "completed",
              conclusion: "failure",
            },
          ],
        };
      assert.equal(options.body.inputs.expected_commit, commit);
      return null;
    };
    const result = await retryMainChecks(api);
    assert.equal(
      result.status,
      scenario === "failed"
        ? "retried_unreleased_main_checks"
        : scenario === "running"
          ? "exact_main_checks_already_running"
          : "current_main_already_released",
    );
    assert.equal(
      calls.filter((item) => item.options.method === "POST").length,
      scenario === "failed" ? 1 : 0,
    );
  }
});
