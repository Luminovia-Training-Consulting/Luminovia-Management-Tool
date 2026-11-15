import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { API_URL, createRelease, REPOSITORY } from "./package.mjs";

const commit = "a".repeat(40);
const publicKey = "sb_publishable_" + "ExamplePublicBuildValue".repeat(2);
const image = (repository) => repository + "@sha256:" + "a".repeat(64);
const postgres = image("supabase/postgres:17.12.0.000");
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pgProofPath = "deploy/hostinger/selfhost/postgres-candidate-proof.json";
const newRuntimeFiles = [
  "deploy/hostinger/maintenance/pg_preflight.py",
  "deploy/hostinger/maintenance/atomic_recovery.py",
  "deploy/hostinger/maintenance/configure-os-daily.sh",
  "deploy/hostinger/backups/complete_backup.py",
  "deploy/hostinger/backups/database-summary.sql",
  "deploy/hostinger/backups/extension-recovery.json",
];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "portal-package-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name, value) => {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, value);
  };
  put(
    "dist/index.html",
    '<html><script type="module" src="/assets/app.js"></script></html>',
  );
  put(
    "dist/assets/app.js",
    "const url=" +
      JSON.stringify(API_URL) +
      ";const key=" +
      JSON.stringify(publicKey) +
      ";",
  );
  put("dist/assets/logo.svg", '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  put(
    "supabase/functions/files/index.ts",
    "Deno.serve(() => new Response('fictional fixture'));",
  );
  put(
    "supabase/functions/files/handler_test.ts",
    "sb_secret_FictionalFixtureMustNeverShip123456789",
  );
  put(
    "supabase/migrations/20261115111133_fixture.sql",
    "begin;\ncreate table public.example(id uuid);\ncommit;\n",
  );
  put("supabase/templates/invite.html", "<html>{{ .TokenHash }}</html>");
  put(
    "supabase/templates/recovery.html",
    "<html>{{ .ConfirmationURL }}</html>",
  );
  const services = {
    db: postgres,
    auth: image("supabase/gotrue:v2.197.0"),
    rest: image("postgrest/postgrest:v14.18"),
    realtime: image("supabase/realtime:v2.148.3"),
    storage: image("supabase/storage-api:v1.89.12"),
    functions: image("supabase/edge-runtime:v1.77.9"),
    "api-gw": image("envoyproxy/envoy:v1.39.6"),
    mailpit: image("public.ecr.aws/supabase/mailpit:v1.31.3"),
  };
  put(
    "deploy/hostinger/selfhost/compose.yml",
    "services:\n" +
      Object.entries(services)
        .map(
          ([service, value]) =>
            "  " + service + ":\n    image: " + value + "\n",
        )
        .join(""),
  );
  put(
    "deploy/hostinger/compose.yml",
    "services:\n  web:\n    image: " +
      image("caddy:2-alpine") +
      "\n  clamav:\n    image: " +
      image("clamav/clamav") +
      "\n",
  );
  put("deploy/hostinger/Caddyfile", "{$PORTAL_DOMAIN} { file_server }\n");
  put("deploy/hostinger/clamd.conf", "Foreground yes\n");
  put(
    "deploy/hostinger/instance.json",
    JSON.stringify({ environment: "development" }),
  );
  put(
    "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
    JSON.stringify({
      schemaVersion: 1,
      reviewed: true,
      targetImage: postgres,
      candidateRestorePassed: true,
      migrationSourcesExact: true,
      roleAndMembershipExact: true,
      persistentFilesExact: true,
      validation: { helperSelfTestPassed: true },
    }),
  );
  put(
    "deploy/hostinger/selfhost/runtime/index.ts",
    "Deno.serve(() => new Response('router'));",
  );
  put("deploy/hostinger/selfhost/envoy/cds.yaml", "resources: []\n");
  put(
    "deploy/hostinger/supabase/images.lock.json",
    JSON.stringify({ images: [] }),
  );
  put(
    "deploy/hostinger/supabase/upstream-provenance.json",
    JSON.stringify({ commit: "b".repeat(40) }),
  );
  put(
    "deploy/hostinger/supabase/UPSTREAM_LICENSE",
    "Fictional licence test fixture",
  );
  put("deploy/hostinger/supabase/upstream/volumes/functions/deno.jsonc", "{}");
  put("deploy/hostinger/supabase/upstream/volumes/db/roles.sql", "select 1;\n");
  put(
    "deploy/hostinger/supabase/upstream/volumes/api/envoy/docker-entrypoint.sh",
    "#!/bin/sh\nexec envoy\n",
  );
  put("deploy/hostinger/updates/updater.py", "print('fixture updater')\n");
  for (const name of newRuntimeFiles)
    put(name, "# fictional selected runtime fixture\n");
  for (const name of ["service", "timer"])
    put(
      "deploy/hostinger/backups/luminovia-complete-backup." + name,
      "# fictional backup unit\n",
    );
  for (const name of [
    "maintenance/promote.mjs",
    "maintenance/selfhost-candidate-check.mjs",
    "maintenance/daily-updates.test.mjs",
    "backups/create_recovery_key.py",
    "backups/make_fixture.py",
    "backups/test_complete_backup.py",
    "backups/keys/recovery.pem",
  ])
    put(
      "deploy/hostinger/" + name,
      "sb_secret_FictionalExcludedSourceNeverPackaged123456789",
    );
  // Normal local runtime credentials may exist outside the explicit source set.
  put(".env.local", "JWT_SECRET=FictionalLocalSecretNeverPackaged");
  put(
    ".local/hostinger/ACCOUNTS.txt",
    "Fictional local credentials never packaged",
  );
  const release = (extra = {}) =>
    createRelease({
      sourceRoot: root,
      outputDirectory: join(root, "out"),
      commit,
      publicConfig: { apiUrl: API_URL, publishableKey: publicKey },
      verifyGit: false,
      ...extra,
    });
  return { root, put, release };
}

test("real archive and manifest contain only runtime files with exact byte hashes", (t) => {
  const { root, release } = fixture(t);
  const result = release();
  assert.equal(result.manifest.repository, REPOSITORY);
  assert.equal(result.manifest.branch, "main");
  assert.equal(result.manifest.commit, commit);
  assert.equal(result.manifest.publicBuild.apiUrl, API_URL);
  assert.equal(
    result.manifest.publicBuild.publishableKeySha256,
    digest(publicKey),
  );
  assert.equal(
    result.manifest.archiveSha256,
    digest(readFileSync(result.archivePath)),
  );
  assert.equal(result.manifest.runtime.postgresMajor, 17);
  assert.equal(result.manifest.runtime.images.length, 10);
  assert.equal(result.manifest.runtime.reviewed, true);
  assert.equal(
    result.manifest.runtime.images.find((entry) => entry.service === "clamav")
      .image,
    image("clamav/clamav"),
  );
  const names = execFileSync("tar", ["-tzf", result.archivePath], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  assert.deepEqual(
    names.sort(),
    result.manifest.files.map((file) => file.path).sort(),
  );
  assert(
    !names.some(
      (name) =>
        name.includes("handler_test") ||
        name.includes(".env") ||
        name.includes("ACCOUNTS"),
    ),
  );
  assert(names.includes("deploy/hostinger/mail-templates/invite.html"));
  for (const name of newRuntimeFiles) assert(names.includes(name));
  assert(
    names.includes(
      "deploy/hostinger/backups/luminovia-complete-backup.service",
    ),
  );
  assert(
    names.includes("deploy/hostinger/backups/luminovia-complete-backup.timer"),
  );
  assert(
    !names.some((name) =>
      /promote|selfhost-candidate-check|daily-updates|create_recovery_key|make_fixture|test_complete|recovery\.pem/.test(
        name,
      ),
    ),
  );
  for (const file of result.manifest.files) {
    const bytes = execFileSync("tar", [
      "-xOzf",
      result.archivePath,
      "--",
      file.path,
    ]);
    assert.equal(bytes.length, file.size);
    assert.equal(digest(bytes), file.sha256);
  }
  const second = createRelease({
    sourceRoot: root,
    outputDirectory: join(root, "second"),
    commit,
    publicConfig: { apiUrl: API_URL, publishableKey: publicKey },
    verifyGit: false,
  });
  assert.equal(second.manifest.archiveSha256, result.manifest.archiveSha256);
  assert.throws(() => release(), /overwrite/);
});

test("a wrong backend or browser secret key cannot produce a release", (t) => {
  const { release, root, put } = fixture(t);
  assert.throws(
    () =>
      release({
        publicConfig: {
          apiUrl: "https://other.example.invalid",
          publishableKey: publicKey,
        },
      }),
    /public API/,
  );
  assert.throws(
    () =>
      release({
        publicConfig: {
          apiUrl: API_URL,
          publishableKey: "sb_secret_FictionalSecretValue123456789",
        },
      }),
    /public API/,
  );
  put("dist/assets/app.js", "const url='https://wrong.example.invalid';");
  assert.throws(() => release(), /public configuration/);
  assert(!existsSync(join(root, "out/cms-release.tar.gz")));
  assert(!existsSync(join(root, "out/cms-release.json")));
});

test("public output and function source reject environment files and path tricks", (t) => {
  for (const [directory, name] of [
    ["dist", ".env"],
    ["supabase/functions", ".env.production"],
    ["supabase/functions", "bad\\path.ts"],
  ]) {
    const child = fixture(t);
    child.put(directory + "/" + name, "fictional unsafe file");
    assert.throws(() => child.release(), /Unsafe release path/);
  }
});

test("source links cannot escape the checkout or alter packaged runtime files", (t) => {
  const { root, release } = fixture(t);
  const outside = join(root, "outside.txt");
  writeFileSync(outside, "fictional outside payload");
  symlinkSync(outside, join(root, "dist/assets/escape.txt"));
  assert.throws(() => release(), /symbolic link/);
});

test("recognizable and explicitly excluded credential values never enter public artifacts", (t) => {
  const jwt =
    Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url") +
    "." +
    Buffer.from(JSON.stringify({ role: "service_role", exp: 1 })).toString(
      "base64url",
    ) +
    "." +
    "a".repeat(40);
  for (const payload of [
    "sb_secret_FictionalSecretValue123456789",
    "-----BEGIN PRIVATE KEY-----",
    jwt,
    'POSTGRES_PASSWORD="FictionalDatabasePassword123456"',
  ]) {
    const child = fixture(t);
    child.put("dist/assets/leak.js", payload);
    assert.throws(() => child.release(), /credential|secret-key|service-role/);
    assert(!existsSync(join(child.root, "out/cms-release.tar.gz")));
  }
  const child = fixture(t);
  child.put(
    "dist/assets/leak.js",
    "unrecognizable-but-explicitly-excluded-value",
  );
  assert.throws(
    () =>
      child.release({
        forbiddenValues: ["unrecognizable-but-explicitly-excluded-value"],
      }),
    /private credential/,
  );
});

test("mutable image tags, different major versions and untested provenance block packaging", (t) => {
  for (const change of ["mutable", "major", "unreviewed", "digest-mismatch"]) {
    const child = fixture(t);
    const path = join(child.root, "deploy/hostinger/selfhost/compose.yml");
    if (change === "mutable")
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          postgres,
          "supabase/postgres:latest",
        ),
      );
    if (change === "major")
      writeFileSync(
        path,
        readFileSync(path, "utf8").replace(
          postgres,
          image("supabase/postgres:18.0.0.000"),
        ),
      );
    if (change === "unreviewed" || change === "digest-mismatch") {
      const provenance = JSON.parse(
        readFileSync(
          join(
            child.root,
            "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
          ),
          "utf8",
        ),
      );
      if (change === "unreviewed") provenance.candidateRestorePassed = false;
      else provenance.targetImage = image("supabase/postgres:17.11.0.019");
      child.put(
        "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
        JSON.stringify(provenance),
      );
    }
    assert.throws(
      () => child.release(),
      /immutable|major upgrades|compatibility evidence/,
    );
  }
});

function generatedProof(
  root,
  targetImage = image("supabase/postgres:17.13.0.000"),
) {
  const path = "supabase/migrations/20261115111133_fixture.sql";
  const migrationInventory = [
    { path, sha256: digest(readFileSync(join(root, path))) },
  ];
  return {
    schemaVersion: 1,
    sourceImage: postgres,
    targetImage,
    postgresMajor: 17,
    sourceCommit: "b".repeat(40),
    migrationInventory,
    migrationInventorySha256: digest(JSON.stringify(migrationInventory)),
    validation: {
      kind: "isolated-selfhost-upgrade-fixture",
      passed: true,
      migrationSourcesExact: true,
      existingCredentialsAndFileExact: true,
      roleAndMembershipExact: true,
    },
    requiresLiveDataPreflight: true,
  };
}

function withGeneratedProof(t) {
  const context = fixture(t);
  const proof = generatedProof(context.root);
  const compose = "deploy/hostinger/selfhost/compose.yml";
  context.put(
    compose,
    readFileSync(join(context.root, compose), "utf8").replace(
      postgres,
      proof.targetImage,
    ),
  );
  context.put(pgProofPath, JSON.stringify(proof));
  return { ...context, proof };
}

test("fixture-only generated same-major proof can replace historical manual evidence and remains live-gated", (t) => {
  const context = withGeneratedProof(t);
  const historical = readFileSync(
    join(
      context.root,
      "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
    ),
  );
  const result = context.release();
  assert.equal(result.manifest.runtime.requiresLiveDataPreflight, true);
  assert.equal(result.manifest.runtime.postgresCandidateProof, pgProofPath);
  assert.equal(
    result.manifest.runtime.images.find((entry) => entry.service === "db")
      .image,
    context.proof.targetImage,
  );
  const archived = execFileSync("tar", [
    "-xOzf",
    result.archivePath,
    "--",
    pgProofPath,
  ]);
  assert.deepEqual(JSON.parse(archived), context.proof);
  assert.equal(
    result.manifest.files.find((entry) => entry.path === pgProofPath).sha256,
    digest(archived),
  );
  assert.deepEqual(
    readFileSync(
      join(
        context.root,
        "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
      ),
    ),
    historical,
    "Historical17.12 evidence must not be rewritten as future acceptance.",
  );
});

test("fictional completed PG proof permits later appended migrations without changing its historical evidence", (t) => {
  const context = withGeneratedProof(t);
  context.put(
    "supabase/migrations/20261116111133_appended_fixture.sql",
    "begin;\ncreate table public.appended_fixture(id uuid);\ncommit;\n",
  );
  const result = context.release();
  assert.equal(result.manifest.migrations.length, 2);
  assert.equal(result.manifest.runtime.requiresLiveDataPreflight, true);
  assert.deepEqual(
    JSON.parse(
      execFileSync("tar", ["-xOzf", result.archivePath, "--", pgProofPath]),
    ),
    context.proof,
    "Appending application migrations must not forge a new image-upgrade proof.",
  );
});

test("incomplete, mismatched or migration-stale generated proofs never produce an artifact", (t) => {
  const variants = [
    (proof) => {
      proof.schemaVersion = 2;
    },
    (proof) => {
      proof.postgresMajor = 18;
    },
    (proof) => {
      proof.sourceCommit = "A".repeat(40);
    },
    (proof) => {
      proof.sourceCommit = "b".repeat(39);
    },
    (proof) => {
      proof.sourceImage = "supabase/postgres:17-latest";
    },
    (proof) => {
      proof.sourceImage = image("supabase/postgres:18.0.0.000");
    },
    (proof) => {
      proof.sourceImage = proof.targetImage;
    },
    (proof) => {
      proof.targetImage = image("supabase/postgres:17.13.0.001");
    },
    (proof) => {
      proof.targetImage = proof.targetImage.slice(0, -1) + "b";
    },
    (proof) => {
      proof.requiresLiveDataPreflight = false;
    },
    (proof) => {
      proof.validation.kind = "fresh-install-only";
    },
    (proof) => {
      proof.validation.passed = false;
    },
    (proof) => {
      proof.validation.migrationSourcesExact = false;
    },
    (proof) => {
      proof.validation.existingCredentialsAndFileExact = false;
    },
    (proof) => {
      proof.validation.roleAndMembershipExact = false;
    },
    (proof) => {
      proof.migrationInventorySha256 = "e".repeat(64);
    },
    (proof) => {
      delete proof.migrationInventory;
    },
    (proof) => {
      proof.migrationInventory = [];
      proof.migrationInventorySha256 = digest("[]");
    },
    (proof) => {
      proof.migrationInventory[0].extra = "unbound metadata";
      proof.migrationInventorySha256 = digest(
        JSON.stringify(proof.migrationInventory),
      );
    },
    (proof) => {
      proof.migrationInventory[0].path = "../private.sql";
      proof.migrationInventorySha256 = digest(
        JSON.stringify(proof.migrationInventory),
      );
    },
  ];
  for (const alter of variants) {
    const context = withGeneratedProof(t);
    alter(context.proof);
    context.put(pgProofPath, JSON.stringify(context.proof));
    assert.throws(() => context.release(), /compatibility evidence/);
    assert(!existsSync(join(context.root, "out/cms-release.tar.gz")));
    assert(!existsSync(join(context.root, "out/cms-release.json")));
  }
  const stale = withGeneratedProof(t);
  stale.put(
    "supabase/migrations/20261115111133_fixture.sql",
    "begin;\ncreate table public.changed(id uuid);\ncommit;\n",
  );
  assert.throws(() => stale.release(), /compatibility evidence/);
  for (const kind of ["delete", "backdate", "reorder"]) {
    const context = withGeneratedProof(t);
    if (kind === "delete")
      rmSync(
        join(context.root, "supabase/migrations/20261115111133_fixture.sql"),
      );
    else if (kind === "backdate")
      context.put(
        "supabase/migrations/20261114111133_backdated_fixture.sql",
        "begin;\nselect 1;\ncommit;\n",
      );
    else {
      const appended = {
        path: "supabase/migrations/20261116111133_appended_fixture.sql",
        sha256: digest("begin;\nselect 1;\ncommit;\n"),
      };
      context.put(appended.path, "begin;\nselect 1;\ncommit;\n");
      context.proof.migrationInventory.unshift(appended);
      context.proof.migrationInventorySha256 = digest(
        JSON.stringify(context.proof.migrationInventory),
      );
      context.put(pgProofPath, JSON.stringify(context.proof));
    }
    assert.throws(
      () => context.release(),
      /compatibility evidence|Invalid migration inventory/,
      kind + " must not preserve a proof of different migration history.",
    );
    assert(!existsSync(join(context.root, "out/cms-release.tar.gz")));
  }
  const manual = fixture(t);
  manual.put(
    pgProofPath,
    JSON.stringify({
      ...generatedProof(manual.root),
      migrationInventorySha256: "e".repeat(64),
    }),
  );
  assert.throws(
    () => manual.release(),
    /compatibility evidence/,
    "An invalid present proof cannot be silently shipped beside valid manual evidence.",
  );
});

test("CLI rejects source-commit mismatch and dirty tracked code without a bypass flag", (t) => {
  const { root, release } = fixture(t);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  assert.throws(() => release({ verifyGit: true }), /Command failed/);
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "-m",
      "Fictional release fixture",
    ],
    { cwd: root },
  );
  assert.throws(() => release({ verifyGit: true }), /does not match/);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  writeFileSync(
    join(root, "supabase/functions/files/index.ts"),
    "changed tracked source",
  );
  assert.throws(
    () => release({ verifyGit: true, commit: sha }),
    /uncommitted tracked/,
  );
  execFileSync("git", ["checkout", "--", "supabase/functions/files/index.ts"], {
    cwd: root,
  });
  writeFileSync(
    join(root, "supabase/functions/files/untracked.ts"),
    "untracked runtime payload",
  );
  assert.throws(
    () => release({ verifyGit: true, commit: sha }),
    /not tracked by the release/,
  );
});
