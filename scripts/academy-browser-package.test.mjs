/** Customer artefact regressions using owned temporary static files and fictional public identifiers. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
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
import { signAcademyLicence } from "./academy-licence.mjs";

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
const fixture = (t) => {
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
  const api = {
    openapi: "3.1.0",
    info: { title: `${metadata.name} API`, version: "1.1.0" },
    paths: {},
    components: { securitySchemes: {} },
    servers: [{ url: metadata.backend }],
    "x-portal-installation": {
      installation_id: metadata.installationId,
      edition: metadata.edition,
      customer_ready: false,
    },
  };
  file("api/openapi.json", api);
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
      metadata,
      approvedBrandAssets: assets,
    });
  return { root, dist, output, file, api, write };
};

/** Generate independent fictional vendor trust roots and a clock-controlled licence. */
function releaseFixture(t, now = Date.parse("2040-06-01T00:00:00.000Z")) {
  const files = fixture(t);
  const issuer = generateKeyPairSync("ed25519");
  const signer = generateKeyPairSync("ed25519");
  const day = (offset) => new Date(now + offset * 86_400_000).toISOString();
  const expected = {
    installation_id: metadata.installationId,
    edition: metadata.edition,
    release_commit: metadata.sourceRevision,
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

test("rejects a changed installation, enabled API operation or wrong customer logo", async (t) => {
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
  await assert.rejects(write(), /must remain dormant/);
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

test("rejects hidden, runtime, vendor and private build paths", async (t) => {
  const { dist, file, write } = fixture(t);
  for (const path of [
    ".env",
    "node_modules/placeholder.txt",
    "brand/luminovia-logo-full.webp",
    "assets/demo-AbCdef90.js",
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

test("rejects known private credentials or demo markers embedded inside a plausible asset", async (t) => {
  const { file, write } = fixture(t);
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from('{"role":"service_role"}').toString("base64url")}.fictionsignature`;
  for (const marker of [
    "DEMO · Fictional data only",
    "--" + "---BEGIN PRIVATE KEY-----",
    "sb_secret_" + "fictionalcredentialexample",
    jwt,
  ]) {
    file(runtimePath, `console.log(${JSON.stringify(marker)});`);
    await assert.rejects(write(), /Unapproved demo or private/);
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
