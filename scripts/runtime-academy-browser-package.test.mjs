/** Customer artefact regressions using owned temporary static files and fictional public identifiers. */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { parseEnv } from "node:util";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import {
  signAcademyBrowserRelease,
  verifyAcademyBrowserPackage,
  verifyAcademyBrowserRelease,
  writeAcademyBrowserPackage,
} from "./academy-browser-package.mjs";
import {
  academyExplorerOpenApi,
  academyOpenApi,
} from "../src/features/developer-api/academy-contract.ts";
import { academyWorkflowIndex } from "./academy-workflows.ts";
import {
  academyClientAssets,
  academyClientPaths,
} from "./academy-client-assets.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import {
  acquireAcademyBrowserMaintenanceLock,
  installAcademyBrowser,
} from "./academy-install-browser.mjs";
import {
  academyDatabaseComposeArguments,
  readStagedAcademyDocumentBrand,
  renewAcademyInstallationLicence,
} from "./academy-installation.mjs";
import {
  describeAcademyRuntime,
  initializeAcademyRuntime,
} from "./academy-runtime-config.mjs";
import { checkAcademyPublic } from "./academy-check-public.mjs";
import { signAcademyRuntimeHandoff } from "./academy-runtime-handoff.mjs";
import { planAcademyStaging } from "./academy-staging-plan.mjs";

const metadata = {
  sourceRevision: "a".repeat(40),
  packageLockSha256: "b".repeat(64),
  edition: "customer-managed",
  installationId: "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca",
  name: "Example & Practice Academy",
  shortName: "Example Academy",
  defaultLanguage: "en",
  themeColor: "#102857",
  backend: "https://academy.example.invalid/backend",
};
const runtimePath = "assets/index-AbCdef90.js";
const archiveName = "academy-browser.zip";
const fixture = (t, buildMetadata = metadata) => {
  const root = mkdtempSync(join(tmpdir(), "academy-browser-test-"));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const dist = join(root, "dist");
  const output = join(root, "package");
  const file = (path, value) => {
    const pathname = join(dist, path);
    mkdirSync(dirname(pathname), { recursive: true });
    writeFileSync(
      pathname,
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  const api = academyOpenApi(buildMetadata.backend, buildMetadata);
  file("api/openapi.json", api);
  file(
    "api/workflows.json",
    academyWorkflowIndex(
      api,
      academyExplorerOpenApi(buildMetadata.backend, buildMetadata),
    ),
  );
  for (const [path, source] of academyClientAssets(api)) file(path, source);
  file(
    "index.html",
    `<!doctype html><html lang="en"><head>
    <meta content="#102857" name="theme-color">
    <title>Example &amp; Practice Academy</title>
    <link href="/icons/icon-192.png" rel="icon">
    <link href="/icons/apple-touch-icon.png" rel="apple-touch-icon">
    <script type="module" src="/${runtimePath}"></script>
    </head></html>`,
  );
  file("manifest.webmanifest", {
    name: metadata.name,
    short_name: metadata.shortName,
    lang: "en",
    theme_color: "#102857",
    start_url: "/",
    scope: "/",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  });
  for (const path of [
    "brand/academy-logo.png",
    "brand/space-grotesk-OFL.txt",
    "brand/space-grotesk-latin-wght-normal.woff2",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png",
    "icons/maskable-512.png",
    "push-sw.js",
    "workbox-2fbc6a65.js",
    runtimePath,
  ])
    file(path, "Fictional static test bytes");
  file(
    "sw.js",
    'importScripts("push-sw.js"); precache("brand/academy-logo.png","icons/icon-512.png");',
  );
  const write = (directory = output, assets) =>
    writeAcademyBrowserPackage({
      dist,
      output: directory,
      metadata: buildMetadata,
      approvedBrandAssets: assets,
    });
  return { root, dist, output, file, api, write };
};

/** Generate independent fictional vendor trust roots and a clock-controlled licence. */
function releaseFixture(
  t,
  now = Date.parse("2040-06-01T00:00:00.000Z"),
  buildMetadata = metadata,
) {
  const files = fixture(t, buildMetadata);
  const issuer = generateKeyPairSync("ed25519");
  const signer = generateKeyPairSync("ed25519");
  const day = (offset) => new Date(now + offset * 86_400_000).toISOString();
  const expected = {
    installation_id: buildMetadata.installationId,
    edition: buildMetadata.edition,
    release_commit: buildMetadata.sourceRevision,
  };
  const terms = {
    ...expected,
    issued_at: day(-2),
    starts_at: day(-1),
    expires_at: day(4),
    grace_until: day(7),
    modules: ["lms"],
    limits: {
      seat_count: 20,
      storage_bytes: 2_000_000,
      api_requests_per_minute: 60,
    },
  };
  const licence = signAcademyLicence(terms, issuer.privateKey);
  const inputs = {
    directory: files.output,
    licence,
    licencePublicKey: issuer.publicKey,
    now,
  };
  return {
    ...files,
    issuer,
    signer,
    expected,
    terms,
    inputs,
    signRelease: (overrides = {}) =>
      signAcademyBrowserRelease({
        ...inputs,
        releasePrivateKey: signer.privateKey,
        ...overrides,
      }),
    verifyRelease: (signature, overrides = {}) =>
      verifyAcademyBrowserRelease({
        ...inputs,
        signature,
        releasePublicKey: signer.publicKey,
        expected,
        ...overrides,
      }),
  };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Rewrite only the catalogue in a fixture and recalculate its archive inventory. */
async function rewriteCatalogue({ dist, output }, original, api) {
  const records = structuredClone(original);
  // Retained releases predate packaged developer clients.
  records.files = records.files.filter(
    ({ path }) =>
      !academyClientPaths.includes(path) && path !== "api/workflows.json",
  );
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 0,
    unixMode: 0o100644,
    useWebWorkers: false,
  });
  for (const entry of records.files) {
    const bytes =
      entry.path === "api/openapi.json"
        ? Buffer.from(JSON.stringify(api))
        : readFileSync(join(dist, entry.path));
    await writer.add(`browser/${entry.path}`, new Uint8ArrayReader(bytes));
    entry.bytes = bytes.length;
    entry.sha256 = sha256(bytes);
  }
  const archive = await writer.close();
  records.archive.sha256 = sha256(archive);
  writeFileSync(join(output, archiveName), archive);
  writeFileSync(join(output, "manifest.json"), JSON.stringify(records));
  return records;
}

test("requires the current Academy workflow index and rejects substituted contents", async (t) => {
  const { dist, file, write } = fixture(t);
  const path = "api/workflows.json";
  const original = readFileSync(join(dist, path), "utf8");
  rmSync(join(dist, path));
  await assert.rejects(write(), /Customer workflow index differs/);
  file(path, { ...JSON.parse(original), workflows: [] });
  await assert.rejects(write(), /Customer workflow index differs/);
  file(path, original);
  assert.ok((await write()).files.some((entry) => entry.path === path));
});

test("creates a deterministic ZIP inventory of exactly the verified customer browser bytes", async (t) => {
  const { root, dist, output, write } = fixture(t);
  const second = join(root, "second");
  const allowed = new Map([
    [
      "brand/academy-logo.png",
      readFileSync(join(dist, "brand/academy-logo.png")),
    ],
  ]);
  const firstManifest = await write(output, allowed);
  assert.deepEqual(await write(second, allowed), firstManifest);
  const archive = readFileSync(join(output, archiveName));
  assert.deepEqual(readFileSync(join(second, archiveName)), archive);
  assert.deepEqual(await verifyAcademyBrowserPackage(output), firstManifest);
  const reader = new ZipReader(new Uint8ArrayReader(archive));
  assert.deepEqual(
    (await reader.getEntries()).map(({ filename }) => filename),
    firstManifest.files.map(({ path }) => "browser/" + path),
  );
  await reader.close();
  await assert.rejects(write(output, allowed), /EEXIST/);
});

test("rejects a changed installation, undocumented API operation or wrong customer logo", async (t) => {
  const { dist, file, api, write, output } = fixture(t);
  file("api/openapi.json", {
    ...api,
    "x-portal-installation": {
      ...api["x-portal-installation"],
      edition: "customer-self-hosted",
    },
  });
  await assert.rejects(write(), /API installation identity/);
  file("api/openapi.json", {
    ...api,
    paths: { "/rest/v1/rpc/admin_update": { post: {} } },
  });
  await assert.rejects(write(), /differs from the reviewed course profile/);
  file("api/openapi.json", api);
  const allowed = new Map([
    [
      "brand/academy-logo.png",
      readFileSync(join(dist, "brand/academy-logo.png")),
    ],
  ]);
  file("brand/academy-logo.png", "wrong fictional logo bytes");
  await assert.rejects(write(output, allowed), /different|match/);
});

test("requires both exact generated Academy clients in newly written archives", async (t) => {
  const { dist, file, api, write } = fixture(t);
  rmSync(join(dist, "api/client.py"));
  await assert.rejects(
    write(),
    /API client differs from its packaged contract/,
  );
  for (const [path, source] of academyClientAssets(api)) file(path, source);
  file("api/client.ts", "export const substitutedClient = true;");
  await assert.rejects(
    write(),
    /API client differs from its packaged contract/,
  );
  for (const [path, source] of academyClientAssets(api)) file(path, source);
  const manifest = await write();
  for (const path of academyClientPaths)
    assert.ok(
      manifest.files.some((entry) => entry.path === path && entry.bytes > 0),
    );
});

test("verifies the exact historic empty catalogue as an existing archive", async (t) => {
  const { api, dist, file, output, write } = fixture(t);
  const historicApi = {
    openapi: "3.1.0",
    "x-portal-installation": api["x-portal-installation"],
    servers: api.servers,
    paths: {},
    components: { securitySchemes: {} },
    info: {
      title: api.info.title,
      version: "1.1.0",
      description:
        "Customer operations become available only when the installation has passed the edition readiness checks.",
    },
  };
  file("api/openapi.json", historicApi);
  await assert.rejects(write(), /differs from the reviewed course profile/);
  file("api/openapi.json", api);
  const original = await write();
  const manifest = await rewriteCatalogue(
    { dist, output },
    original,
    historicApi,
  );
  assert.deepEqual(await verifyAcademyBrowserPackage(output), manifest);
  await rewriteCatalogue({ dist, output }, original, {
    ...historicApi,
    webhooks: api.webhooks,
  });
  await assert.rejects(
    verifyAcademyBrowserPackage(output),
    /Historic customer API differs/,
  );
});

test("rejects a current Academy worker that caches the live PWA manifest", async (t) => {
  const { file, write } = releaseFixture(t);
  file(
    "sw.js",
    'importScripts("push-sw.js"); precache("brand/academy-logo.png","icons/icon-512.png","manifest.webmanifest");',
  );
  await assert.rejects(write(), /runtime-managed branding assets/);
});

test("accepts an exact nonempty historical catalogue only after signature authentication", async (t) => {
  const files = releaseFixture(t);
  const {
    output,
    dist,
    file,
    write,
    signer,
    inputs,
    signRelease,
    verifyRelease,
  } = files;
  const current = await write();
  // Raw OpenAPI from a production build of tracked 9fc7124b (catalogue 1.2.0).
  const catalogue = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./testing/fixtures/academy-openapi-1.2.0.json.gz",
          import.meta.url,
        ),
      ),
    ),
  );
  assert.equal(catalogue.info.version, "1.2.0");
  const installation = "x-portal-installation";
  const identity = (api) =>
    api.paths["/rest/v1/rpc/installation_capabilities"].get.responses["200"]
      .content["application/json"].schema.properties;
  const historical = structuredClone(catalogue);
  historical.info.title = `${metadata.name} API`;
  historical.servers[0].url = metadata.backend;
  historical[installation].installation_id = metadata.installationId;
  identity(historical).installation_id.const = metadata.installationId;
  const seal = () =>
    sign(
      null,
      Buffer.from(
        "Luminovia Academy Browser Release v1\n" +
          sha256(readFileSync(join(output, "manifest.json"))) +
          "\n" +
          sha256(inputs.licence),
      ),
      signer.privateKey,
    ).toString("base64url");

  const manifest = await rewriteCatalogue(files, current, historical);
  const signature = seal();
  assert.deepEqual(await verifyRelease(signature), {
    manifest,
    licenceState: "active",
  });
  const expanded = await verifyRelease(signature, { includeFiles: true });
  assert.deepEqual(expanded.manifest, manifest);
  assert.equal(expanded.licenceState, "active");
  assert.ok(expanded.files instanceof Map);
  assert.deepEqual(
    [...expanded.files.keys()].sort(),
    manifest.files.map(({ path }) => path),
  );
  assert.deepEqual(
    expanded.files.get("api/openapi.json"),
    Buffer.from(JSON.stringify(historical)),
  );
  assert.deepEqual(
    expanded.files.get(runtimePath),
    readFileSync(join(dist, runtimePath)),
  );
  await assert.rejects(
    verifyAcademyBrowserPackage(output),
    /Customer API differs/,
  );
  await assert.rejects(signRelease(), /Customer API differs/);
  file("api/openapi.json", historical);
  await assert.rejects(
    write(join(files.root, "historical-build")),
    /Customer API differs/,
  );

  for (const alter of [
    (catalogue) => {
      catalogue.info.title = "Other academy API";
    },
    (catalogue) => {
      catalogue.servers[0].url = "https://other.example.invalid";
    },
    (catalogue) => {
      identity(catalogue).installation_id.const =
        "e4986da7-2b62-4de2-9c55-a8ab6435d2bb";
    },
    (catalogue) => {
      identity(catalogue).edition.const = "customer-self-hosted";
    },
    (catalogue) => {
      catalogue.paths["/rest/v1/rpc/fictional_unreviewed_operation"] = {
        post: {},
      };
    },
    (catalogue) => {
      catalogue.info.version = "1.19.0";
    },
  ]) {
    const changed = structuredClone(historical);
    alter(changed);
    await rewriteCatalogue(files, current, changed);
    await assert.rejects(
      verifyRelease(signature, { includeFiles: true }),
      /academy_browser_release_signature/,
    );
    await assert.rejects(
      verifyRelease(seal(), { includeFiles: true }),
      /Customer API differs/,
    );
  }
});

for (const version of [
  "1.20.0",
  "1.21.0",
  "1.27.0",
  "1.28.0",
  "1.29.0",
  "1.30.0",
  "1.31.0",
  "1.32.0",
  "1.33.0",
  "1.34.0",
  "1.36.0",
  "1.37.0",
]) {
  test(`still authenticates a signed ${version} catalogue after the contract changed`, async (t) => {
    const files = releaseFixture(t);
    const { output, signer, inputs, verifyRelease } = files;
    const historical = JSON.parse(
      gunzipSync(
        readFileSync(
          new URL(
            `./testing/fixtures/academy-openapi-${version}.json.gz`,
            import.meta.url,
          ),
        ),
      ),
    );
    assert.equal(historical.info.version, version);
    historical.info.title = metadata.name + " API";
    historical.servers[0].url = metadata.backend;
    historical["x-portal-installation"].installation_id =
      metadata.installationId;
    historical.paths["/rest/v1/rpc/installation_capabilities"].get.responses[
      "200"
    ].content["application/json"].schema.properties.installation_id.const =
      metadata.installationId;

    const manifest = await rewriteCatalogue(
      files,
      await files.write(),
      historical,
    );
    const signature = sign(
      null,
      Buffer.from(
        "Luminovia Academy Browser Release v1\n" +
          sha256(readFileSync(join(output, "manifest.json"))) +
          "\n" +
          sha256(inputs.licence),
      ),
      signer.privateKey,
    ).toString("base64url");
    assert.deepEqual(await verifyRelease(signature), {
      manifest,
      licenceState: "active",
    });
    await assert.rejects(
      verifyAcademyBrowserPackage(output),
      /Customer API differs/,
    );
  });
}

test("rejects hidden, runtime, vendor and private build paths", async (t) => {
  const { dist, file, write } = fixture(t);
  for (const path of [
    ".env",
    "node_modules/placeholder.txt",
    "brand/luminovia-logo-full.webp",
    "assets/index-AbCdef90.js.map",
    "password.pem",
  ]) {
    file(path, "fictional unexpected file");
    await assert.rejects(write(), /Unexpected path/);
    rmSync(
      join(dist, path.split("/")[0] === "node_modules" ? "node_modules" : path),
      { recursive: true },
    );
  }
  const approved = join(dist, "assets/data-AbCdef90.js");
  const runtime = join(dist, runtimePath);
  symlinkSync(runtime, approved);
  await assert.rejects(write(), /Unexpected path/);
  rmSync(approved);
  linkSync(runtime, approved);
  await assert.rejects(write(), /Expected a single bounded regular/);
});

test("rejects known private credentials embedded inside a plausible asset", async (t) => {
  const { file, write } = fixture(t);
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString("base64url")}.fictionsignature`;
  for (const marker of [
    "--" + "---BEGIN PRIVATE KEY-----",
    "sb_secret_" + "fictionalcredentialexample",
    jwt,
  ]) {
    file(runtimePath, `console.log(${JSON.stringify(marker)});`);
    await assert.rejects(write(), /Unapproved private/);
  }
});

test("refuses checksum tampering and an untrusted ZIP link even with a reissued checksum", async (t) => {
  const { output, write } = fixture(t);
  const manifest = await write();
  const archivePath = join(output, archiveName);
  const bytes = readFileSync(archivePath);
  const tampered = Buffer.concat([bytes, Buffer.from("fictional append")]);
  writeFileSync(archivePath, tampered);
  await assert.rejects(verifyAcademyBrowserPackage(output), /archive checksum/);
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 0,
    useWebWorkers: false,
  });
  await writer.add(
    "browser/index.html",
    new Uint8ArrayReader(Buffer.from("../../unauthorized.json")),
    { unixMode: 0o120777 },
  );
  const symlinkArchive = await writer.close();
  writeFileSync(archivePath, symlinkArchive);
  const forged = {
    ...manifest,
    archive: {
      name: archiveName,
      sha256: createHash("sha256").update(symlinkArchive).digest("hex"),
    },
  };
  writeFileSync(join(output, "manifest.json"), JSON.stringify(forged));
  await assert.rejects(verifyAcademyBrowserPackage(output), /Unexpected entry/);
});

test("signs an exact deterministic archive and binds independently selected installation, edition and revision", async (t) => {
  const { write, expected, signRelease, verifyRelease, terms, issuer } =
    releaseFixture(t);
  const manifest = await write();
  const signature = await signRelease();
  assert.match(signature, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(await signRelease(), signature);
  assert.deepEqual(await verifyRelease(signature), {
    manifest,
    licenceState: "active",
  });
  for (const changedBinding of [
    { installation_id: "74240609-fc9a-4e84-8380-aa316f2504ae" },
    { edition: "customer-self-hosted" },
    { release_commit: "f".repeat(40) },
  ]) {
    await assert.rejects(
      verifyRelease(signature, {
        expected: { ...expected, ...changedBinding },
      }),
      /academy_licence_binding/,
    );
    const otherLicence = signAcademyLicence(
      { ...terms, ...changedBinding },
      issuer.privateKey,
    );
    await assert.rejects(
      signRelease({ licence: otherLicence }),
      /academy_licence_binding/,
    );
    await assert.rejects(
      verifyRelease(signature, {
        licence: otherLicence,
        expected: { ...expected, ...changedBinding },
      }),
      /academy_browser_release_binding/,
    );
  }
});

test("rejects either untrusted key, malformed signature, renewed licence substitution and exact manifest byte tampering", async (t) => {
  const { output, write, signRelease, verifyRelease, terms, issuer } =
    releaseFixture(t);
  await write();
  const signature = await signRelease();
  const outsider = generateKeyPairSync("ed25519");
  await assert.rejects(
    verifyRelease(signature, { releasePublicKey: outsider.publicKey }),
    /academy_browser_release_signature/,
  );
  await assert.rejects(
    verifyRelease(signature, { licencePublicKey: outsider.publicKey }),
    /academy_licence_signature/,
  );
  const wrongAlgorithm = generateKeyPairSync("x25519");
  await assert.rejects(
    verifyRelease(signature, { releasePublicKey: wrongAlgorithm.publicKey }),
    /academy_browser_release_key/,
  );
  await assert.rejects(
    signRelease({ releasePrivateKey: wrongAlgorithm.privateKey }),
    /academy_browser_release_key/,
  );
  await assert.rejects(
    verifyRelease(signature + "="),
    /academy_browser_release_signature/,
  );
  const renewal = signAcademyLicence(
    { ...terms, limits: { ...terms.limits, seat_count: 40 } },
    issuer.privateKey,
  );
  await assert.rejects(
    verifyRelease(signature, { licence: renewal }),
    /academy_browser_release_signature/,
  );
  const manifestPath = join(output, "manifest.json");
  const bytes = readFileSync(manifestPath);
  writeFileSync(manifestPath, Buffer.concat([bytes, Buffer.from("\n")]));
  await verifyAcademyBrowserPackage(output);
  await assert.rejects(
    verifyRelease(signature),
    /academy_browser_release_signature/,
  );
  writeFileSync(manifestPath, bytes);
  const archivePath = join(output, archiveName);
  writeFileSync(
    archivePath,
    Buffer.concat([readFileSync(archivePath), Buffer.from("changed archive")]),
  );
  await assert.rejects(verifyRelease(signature), /archive checksum/);
});

test("prevents new signing outside the active licence while preserving historical authenticity checks", async (t) => {
  const { write, signRelease, verifyRelease, terms } = releaseFixture(t);
  await write();
  const signature = await signRelease();
  for (const [now, licenceState] of [
    [Date.parse(terms.starts_at) - 1, "not-yet-valid"],
    [Date.parse(terms.expires_at), "grace"],
    [Date.parse(terms.grace_until), "expired"],
  ]) {
    await assert.rejects(
      signRelease({ now }),
      /academy_browser_release_inactive/,
    );
    assert.equal(
      (await verifyRelease(signature, { now })).licenceState,
      licenceState,
    );
  }
});

test("runs both operator commands and keeps trust files and detached output outside the archive", async (t) => {
  const { root, output, write, issuer, signer, inputs, expected } =
    releaseFixture(t, Date.now());
  const manifest = await write();
  const writeKey = (name, value) => {
    const path = join(root, name);
    writeFileSync(path, value, { mode: 0o600 });
    return path;
  };
  const licenceFile = writeKey("academy.licence", inputs.licence);
  const licencePublicFile = writeKey(
    "licence.pub",
    issuer.publicKey.export({ type: "spki", format: "pem" }),
  );
  const releasePrivateFile = writeKey(
    "release.key",
    signer.privateKey.export({ type: "pkcs8", format: "pem" }),
  );
  const releasePublicFile = writeKey(
    "release.pub",
    signer.publicKey.export({ type: "spki", format: "pem" }),
  );
  const run = (...args) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("./academy-browser-package.mjs", import.meta.url),
        ),
        ...args,
      ],
      { encoding: "utf8", timeout: 20_000 },
    );
  const signed = run(
    "sign-release",
    output,
    licenceFile,
    licencePublicFile,
    releasePrivateFile,
  );
  assert.equal(signed.status, 0, signed.stderr);
  assert.match(signed.stdout, /^[A-Za-z0-9_-]{86}\n$/);
  const signatureFile = writeKey("package.release.sig", signed.stdout);
  const verifyArgs = [
    "verify-release",
    output,
    signatureFile,
    licenceFile,
    licencePublicFile,
    releasePublicFile,
    expected.installation_id,
    expected.edition,
    expected.release_commit,
  ];
  const verified = run(...verifyArgs);
  assert.equal(verified.status, 0, verified.stderr);
  assert.deepEqual(JSON.parse(verified.stdout), {
    installationId: metadata.installationId,
    edition: metadata.edition,
    sourceRevision: metadata.sourceRevision,
    archiveSha256: manifest.archive.sha256,
    licenceState: "active",
    customerReady: false,
  });
  const rejected = run(...verifyArgs.slice(0, -1), "f".repeat(40));
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /Academy browser release rejected/);
  assert.deepEqual(await verifyAcademyBrowserPackage(output), manifest);
});

async function stagingFixture(
  t,
  now = Date.parse("2040-06-01T00:00:00.000Z"),
  buildMetadata = metadata,
) {
  const fixture = releaseFixture(t, now, buildMetadata);
  const key = "sb_publishable_FictionalStagingPublicKey8271";
  const config = {
    version: 1,
    ...fixture.expected,
    portal_origin: "https://academy.example.invalid",
    api_base_url: metadata.backend,
    compose_project: "academy-practice",
    backend_network: "academy-practice-backend",
    data_directory: "/srv/academy-practice/data",
    backup_directory: "/srv/academy-practice/backups",
    backup_retention_days: 27,
    data_region: "staging-region",
    time_zone: "Asia/Kathmandu",
    tls: "operator-terminated",
    smtp: {
      mode: "capture",
      sender_email: "course@academy.example.invalid",
      sender_name: "Example & Practice Academy",
    },
  };
  const publicConfig = {
    VITE_SUPABASE_URL: metadata.backend,
    VITE_SUPABASE_PUBLISHABLE_KEY: key,
  };
  fixture.file(runtimePath, "export const key = `" + key + "`;");
  const manifest = await fixture.write();
  const signature = await fixture.signRelease();
  const inputs = {
    ...fixture.inputs,
    config,
    publicConfig,
    signature,
    releasePublicKey: fixture.signer.publicKey,
  };
  return { ...fixture, key, manifest, inputs, config, publicConfig, signature };
}

async function publicIngressFixture(t) {
  const { dist, inputs, key, manifest } = await stagingFixture(t);
  const runtimeDirectory = "/srv/academy-practice";
  const identity = describeAcademyRuntime({
    root: runtimeDirectory,
    installationId: metadata.installationId,
    edition: metadata.edition,
    portalOrigin: inputs.config.portal_origin,
  });
  const approval = generateKeyPairSync("ed25519");
  inputs.config = {
    ...inputs.config,
    ...identity,
    tls: "acme",
  };
  delete inputs.config.browser_directory;
  inputs.handoff = Buffer.from(
    signAcademyRuntimeHandoff(
      {
        installation_id: identity.installation_id,
        edition: identity.edition,
        portal_origin: identity.portal_origin,
        runtime_directory: runtimeDirectory,
        source_revision: "c".repeat(40),
      },
      approval.privateKey,
    ),
  );
  inputs.handoffPublicKey = approval.publicKey;
  const addresses = ["1.1.1.1", "2606:4700:4700::1111"];
  const requests = [];
  const testRequest = async ({
    address,
    hostname,
    path,
    secure,
    key: suppliedKey,
  }) => {
    assert.ok(addresses.includes(address));
    assert.equal(hostname, "academy.example.invalid");
    requests.push({ address, path, secure });
    const headers = { "cache-control": "no-store, private" };
    if (secure === false) {
      assert.equal(suppliedKey, undefined);
      headers.location = identity.portal_origin + path;
      return { status: 308, headers, body: Buffer.alloc(0) };
    }
    if (path === "/backend/rest/v1/rpc/installation_capabilities") {
      assert.equal(suppliedKey, key);
      return {
        status: 200,
        headers,
        body: Buffer.from(
          JSON.stringify({
            installation_id: identity.installation_id,
            edition: identity.edition,
            licence_status: "active",
            customer_ready: false,
            lms_available: false,
            marketplace_available: false,
            company_premium_switch_available: false,
          }),
        ),
      };
    }
    assert.equal(suppliedKey, undefined);
    if (path.startsWith("/backend/"))
      return { status: 404, headers, body: Buffer.alloc(0) };
    const file = ["/", "/auth/callback", "/auth/password"].includes(path)
      ? "index.html"
      : path.slice(1).split("?", 1)[0];
    return { status: 200, headers, body: readFileSync(join(dist, file)) };
  };
  return {
    inputs,
    addresses,
    requests,
    manifest,
    key,
    dependencies: {
      resolveAddresses: async (hostname) => {
        assert.equal(hostname, "academy.example.invalid");
        return addresses;
      },
      request: testRequest,
    },
  };
}

test("binds public Academy ingress to the signed current release on each DNS address", async (t) => {
  const { inputs, dependencies, addresses, requests, manifest, key } =
    await publicIngressFixture(t);
  const receipt = await checkAcademyPublic(inputs, dependencies);
  assert.equal(receipt.status, "public_ingress_verified");
  assert.equal(receipt.source_revision, metadata.sourceRevision);
  assert.equal(receipt.archive_sha256, manifest.archive.sha256);
  assert.equal(receipt.public_dns_address_count, 2);
  assert.equal(receipt.http_redirect, "verified");
  assert.equal(JSON.stringify(receipt).includes(key), false);
  for (const address of addresses) {
    const paths = requests.filter((request) => request.address === address);
    assert.equal(paths.filter(({ secure }) => secure === false).length, 1);
    for (const path of [
      "/auth/callback",
      "/auth/password",
      "/sw.js",
      "/api/openapi.json",
      "/api/client.ts",
      "/api/client.py",
      "/api/workflows.json",
      "/backend/rest/v1/rpc/installation_capabilities",
      "/backend/auth/v1/admin/users",
      "/backend/storage/v1/bucket",
    ])
      assert.ok(
        paths.some((request) => request.path === path),
        path,
      );
  }

  requests.length = 0;
  inputs.config.tls = "operator-terminated";
  const operatorReceipt = await checkAcademyPublic(inputs, dependencies);
  assert.equal(operatorReceipt.http_redirect, "operator_check_required");
  assert.ok(requests.every(({ secure }) => secure !== false));
});

test("fails closed before probing an untrusted Academy target or mixed public DNS", async (t) => {
  const { inputs, dependencies, requests, addresses } =
    await publicIngressFixture(t);
  const otherKey = generateKeyPairSync("ed25519").publicKey;
  await assert.rejects(
    checkAcademyPublic({ ...inputs, handoffPublicKey: otherKey }, dependencies),
    /academy_public_trust_inputs/,
  );
  await assert.rejects(
    checkAcademyPublic(
      {
        ...inputs,
        config: { ...inputs.config, compose_project: "other-academy" },
      },
      dependencies,
    ),
    /academy_public_target/,
  );
  await assert.rejects(
    checkAcademyPublic(inputs, {
      ...dependencies,
      resolveAddresses: async () => [...addresses, "127.0.0.1"],
    }),
    /academy_public_addresses/,
  );
  assert.deepEqual(requests, []);
});

test("rejects a stale shell, wrong capability identity, unsafe cache or open private route on any address", async (t) => {
  const { inputs, dependencies, addresses } = await publicIngressFixture(t);
  const checks = [
    [
      "/auth/callback?academy-acceptance=1",
      "redirect",
      (response) => {
        response.headers.location = "https://another.example.invalid";
      },
    ],
    [
      "/auth/password",
      "signed_bytes",
      (response) => {
        response.body = Buffer.from("A stale app shell");
      },
    ],
    [
      "/sw.js",
      "shell_cache",
      (response) => {
        response.headers["cache-control"] = "public, max-age=3600";
      },
    ],
    [
      "/backend/rest/v1/rpc/installation_capabilities",
      "capabilities_identity",
      (response) => {
        const body = JSON.parse(response.body);
        body.licence_status = "grace";
        response.body = JSON.stringify(body);
      },
    ],
    [
      "/backend/storage/v1/bucket",
      "restricted_route",
      (response) => {
        response.status = 200;
      },
    ],
  ];
  for (const [path, reason, alter] of checks) {
    await assert.rejects(
      checkAcademyPublic(inputs, {
        ...dependencies,
        request: async (probe) => {
          const response = await dependencies.request(probe);
          if (probe.address === addresses[1] && probe.path === path)
            alter(response);
          return response;
        },
      }),
      new RegExp("academy_public_" + reason),
    );
  }
});

test("derives a tenant-specific staging handoff for the exact active browser release", async (t) => {
  const { manifest, key, inputs, terms, config } = await stagingFixture(t);
  const plan = await planAcademyStaging(inputs);
  assert.equal(plan.kind, "academy-staging-plan");
  assert.equal(plan.state, "offline-preflight-verified");
  assert.equal(plan.customer_ready, false);
  assert.deepEqual(plan.release, {
    installation_id: metadata.installationId,
    edition: metadata.edition,
    source_revision: metadata.sourceRevision,
    package_lock_sha256: metadata.packageLockSha256,
    archive_sha256: manifest.archive.sha256,
    licence_state: "active",
    browser_public_key_sha256: createHash("sha256").update(key).digest("hex"),
  });
  assert.deepEqual(plan.licensed_limits, terms.limits);
  assert.equal(plan.infrastructure.compose_project, config.compose_project);
  assert.equal(plan.infrastructure.backup_retention_days, 27);
  assert.equal(plan.infrastructure.time_zone, "Asia/Kathmandu");
  assert.equal(plan.environment.REGION, config.data_region);
  assert.equal(plan.environment.PORTAL_DATA_DIR, config.data_directory);
  const storageNamespace =
    "academy-" + metadata.installationId.replaceAll("-", "");
  assert.equal(plan.environment.STORAGE_TENANT_ID, storageNamespace);
  assert.equal(plan.environment.GLOBAL_S3_BUCKET, storageNamespace + "-files");
  assert.equal(plan.environment.PORTAL_BACKEND_NETWORK, config.backend_network);
  assert.equal(plan.environment.PORTAL_INVITES_ENABLED, "false");
  assert.equal(plan.environment.PORTAL_WEBSITE_ENQUIRIES_ENABLED, "false");
  assert.equal(
    plan.environment.API_EXTERNAL_URL,
    config.api_base_url + "/auth/v1",
  );
  assert.equal(
    plan.environment.MAILER_URLPATHS_INVITE,
    "/backend/auth/v1/verify",
  );
  assert.equal(
    plan.environment.MAILER_URLPATHS_RECOVERY,
    "/backend/auth/v1/verify",
  );
  assert.deepEqual(plan.auth.allowed_origins, [config.portal_origin]);
  assert.deepEqual(plan.auth.redirect_urls, [
    config.portal_origin + "/auth/callback",
    config.portal_origin + "/auth/password",
  ]);
  assert.deepEqual(plan.auth.mail_template_urls, [
    config.portal_origin + "/mail-templates/invite.html",
    config.portal_origin + "/mail-templates/recovery.html",
  ]);
  assert.equal(plan.browser.language, metadata.defaultLanguage);
  assert.ok(
    plan.pending.includes(
      "independent encrypted backup, restore and retained-data upgrade",
    ),
  );
  const serialized = JSON.stringify(plan);
  for (const privateValue of [
    key,
    inputs.signature,
    inputs.licence,
    "SERVICE_ROLE_KEY",
    "JWT_SECRET",
    "cms.luminovia.org",
  ])
    assert.equal(serialized.includes(privateValue), false);
  assert.deepEqual(await planAcademyStaging(inputs), plan);
});

test("rejects wrong release or target binding, damaged content and every inactive licence state", async (t) => {
  const { output, inputs, publicConfig, config, terms } =
    await stagingFixture(t);
  for (const configOverride of [
    { installation_id: "6ebd0e68-7e7d-42e3-b6ae-750ca2edade2" },
    { release_commit: "f".repeat(40) },
    { edition: "customer-self-hosted" },
  ])
    await assert.rejects(
      planAcademyStaging({
        ...inputs,
        config: { ...config, ...configOverride },
      }),
      /academy_licence_binding/,
    );
  await assert.rejects(
    planAcademyStaging({
      ...inputs,
      config: { ...config, api_base_url: "https://other.example.invalid/api" },
      publicConfig: {
        ...publicConfig,
        VITE_SUPABASE_URL: "https://other.example.invalid/api",
      },
    }),
    /academy_staging_signed_backend_mismatch/,
  );
  await assert.rejects(
    planAcademyStaging({
      ...inputs,
      publicConfig: {
        ...publicConfig,
        VITE_SUPABASE_PUBLISHABLE_KEY:
          "sb_publishable_LegitimateOtherInstallation",
      },
    }),
    /academy_staging_browser_key_mismatch/,
  );
  await assert.rejects(
    planAcademyStaging({
      ...inputs,
      publicConfig: {
        ...publicConfig,
        VITE_SUPABASE_PUBLISHABLE_KEY:
          publicConfig.VITE_SUPABASE_PUBLISHABLE_KEY.slice(0, -1),
      },
    }),
    /academy_staging_browser_key_mismatch/,
  );
  for (const now of [
    Date.parse(terms.starts_at) - 1,
    Date.parse(terms.expires_at),
    Date.parse(terms.grace_until),
  ])
    await assert.rejects(
      planAcademyStaging({ ...inputs, now }),
      /academy_staging_inactive_licence/,
    );
  await assert.rejects(
    planAcademyStaging({ ...inputs, signature: "C".repeat(86) }),
    /academy_browser_release_signature/,
  );
  const archive = join(output, archiveName);
  writeFileSync(
    archive,
    Buffer.concat([readFileSync(archive), Buffer.from("tampered")]),
  );
  await assert.rejects(planAcademyStaging(inputs), /archive checksum/);
});

test("validates separate staging namespaces and the existing secure mail transport settings", async (t) => {
  const { inputs, config } = await stagingFixture(t);
  for (const configOverride of [
    { portal_origin: "https://academy.example.invalid/path" },
    { portal_origin: "http://academy.example.invalid" },
    { portal_origin: "https://cms.luminovia.org" },
    { portal_origin: "https://academy.example.invalid" + "\n" },
    { api_base_url: "https://academy.example.invalid/backend?key=secret" },
    { api_base_url: config.portal_origin },
    { api_base_url: "https://academy.example.invalid/a/../backend" },
    { backup_directory: config.data_directory + "/backups" },
    { data_directory: "/opt/luminovia-portal/data" },
    { compose_project: "luminovia-supabase" },
    { backend_network: "luminovia-portal-backend" },
    { time_zone: "Fake/Region" },
    { tls: "plain-http" },
    { SMTP_PASSWORD: "never-a-plan-value" },
  ])
    await assert.rejects(
      planAcademyStaging({
        ...inputs,
        config: { ...config, ...configOverride },
      }),
    );
  const smtp = {
    ...config.smtp,
    mode: "provider",
    host: "mail.example.com",
    port: 465,
    security: "implicit_tls",
  };
  const plan = await planAcademyStaging({
    ...inputs,
    config: { ...config, smtp },
  });
  assert.deepEqual(plan.infrastructure.smtp, smtp);
  await assert.rejects(
    planAcademyStaging({
      ...inputs,
      config: { ...config, smtp: { ...smtp, security: "starttls" } },
    }),
    /academy_staging_smtp_policy/,
  );
  await assert.rejects(
    planAcademyStaging({
      ...inputs,
      config: { ...config, smtp: { ...smtp, host: "mail.example.invalid" } },
    }),
  );
  await assert.rejects(
    planAcademyStaging({
      ...inputs,
      config: { ...config, smtp: { ...smtp, password: "never-a-plan-value" } },
    }),
  );
});

test("offline CLI consumes only its closed public env file and emits no credentials", async (t) => {
  const {
    root,
    output,
    issuer,
    signer,
    config,
    publicConfig,
    key,
    signature,
    inputs: { licence },
  } = await stagingFixture(t, Date.now());
  const write = (name, contents) => {
    const path = join(root, name);
    writeFileSync(path, contents);
    return path;
  };
  const target = write("target.json", JSON.stringify(config));
  const publicEnv = write(
    "authority.public.env",
    Object.entries(publicConfig)
      .map(([name, value]) => `${name}='${value}'`)
      .join("\n") + "\n",
  );
  const sig = write("archive.sig", signature + "\n");
  const envelope = write("academy.licence", licence + "\n");
  const issuerFile = write(
    "issuer.pub",
    issuer.publicKey.export({ type: "spki", format: "pem" }),
  );
  const signerFile = write(
    "signer.pub",
    signer.publicKey.export({ type: "spki", format: "pem" }),
  );
  const cli = fileURLToPath(
    new URL("./academy-staging-plan.mjs", import.meta.url),
  );
  const run = (...options) =>
    spawnSync(
      process.execPath,
      [
        cli,
        target,
        publicEnv,
        output,
        sig,
        envelope,
        issuerFile,
        signerFile,
        ...options,
      ],
      {
        encoding: "utf8",
        env: { PATH: "" },
      },
    );
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stderr, "");
  assert.equal(JSON.parse(valid.stdout).customer_ready, false);
  assert.ok(!valid.stdout.includes(key));
  assert.ok(!valid.stdout.includes(licence));

  const absentRuntime = join(root, "absent-runtime");
  const hostPreflight = run("--check-host", absentRuntime);
  assert.equal(hostPreflight.status, 1);
  assert.equal(hostPreflight.stderr, "");
  const hostReceipt = JSON.parse(hostPreflight.stdout);
  assert.equal(hostReceipt.customer_ready, false);
  assert.equal(hostReceipt.host.status, "blocked");
  assert.equal(existsSync(absentRuntime), false);
  assert.ok(!hostPreflight.stdout.includes(key));
  assert.ok(!hostPreflight.stdout.includes(licence));

  const fixtureSecret = "must-never-appear-in-operator-output";
  writeFileSync(
    publicEnv,
    readFileSync(publicEnv, "utf8") + `SERVICE_ROLE_KEY='${fixtureSecret}'\n`,
  );
  const rejected = run();
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, "");
  assert.match(rejected.stderr, /Academy staging plan rejected/);
  assert.ok(!rejected.stderr.includes(fixtureSecret));

  const redirected = write(
    "outside.public.env",
    "VITE_SUPABASE_URL=https://unused.example.invalid\n",
  );
  rmSync(publicEnv);
  symlinkSync(redirected, publicEnv);
  const symlink = run();
  assert.equal(symlink.status, 1);
  assert.equal(symlink.stdout, "");
  assert.ok(!symlink.stderr.includes(redirected));
});

async function installFixture(t, now, buildMetadata = metadata) {
  const fixture = releaseFixture(t, now, buildMetadata);
  const root = join(fixture.root, "runtime");
  const { browser_directory: browser, ...identity } = initializeAcademyRuntime({
    root,
    installationId: buildMetadata.installationId,
    edition: buildMetadata.edition,
    portalOrigin: new URL(buildMetadata.backend).origin,
    bindAddress: "127.0.0.1",
  });
  const key = parseEnv(
    readFileSync(join(root, "runtime.env.public.env"), "utf8"),
  ).VITE_SUPABASE_PUBLISHABLE_KEY;
  fixture.file(runtimePath, "export const key = `" + key + "`;");
  const archive = await fixture.write();
  const signature = await fixture.signRelease();
  const config = {
    ...identity,
    release_commit: buildMetadata.sourceRevision,
    backup_retention_days: 30,
    data_region: "local",
    time_zone: "Europe/Berlin",
    tls: "acme",
    smtp: {
      mode: "capture",
      sender_email: "course@academy.example.invalid",
      sender_name: "Example & Practice Academy",
    },
  };
  const inputs = {
    ...fixture.inputs,
    root,
    config,
    signature,
    releasePublicKey: fixture.signer.publicKey,
  };
  return { ...fixture, root, browser, archive, inputs };
}

async function withPrivateUmask(run) {
  const previous = process.umask(0o077);
  try {
    return await run();
  } finally {
    process.umask(previous);
  }
}

function assertBrowserRuntimeModes(browser) {
  const mode = (file) => lstatSync(join(browser, file)).mode & 0o777;
  assert.equal(
    mode(""),
    0o700,
    "the installation keeps its browser root private",
  );
  assert.equal(
    mode("release.json"),
    0o600,
    "the operator receipt stays private",
  );
  assert.equal(
    mode("api-ingress.yml"),
    0o644,
    "Envoy must be able to read its public policy",
  );
  assert.equal(mode("current"), 0o755);
  assert.equal(mode("assets"), 0o755);
  assert.equal(mode("current/index.html"), 0o644);
  assert.equal(mode("current/manifest.webmanifest"), 0o644);
  assert.equal(mode(runtimePath), 0o644);
}

test("publishes exactly the verified bytes using the dedicated Caddy layout and preserves an installed release", async (t) => {
  const { root, browser, archive, dist, inputs } = await installFixture(t);
  const receipt = await withPrivateUmask(() => installAcademyBrowser(inputs));
  assertBrowserRuntimeModes(browser);
  assert.equal(receipt.state, "browser-staged");
  assert.equal(receipt.customer_ready, false);
  assert.equal(receipt.release.archive_sha256, archive.archive.sha256);
  const ingress = readFileSync(join(browser, "api-ingress.yml"), "utf8");
  assert.match(ingress, /max_tokens: 60\b/);
  assert.match(ingress, /tokens_per_fill: 60\b/);
  assert.doesNotMatch(ingress, /ACADEMY_SIGNED_API_REQUESTS_PER_MINUTE/);
  assert.ok(
    ingress.includes("regex: /functions/v1/portal-api/v1/[a-z][a-z0-9_]*"),
  );
  assert.match(ingress, /regex: GET\|PUT\|DELETE\|OPTIONS\b/);
  assert.deepEqual(
    JSON.parse(readFileSync(join(browser, "release.json"), "utf8")),
    receipt,
  );
  for (const entry of archive.files) {
    const path = entry.path.replace(/^browser\//, "");
    const immutable = /^(?:assets\/|workbox-)/.test(path);
    const actual = readFileSync(
      join(browser, immutable ? path : "current/" + path),
    );
    assert.equal(sha256(actual), entry.sha256);
    assert.deepEqual(actual, readFileSync(join(dist, path)));
  }
  await assert.rejects(
    installAcademyBrowser(inputs),
    /academy_install_runtime_already_staged/,
  );
  assert.ok(
    !readdirSync(root).some((name) => name.startsWith(".browser-stage-")),
  );
});

test("leaves the browser directory empty after a failed target, licence or gateway pairing", async (t) => {
  const { root, browser, inputs, terms, issuer, signer } =
    await installFixture(t);
  await assert.rejects(
    installAcademyBrowser({
      ...inputs,
      config: {
        ...inputs.config,
        portal_origin: "https://other.example.invalid",
      },
    }),
    /academy_install_target_mismatch/,
  );
  await assert.rejects(
    installAcademyBrowser({
      ...inputs,
      releasePublicKey: issuer.publicKey,
    }),
    /academy_browser_release_signature/,
  );
  await assert.rejects(
    installAcademyBrowser({
      ...inputs,
      licencePublicKey: signer.publicKey,
    }),
    /academy_licence_signature/,
  );
  await assert.rejects(
    installAcademyBrowser({
      ...inputs,
      now: Date.parse(terms.expires_at),
    }),
    /academy_staging_inactive_licence/,
  );
  const runtime = join(root, "runtime.env");
  writeFileSync(
    runtime,
    readFileSync(runtime, "utf8").replace(
      /^SUPABASE_PUBLISHABLE_KEY=.*$/m,
      "SUPABASE_PUBLISHABLE_KEY='sb_publishable_WrongGatewayKey8271'",
    ),
  );
  await assert.rejects(
    installAcademyBrowser(inputs),
    /academy_install_runtime_mismatch/,
  );
  assert.deepEqual(readdirSync(browser), []);
});

test("with concurrent first installers one exact release wins atomically", async (t) => {
  const { root, browser, archive, inputs } = await installFixture(t);
  const results = await Promise.allSettled([
    installAcademyBrowser(inputs),
    installAcademyBrowser(inputs),
  ]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [
    "fulfilled",
    "rejected",
  ]);
  const installed = JSON.parse(
    readFileSync(join(browser, "release.json"), "utf8"),
  );
  assert.equal(installed.release.archive_sha256, archive.archive.sha256);
  assert.ok(
    !readdirSync(root).some((name) => name.startsWith(".browser-stage-")),
  );
});

test("an explicit signed replacement retains previous browser bytes and never writes runtime data", async (t) => {
  const { root, browser, dist, inputs, issuer, signer, terms, file } =
    await installFixture(t);
  const originalReceipt = await installAcademyBrowser(inputs);
  const originalAsset = readFileSync(join(browser, runtimePath));
  const serverEnv = join(root, "runtime.env");
  const originalEnv = readFileSync(serverEnv);
  const databaseWitness = join(root, "data", "fixture-data");
  writeFileSync(databaseWitness, "retained academy records");
  const revision = "c".repeat(40);
  const candidate = join(dirname(dist), "candidate");
  file(runtimePath, originalAsset.toString() + "\n// second signed release");
  await writeAcademyBrowserPackage({
    dist,
    output: candidate,
    metadata: { ...metadata, sourceRevision: revision },
  });
  const nextLicence = signAcademyLicence(
    {
      ...terms,
      release_commit: revision,
      issued_at: new Date(inputs.now - 86_400_001).toISOString(),
    },
    issuer.privateKey,
  );
  const signature = await signAcademyBrowserRelease({
    directory: candidate,
    licence: nextLicence,
    licencePublicKey: issuer.publicKey,
    releasePrivateKey: signer.privateKey,
    now: inputs.now,
  });
  const replacement = {
    ...inputs,
    directory: candidate,
    signature,
    licence: nextLicence,
    config: { ...inputs.config, release_commit: revision },
    replaceRevision: metadata.sourceRevision,
  };
  const stillRunning = () => {
    throw new Error("ingress running");
  };
  await assert.rejects(
    installAcademyBrowser(replacement, stillRunning),
    /ingress running/,
  );
  await assert.rejects(
    installAcademyBrowser(
      {
        ...replacement,
        replaceRevision: "f".repeat(40),
      },
      () => assert.fail("stale revisions cannot reach the ingress check"),
    ),
    /academy_install_replacement_revision/,
  );
  assert.deepEqual(readFileSync(join(browser, runtimePath)), originalAsset);
  const check = (actualRoot, project) => {
    assert.equal(actualRoot, root);
    assert.equal(project, inputs.config.compose_project);
  };
  const receipt = await withPrivateUmask(() =>
    installAcademyBrowser(replacement, check),
  );
  assertBrowserRuntimeModes(browser);
  assert.equal(receipt.release.source_revision, revision);
  assert.equal(receipt.customer_ready, false);
  assert.match(
    readFileSync(join(browser, runtimePath), "utf8"),
    /second signed release/,
  );
  assert.deepEqual(readFileSync(serverEnv), originalEnv);
  assert.equal(
    readFileSync(databaseWitness, "utf8"),
    "retained academy records",
  );
  const previous = readdirSync(root).filter((name) =>
    name.startsWith(".browser-previous-"),
  );
  assert.equal(previous.length, 1);
  assert.deepEqual(
    readFileSync(join(root, previous[0], runtimePath)),
    originalAsset,
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, previous[0], "release.json"))),
    originalReceipt,
  );
  await assert.rejects(
    installAcademyBrowser(replacement, check),
    /academy_install_replacement_revision/,
  );
});

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  test(`same-release signed ${edition} renewal retains files and resumes an interrupted commit`, async (t) => {
    const { root, browser, inputs, issuer, terms, signRelease } =
      await installFixture(t, undefined, { ...metadata, edition });
    const original = await installAcademyBrowser(inputs);
    if (edition === "customer-managed") {
      // Older installations have a perfectly valid release receipt without a licence fingerprint.
      const legacy = structuredClone(original);
      delete legacy.licence;
      writeFileSync(join(browser, "release.json"), JSON.stringify(legacy));
    }
    const receiptFile = join(browser, "release.json");
    const originalReceipt = readFileSync(receiptFile);
    const ingressFile = join(browser, "api-ingress.yml");
    // A reviewed older release can have different routes or defaults from the
    // checkout running the renewal. Preserve those bytes, including comments.
    const originalPolicy = readFileSync(ingressFile, "utf8")
      .replace("timeout: 150s", "timeout: 120s")
      .replaceAll("\n", "\r\n");
    writeFileSync(ingressFile, "# Débit réseau\r\n" + originalPolicy);
    const installedPolicy = readFileSync(ingressFile, "utf8");
    const originalScript = readFileSync(join(browser, runtimePath));
    const environment = readFileSync(join(root, "runtime.env"));
    const retained = join(root, "data", "existing-records");
    writeFileSync(retained, "Private retained course");
    writeFileSync(join(browser, "maintenance.enabled"), "");

    const nextTerms = {
      ...terms,
      issued_at: terms.starts_at,
      expires_at: "2040-07-01T00:00:00.000Z",
      grace_until: "2040-07-02T00:00:00.000Z",
      limits: { ...terms.limits, api_requests_per_minute: 95 },
    };
    const licence = signAcademyLicence(nextTerms, issuer.privateKey);
    const signature = await signRelease({ licence });
    const renewal = {
      ...inputs,
      licence,
      signature,
      previousLicence: inputs.licence,
    };
    const renewals = [];
    let databaseCommitted = false;
    const apply = (runtime, candidate) => {
      assert.equal(runtime, root);
      assert.equal(candidate.envelope, licence);
      assert.equal(candidate.previousEnvelope, inputs.licence);
      renewals.push(candidate);
      return renewAcademyInstallationLicence(candidate, (statement) => {
        if (candidate.now >= Date.parse(nextTerms.expires_at)) {
          assert.match(statement, /begin read only;/);
          assert.doesNotMatch(statement, /apply_verified_installation_licence/);
          return databaseCommitted ? "t" : "f";
        }
        assert.match(statement, /apply_verified_installation_licence/);
        databaseCommitted = true;
        return "t";
      });
    };

    await assert.rejects(
      installAcademyBrowser(
        { ...renewal, signature: inputs.signature },
        () => {},
        apply,
      ),
      /academy_browser_release_signature/,
    );
    await assert.rejects(
      installAcademyBrowser(
        { ...inputs, previousLicence: inputs.licence },
        () => {},
        apply,
      ),
      /academy_install_renewal_issue_time/,
    );
    const runningIngress = () => {
      throw new Error("ingress running");
    };
    await assert.rejects(
      installAcademyBrowser(renewal, runningIngress, apply),
      /ingress running/,
    );
    assert.equal(renewals.length, 0);

    writeFileSync(
      ingressFile,
      installedPolicy.replace("tokens_per_fill: 60", "tokens_per_fill: 95"),
    );
    await assert.rejects(
      installAcademyBrowser(renewal, () => {}, apply),
      /academy_install_renewal_policy_mismatch/,
    );
    assert.equal(renewals.length, 0);
    writeFileSync(ingressFile, installedPolicy);

    const expired = { ...renewal, now: Date.parse(nextTerms.grace_until) };
    await assert.rejects(
      installAcademyBrowser(expired, () => {}, apply),
      /academy_install_renewal_inactive/,
    );
    assert.deepEqual(readFileSync(receiptFile), originalReceipt);

    await assert.rejects(
      installAcademyBrowser(
        renewal,
        () => {},
        async (...args) => {
          await apply(...args);
          throw new Error("interrupted after database commit");
        },
      ),
      /interrupted after database commit/,
    );
    assert.deepEqual(readFileSync(receiptFile), originalReceipt);
    assert.equal(readFileSync(ingressFile, "utf8"), installedPolicy);

    const receipt = await withPrivateUmask(() =>
      installAcademyBrowser(expired, () => {}, apply),
    );
    assertBrowserRuntimeModes(browser);
    assert.equal(
      receipt.release.source_revision,
      original.release.source_revision,
    );
    assert.equal(
      receipt.release.archive_sha256,
      original.release.archive_sha256,
    );
    assert.deepEqual(receipt.licence, {
      sha256: sha256(licence),
      issued_at: nextTerms.issued_at,
      expires_at: nextTerms.expires_at,
      api_requests_per_minute: 95,
    });
    assert.equal(receipt.release.licence_state, "expired");
    assert.equal(
      readFileSync(ingressFile, "utf8"),
      installedPolicy
        .replace("max_tokens: 60", "max_tokens: 95")
        .replace("tokens_per_fill: 60", "tokens_per_fill: 95"),
    );
    assert.deepEqual(readFileSync(join(browser, runtimePath)), originalScript);
    assert.equal(
      readFileSync(join(browser, "maintenance.enabled"), "utf8"),
      "",
    );
    assert.deepEqual(readFileSync(join(root, "runtime.env")), environment);
    assert.equal(readFileSync(retained, "utf8"), "Private retained course");
    assert.deepEqual(
      await installAcademyBrowser(expired, () => {}, apply),
      receipt,
    );
    assert.equal(renewals.length, 4);
    assert.equal(
      readdirSync(root).filter((file) => file.startsWith(".browser-previous-"))
        .length,
      1,
    );

    const followUpTerms = {
      ...nextTerms,
      issued_at: nextTerms.expires_at,
      starts_at: nextTerms.grace_until,
      expires_at: "2040-08-01T00:00:00.000Z",
      grace_until: "2040-08-02T00:00:00.000Z",
      limits: { ...nextTerms.limits, api_requests_per_minute: 110 },
    };
    const followUp = signAcademyLicence(followUpTerms, issuer.privateKey);
    const active = await installAcademyBrowser(
      {
        ...expired,
        licence: followUp,
        previousLicence: licence,
        signature: await signRelease({ licence: followUp, now: expired.now }),
      },
      () => {},
      (runtime, candidate) => {
        assert.equal(runtime, root);
        assert.equal(candidate.previousEnvelope, licence);
        return renewAcademyInstallationLicence(candidate, () => "t");
      },
    );
    assert.equal(active.release.licence_state, "active");
    assert.equal(active.licence.api_requests_per_minute, 110);
    assert.equal(
      readFileSync(join(browser, "maintenance.enabled"), "utf8"),
      "",
    );
  });
}

test("the renewal CLI reaches the database adapter and publishes the signed successor", async (t) => {
  const { root, browser, inputs, issuer, signer, terms, signRelease } =
    await installFixture(t, Date.now());
  const original = await installAcademyBrowser(inputs);
  const licence = signAcademyLicence(
    {
      ...terms,
      issued_at: terms.starts_at,
      limits: { ...terms.limits, api_requests_per_minute: 95 },
    },
    issuer.privateKey,
  );
  const write = (name, contents) => {
    const path = join(root, name);
    writeFileSync(path, contents, { mode: 0o600 });
    return path;
  };
  const docker = join(root, "docker");
  writeFileSync(
    docker,
    `#!/bin/sh
[ "$1" = "compose" ] || exit 1
case " $* " in
  *" ps --all --services "*) exit 0 ;;
  *" exec -T db psql "*) grep -Fq private.apply_verified_installation_licence && printf 't\\n' ;;
  *) exit 1 ;;
esac
`,
    { mode: 0o700 },
  );
  const cli = fileURLToPath(
    new URL("./academy-install-browser.mjs", import.meta.url),
  );
  const result = spawnSync(
    process.execPath,
    [
      cli,
      root,
      write("target.json", JSON.stringify(inputs.config)),
      inputs.directory,
      write("release.sig", await signRelease({ licence })),
      write("next.licence", licence),
      write(
        "issuer.pub",
        issuer.publicKey.export({ type: "spki", format: "pem" }),
      ),
      write(
        "signer.pub",
        signer.publicKey.export({ type: "spki", format: "pem" }),
      ),
      "--renew-licence",
      write("previous.licence", inputs.licence),
    ],
    {
      encoding: "utf8",
      env: { PATH: root + ":" + process.env.PATH },
      timeout: 10000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const renewed = JSON.parse(result.stdout);
  assert.deepEqual(renewed.release, original.release);
  assert.equal(renewed.licence.api_requests_per_minute, 95);
  assert.deepEqual(
    JSON.parse(readFileSync(join(browser, "release.json"), "utf8")),
    renewed,
  );
});

test("the browser maintenance lock recovers from SIGKILL and retains mutual exclusion with the old installer", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "academy-maintenance-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const marker = join(root, ".browser-upgrade-lock");
  const module = new URL("./academy-install-browser.mjs", import.meta.url).href;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { acquireAcademyBrowserMaintenanceLock } from ${JSON.stringify(module)};
    acquireAcademyBrowserMaintenanceLock(process.argv[1]);
    console.log("Ready");
    setInterval(() => {}, 1_000);
  `,
      root,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const closed = once(child, "close");
  try {
    const ready = await Promise.race([
      once(child.stdout, "data"),
      closed.then(() => []),
    ]);
    assert.equal(ready[0]?.toString().trim(), "Ready");
    assert.throws(() => mkdirSync(marker), { code: "EEXIST" });
    assert.throws(
      () => acquireAcademyBrowserMaintenanceLock(root),
      /upgrade_in_progress/,
    );
  } finally {
    child.kill("SIGKILL");
    await closed;
  }
  assert.equal(lstatSync(marker).isSymbolicLink(), true);
  acquireAcademyBrowserMaintenanceLock(root).release();
  mkdirSync(marker);
  assert.throws(
    () => acquireAcademyBrowserMaintenanceLock(root),
    /upgrade_in_progress/,
  );
  assert.equal(lstatSync(marker).isDirectory(), true);
});

test("an inherited maintenance lock survives the Node process until its mutator exits", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "academy-maintenance-process-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const module = new URL("./academy-install-browser.mjs", import.meta.url).href;
  const finish = join(root, "finish");
  const done = join(root, "done");
  const worker = `
import os
from pathlib import Path
from sys import argv
from time import sleep
os.fstat(3)
print("Ready", flush=True)
for _ in range(250):
    if Path(argv[1]).exists():
        break
    sleep(0.02)
os.close(3)
Path(argv[2]).touch()
`;
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { spawn } from "node:child_process";
    import { acquireAcademyBrowserMaintenanceLock } from ${JSON.stringify(module)};
    const lock = acquireAcademyBrowserMaintenanceLock(process.argv[1]);
    const worker = spawn("python3", ["-I", "-c", ${JSON.stringify(worker)}, process.argv[2], process.argv[3]], {
      stdio: ["ignore", "pipe", "inherit", lock.descriptor],
    });
    worker.stdout.pipe(process.stdout);
  `,
      root,
      finish,
      done,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const closed = once(child, "close");
  try {
    const ready = await Promise.race([
      once(child.stdout, "data"),
      closed.then(() => []),
    ]);
    assert.equal(ready[0]?.toString().trim(), "Ready");
    child.kill("SIGKILL");
    assert.equal((await closed)[1], "SIGKILL");
    assert.throws(
      () => acquireAcademyBrowserMaintenanceLock(root),
      /upgrade_in_progress/,
    );
    assert.throws(() => mkdirSync(join(root, ".browser-upgrade-lock")), {
      code: "EEXIST",
    });
  } finally {
    child.kill("SIGKILL");
    await closed;
    writeFileSync(finish, "");
    for (let attempt = 0; attempt < 100 && !existsSync(done); attempt++)
      await delay(20);
  }
  assert.equal(existsSync(done), true);
  acquireAcademyBrowserMaintenanceLock(root).release();
});

test("points database bootstrap only at the matching private staged Compose project", async (t) => {
  const { root, inputs, expected } = await installFixture(t);
  await assert.rejects(academyDatabaseComposeArguments(root, expected), {
    code: "ENOENT",
  });
  await installAcademyBrowser(inputs);
  const brand = await readStagedAcademyDocumentBrand(root, expected);
  assert.deepEqual(brand, {
    name: metadata.name,
    short_name: metadata.shortName,
    theme_color: metadata.themeColor,
  });
  const manifestPath = join(root, "browser", "current", "manifest.webmanifest");
  const original = readFileSync(manifestPath);
  const modified = { ...JSON.parse(original), name: "Unexpected brand" };
  writeFileSync(manifestPath, JSON.stringify(modified));
  await assert.rejects(
    readStagedAcademyDocumentBrand(root, expected),
    /academy_database_staged_manifest_changed/,
  );
  writeFileSync(manifestPath, original);
  const args = await academyDatabaseComposeArguments(root, expected);
  assert.deepEqual(args.slice(0, 5), [
    "compose",
    "--env-file",
    join(root, "runtime.env"),
    "--project-name",
    inputs.config.compose_project,
  ]);
  assert.deepEqual(args.slice(-8), [
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
  ]);
  for (const mismatch of [
    { edition: "customer-self-hosted" },
    { release_commit: "b".repeat(40) },
  ])
    await assert.rejects(
      academyDatabaseComposeArguments(root, { ...expected, ...mismatch }),
      /academy_database_runtime_release_mismatch/,
    );
});
