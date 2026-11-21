/**
 * Package a customer browser build from committed source. Verify its static
 * inventory and optionally sign the exact bytes for offline distribution.
 */
import { deepStrictEqual } from "node:assert";
import { execFileSync } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { z } from "zod";
import { loadAcademyBrand } from "./academy-brand-config.ts";
import { verifyAcademyLicence } from "./academy-licence.mjs";
import { validatePublicConfig } from "./public-config.ts";

const packageName = "academy-browser.zip";
const manifestName = "manifest.json";
const releaseRoot = fileURLToPath(new URL("..", import.meta.url));
const maxFileBytes = 16 * 1024 * 1024;
const maxTotalBytes = 64 * 1024 * 1024;
const maxArchiveBytes = maxTotalBytes + 1024 * 1024;
const maxFiles = 1024;
const maxReleaseInputBytes = 16_384;
const releaseDomain = "Luminovia Academy Browser Release v1\n";
const fixedFiles = new Set([
  "api/openapi.json",
  "brand/academy-logo.png",
  "brand/space-grotesk-OFL.txt",
  "brand/space-grotesk-latin-wght-normal.woff2",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "index.html",
  "manifest.webmanifest",
  "push-sw.js",
  "sw.js",
]);
const assetPattern =
  /^assets\/[A-Za-z0-9][.A-Za-z0-9_-]{0,118}-[A-Za-z0-9_-]{8}\.(?:js|css)$/;
const workerPattern = /^workbox-[a-f0-9]{8}\.js$/;
const allowedDirectories = new Set(["assets", "api", "brand", "icons"]);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true });
const text = (value) => utf8.decode(value);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const editionSchema = z.enum(["customer-self-hosted", "customer-managed"]);
const manifestSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("customer-academy-browser"),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  packageLockSha256: digestSchema,
  edition: editionSchema,
  installationId: z.uuid(),
  customerReady: z.literal(false),
  name: z.string().min(1).max(72),
  shortName: z.string().min(1).max(20),
  defaultLanguage: z.enum(["de", "en"]),
  themeColor: z.string().regex(/^#[a-fA-F0-9]{6}$/),
  backend: z.url(),
  archive: z.strictObject({
    name: z.literal(packageName),
    sha256: digestSchema,
  }),
  files: z
    .array(
      z.strictObject({
        path: z.string().max(160),
        sha256: digestSchema,
        bytes: z.number().int().min(1).max(maxFileBytes),
      }),
    )
    .min(1)
    .max(maxFiles),
});

function approvedPath(path) {
  return (
    fixedFiles.has(path) ||
    workerPattern.test(path) ||
    (assetPattern.test(path) &&
      !/^assets\/(?:demo|learner-demo)(?:[-.])/i.test(path))
  );
}

/** Only regular, single-link files enter the artefact. Path validation happens before opening. */
function readRegular(path, limit) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd, { bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > BigInt(limit)
    )
      throw new Error("Expected a single bounded regular artefact file.");
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used);
      if (!count) break;
      used += count;
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      used !== Number(before.size) ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      throw new Error("An artefact file changed during preflight.");
    return bytes.subarray(0, used);
  } finally {
    closeSync(fd);
  }
}

/** Walk only the reviewed static output structure, failing on any extra copied file. */
function readBrowserOutput(root) {
  const files = new Map();
  let total = 0;
  function collect(directory, prefix) {
    for (const name of readdirSync(directory).sort()) {
      const path = prefix + name;
      const file = join(directory, name);
      const info = lstatSync(file);
      if (info.isDirectory() && !prefix && allowedDirectories.has(name)) {
        collect(file, path + "/");
      } else {
        if (!info.isFile() || !approvedPath(path))
          throw new Error("Unexpected path in customer browser output.");
        const bytes = readRegular(file, maxFileBytes);
        total += bytes.length;
        if (files.size >= maxFiles || total > maxTotalBytes)
          throw new Error("Customer browser output is too large.");
        files.set(path, bytes);
      }
    }
  }
  collect(root, "");
  return files;
}

/** Keep credentials and private route fragments out of the public backend identifier. */
function backendUrl(url) {
  const parsed = new URL(url);
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "https:" &&
      !(
        parsed.protocol === "http:" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname)
      ))
  )
    throw new Error(
      "The browser API URL must be HTTPS or loopback without credentials, query or fragment.",
    );
  return url.replace(/\/+$/, "");
}

const htmlText = (value) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");

function hasPrivateMaterial(source) {
  if (
    /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----|sb_secret_[A-Za-z0-9_-]{16,}/.test(
      source,
    )
  )
    return true;
  for (const match of source.matchAll(
    /\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}\b/g,
  )) {
    try {
      const payload = JSON.parse(
        Buffer.from(match[1], "base64url").toString("utf8"),
      );
      if (payload.role === "service_role" || payload.role === "supabase_admin")
        return true;
    } catch {
      // Other bundled base64 strings do not become a credential by matching the JWT shape.
    }
  }
  return false;
}

/** Associate every render surface and its dormant public contract with the same customer build. */
function validateBrowserOutput(files, brand, approvedBrandAssets) {
  for (const name of fixedFiles)
    if (!files.has(name))
      throw new Error("Required customer browser files are missing.");
  if (
    ![...files.keys()].some((path) => workerPattern.test(path)) ||
    ![...files.keys()].some(
      (path) => assetPattern.test(path) && path.endsWith(".js"),
    )
  )
    throw new Error("Required PWA/runtime chunks are missing.");
  const index = text(files.get("index.html"));
  const pageAssets = Array.from(
    index.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g),
    (match) => match[1],
  );
  if (
    !pageAssets.some((path) => path.endsWith(".js")) ||
    pageAssets.some((path) => !files.has(path))
  )
    throw new Error(
      "The browser entry point references missing runtime assets.",
    );
  const api = JSON.parse(text(files.get("api/openapi.json")));
  deepStrictEqual(
    Object.keys(api).sort(),
    [
      "components",
      "info",
      "openapi",
      "paths",
      "servers",
      "x-portal-installation",
    ],
    "The dormant customer API contains unexpected metadata.",
  );
  if (
    api.openapi !== "3.1.0" ||
    !/^\d+\.\d+\.\d+$/.test(api.info?.version ?? "")
  )
    throw new Error("The customer API revision is invalid.");
  const pwa = JSON.parse(text(files.get("manifest.webmanifest")));
  const worker = text(files.get("sw.js"));
  if (
    !index.includes(`<title>${htmlText(brand.name)}</title>`) ||
    !index.includes(`lang="${brand.defaultLanguage}"`) ||
    !index.includes(`content="${brand.themeColor}"`) ||
    !index.includes('href="/icons/icon-192.png"') ||
    !index.includes('href="/icons/apple-touch-icon.png"')
  )
    throw new Error(
      "Browser title, locale, theme or icons do not match the specified academy.",
    );
  const expectedIcons = [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    {
      src: "/icons/maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ];
  deepStrictEqual(
    [
      pwa.name,
      pwa.short_name,
      pwa.lang,
      pwa.theme_color,
      pwa.start_url,
      pwa.scope,
      pwa.icons,
    ],
    [
      brand.name,
      brand.shortName,
      brand.defaultLanguage,
      brand.themeColor,
      "/",
      "/",
      expectedIcons,
    ],
    "The PWA manifest does not match the specified academy.",
  );
  deepStrictEqual(
    api["x-portal-installation"],
    {
      installation_id: brand.installationId,
      edition: brand.edition,
      customer_ready: false,
    },
    "The API installation identity is missing or mismatched.",
  );
  deepStrictEqual(api.paths, {}, "Customer API must remain dormant.");
  deepStrictEqual(
    api.components,
    { securitySchemes: {} },
    "Customer API must omit operational schemas.",
  );
  deepStrictEqual(
    api.servers,
    [{ url: backendUrl(brand.backend) }],
    "The API server differs from the intended browser backend.",
  );
  if (
    api.info?.title !== `${brand.name} API` ||
    !worker.includes("brand/academy-logo.png") ||
    !worker.includes("icons/icon-512.png") ||
    !worker.includes("push-sw.js") ||
    /(?:luminovia-logo|["']\/?demo(?:[/.-]|["']))/.test(worker)
  )
    throw new Error(
      "Customer API title or PWA cache does not pass edition preflight.",
    );
  for (const [path, bytes] of files) {
    if (!/\.(?:js|css|html|json|webmanifest|txt)$/.test(path)) continue;
    const source = text(bytes);
    if (
      /DEMO · (?:Fictional data only|Nur fiktive Daten)|Fictional course message|Fiktive Kursnachricht/.test(
        source,
      ) ||
      hasPrivateMaterial(source)
    )
      throw new Error(
        "Unapproved demo or private material in customer browser output.",
      );
  }
  for (const [path, bytes] of approvedBrandAssets ?? []) {
    if (!files.get(path)?.equals(bytes))
      throw new Error(
        "Build output does not match the reviewed customer asset bytes.",
      );
  }
}

function inventory(files) {
  return [...files.keys()].sort().map((path) => {
    const bytes = files.get(path);
    return { path, sha256: sha256(bytes), bytes: bytes.length };
  });
}

/** Fixed entry order, stored data and normalized ZIP timestamps make stable inputs reproducible. */
export async function writeAcademyBrowserPackage({
  dist,
  output,
  metadata,
  approvedBrandAssets,
}) {
  if (
    !isAbsolute(dist) ||
    !isAbsolute(output) ||
    !lstatSync(dist).isDirectory()
  )
    throw new Error(
      "An owned browser build and a new absolute output directory are required.",
    );
  const files = readBrowserOutput(dist);
  validateBrowserOutput(files, metadata, approvedBrandAssets);
  const records = inventory(files);
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    level: 0,
    unixMode: 0o100644,
    lastModDate: new Date(2000, 0, 1),
    extendedTimestamp: false,
    useWebWorkers: false,
    zip64: false,
  });
  for (const { path } of records)
    await writer.add("browser/" + path, new Uint8ArrayReader(files.get(path)));
  const archive = await writer.close();
  const manifest = manifestSchema.parse({
    version: 1,
    kind: "customer-academy-browser",
    customerReady: false,
    ...metadata,
    archive: { name: packageName, sha256: sha256(archive) },
    files: records,
  });
  mkdirSync(output, { mode: 0o700 });
  writeFileSync(join(output, packageName), archive, {
    flag: "wx",
    mode: 0o600,
  });
  writeFileSync(
    join(output, manifestName),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return manifest;
}

/** Read the exact manifest bytes once so the signature covers the inventory that is validated. */
function readAcademyManifest(directory) {
  if (!isAbsolute(directory) || !lstatSync(directory).isDirectory())
    throw new Error("An absolute package directory is required.");
  deepStrictEqual(
    readdirSync(directory).sort(),
    [packageName, manifestName].sort(),
    "Unexpected files in the package directory.",
  );
  const bytes = readRegular(join(directory, manifestName), maxFileBytes);
  return { manifest: manifestSchema.parse(JSON.parse(text(bytes))), bytes };
}

/** Verify the archive against the previously read manifest without extracting any file. */
async function verifyAcademyArchive(directory, manifest) {
  const archive = readRegular(join(directory, packageName), maxArchiveBytes);
  if (sha256(archive) !== manifest.archive.sha256)
    throw new Error("Customer browser archive checksum does not match.");
  const reader = new ZipReader(new Uint8ArrayReader(archive), {
    checkSignature: true,
    strictness: "strict",
    useWebWorkers: false,
  });
  const files = new Map();
  const canonicalPaths = new Set();
  let total = 0;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      const { filename, uncompressedSize } = entry;
      const path = filename.slice("browser/".length);
      if (
        !filename.startsWith("browser/") ||
        !approvedPath(path) ||
        canonicalPaths.has(path.toLowerCase()) ||
        entry.directory ||
        entry.encrypted ||
        entry.symlink ||
        entry.unixMode !== 0o100644 ||
        entry.compressionMethod !== 0 ||
        files.size >= maxFiles ||
        uncompressedSize < 1 ||
        uncompressedSize > maxFileBytes
      )
        throw new Error("Unexpected entry in customer browser archive.");
      total += uncompressedSize;
      if (total > maxTotalBytes)
        throw new Error("Customer browser archive exceeds its byte budget.");
      const bytes = Buffer.alloc(uncompressedSize);
      let offset = 0;
      await entry.getData(
        new WritableStream({
          write(chunk) {
            if (offset + chunk.length > bytes.length)
              throw new Error(
                "Customer archive entry exceeds its declared size.",
              );
            bytes.set(chunk, offset);
            offset += chunk.length;
          },
        }),
        { checkSignature: true },
      );
      if (offset !== bytes.length)
        throw new Error("Customer archive entry length does not match.");
      files.set(path, bytes);
      canonicalPaths.add(path.toLowerCase());
    }
  } finally {
    await reader.close();
  }
  deepStrictEqual(
    inventory(files),
    manifest.files,
    "Customer browser inventory does not match.",
  );
  validateBrowserOutput(files, manifest);
}

/** Verify the package contents against its inventory. This checks integrity against the supplied manifest. */
export async function verifyAcademyBrowserPackage(directory) {
  const { manifest } = readAcademyManifest(directory);
  await verifyAcademyArchive(directory, manifest);
  return manifest;
}

/** Require an explicit Ed25519 signing key or verifier trust anchor from the operator. */
function releaseKey(input, type) {
  const key =
    input instanceof KeyObject
      ? input
      : type === "private"
        ? createPrivateKey(input)
        : createPublicKey(input);
  if (key.type !== type || key.asymmetricKeyType !== "ed25519")
    throw new Error("academy_browser_release_key");
  return key;
}

/** Domain separation prevents a signature for another document type from authorising a release. */
function releaseMessage(manifestBytes, licence) {
  return Buffer.from(
    releaseDomain + sha256(manifestBytes) + "\n" + sha256(licence),
  );
}

/** Sign a fully verified package for the exact active licence without writing keys or altering the archive. */
export async function signAcademyBrowserRelease({
  directory,
  licence,
  licencePublicKey,
  releasePrivateKey,
  now,
}) {
  const { manifest, bytes } = readAcademyManifest(directory);
  const { state } = verifyAcademyLicence(
    licence,
    licencePublicKey,
    {
      installation_id: manifest.installationId,
      edition: manifest.edition,
      release_commit: manifest.sourceRevision,
    },
    now,
  );
  if (state !== "active") throw new Error("academy_browser_release_inactive");
  await verifyAcademyArchive(directory, manifest);
  return sign(
    null,
    releaseMessage(bytes, licence),
    releaseKey(releasePrivateKey, "private"),
  ).toString("base64url");
}

/**
 * Check the release signature and independently selected installation, edition
 * and revision before inspecting the archive. Report licence status separately
 * so historical bytes remain verifiable during grace and after expiry.
 */
export async function verifyAcademyBrowserRelease({
  directory,
  licence,
  licencePublicKey,
  releasePublicKey,
  signature,
  expected,
  now,
}) {
  const { manifest, bytes } = readAcademyManifest(directory);
  const { state, terms } = verifyAcademyLicence(
    licence,
    licencePublicKey,
    expected,
    now,
  );
  if (
    terms.installation_id !== manifest.installationId ||
    terms.edition !== manifest.edition ||
    terms.release_commit !== manifest.sourceRevision
  )
    throw new Error("academy_browser_release_binding");
  if (typeof signature !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(signature))
    throw new Error("academy_browser_release_signature");
  const decoded = Buffer.from(signature, "base64url");
  if (
    decoded.toString("base64url") !== signature ||
    !verify(
      null,
      releaseMessage(bytes, licence),
      releaseKey(releasePublicKey, "public"),
      decoded,
    )
  )
    throw new Error("academy_browser_release_signature");
  await verifyAcademyArchive(directory, manifest);
  return { manifest, licenceState: state };
}

/** Compile the exact tracked Git checkout in a private source staging directory. */
async function buildAcademyBrowserPackage(output) {
  const {
    PORTAL_ACADEMY_BRAND_FILE: brandFile,
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: key,
    PATH,
  } = process.env;
  if (!isAbsolute(output ?? ""))
    throw new Error(
      "Provide a new absolute customer package output directory.",
    );
  validatePublicConfig(url, key, true);
  const backend = backendUrl(url);
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: releaseRoot,
      encoding: "utf8",
      timeout: 30_000,
    }).trim();
  const sourceRevision = git("rev-parse", "--verify", "HEAD^{commit}");
  if (git("status", "--porcelain"))
    throw new Error(
      "Commit or revert source changes before building a customer archive.",
    );
  const stage = mkdtempSync(join(tmpdir(), "academy-browser-build-"));
  try {
    const source = join(stage, "source");
    const tar = join(stage, "source.tar");
    const dist = join(stage, "browser");
    mkdirSync(source);
    git("archive", "--format=tar", `--output=${tar}`, sourceRevision);
    execFileSync("tar", ["-xf", tar, "-C", source], { timeout: 30_000 });
    const { brand, assets } = loadAcademyBrand(
      brandFile,
      join(source, "public"),
    );
    if (brand.edition === "internal")
      throw new Error("Packaging requires an explicit customer edition.");
    const modules = realpathSync(join(releaseRoot, "node_modules"));
    symlinkSync(modules, join(source, "node_modules"), "junction");
    try {
      execFileSync(
        process.execPath,
        [join(modules, "vite/bin/vite.js"), "build", "--outDir", dist],
        {
          cwd: source,
          timeout: 120_000,
          env: {
            PATH,
            NODE_ENV: "production",
            PORTAL_ACADEMY_BRAND_FILE: brandFile,
            VITE_SUPABASE_URL: backend,
            VITE_SUPABASE_PUBLISHABLE_KEY: key,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch {
      throw new Error(
        "Customer browser compilation failed. Run the customer Vite build locally for details.",
      );
    }
    const {
      edition,
      installationId,
      name,
      shortName,
      defaultLanguage,
      themeColor,
    } = brand;
    return await writeAcademyBrowserPackage({
      dist,
      output,
      approvedBrandAssets: assets,
      metadata: {
        sourceRevision,
        packageLockSha256: sha256(
          readRegular(join(source, "package-lock.json"), maxFileBytes),
        ),
        edition,
        installationId,
        name,
        shortName,
        defaultLanguage,
        themeColor,
        backend,
      },
    });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [action, directory, ...args] = process.argv.slice(2);
  try {
    if (directory && !args.length && ["build", "verify"].includes(action)) {
      const manifest =
        action === "build"
          ? await buildAcademyBrowserPackage(directory)
          : await verifyAcademyBrowserPackage(directory);
      console.log(
        `${action === "build" ? "Built" : "Verified"} static ${manifest.edition} browser artefact from ${manifest.sourceRevision}: ${manifest.archive.sha256}`,
      );
    } else if (directory && action === "sign-release" && args.length === 3) {
      const [licenceFile, licenceKeyFile, releaseKeyFile] = args;
      const signature = await signAcademyBrowserRelease({
        directory,
        licence: text(readRegular(licenceFile, maxReleaseInputBytes)).trim(),
        licencePublicKey: readRegular(licenceKeyFile, maxReleaseInputBytes),
        releasePrivateKey: readRegular(releaseKeyFile, maxReleaseInputBytes),
      });
      process.stdout.write(signature + "\n");
    } else if (directory && action === "verify-release" && args.length === 7) {
      const [
        signatureFile,
        licenceFile,
        licenceKeyFile,
        releaseKeyFile,
        installationId,
        edition,
        releaseCommit,
      ] = args;
      const { manifest, licenceState } = await verifyAcademyBrowserRelease({
        directory,
        signature: text(readRegular(signatureFile, 128)).trim(),
        licence: text(readRegular(licenceFile, maxReleaseInputBytes)).trim(),
        licencePublicKey: readRegular(licenceKeyFile, maxReleaseInputBytes),
        releasePublicKey: readRegular(releaseKeyFile, maxReleaseInputBytes),
        expected: {
          installation_id: installationId,
          edition,
          release_commit: releaseCommit,
        },
      });
      console.log(
        JSON.stringify({
          installationId: manifest.installationId,
          edition: manifest.edition,
          sourceRevision: manifest.sourceRevision,
          archiveSha256: manifest.archive.sha256,
          licenceState,
          customerReady: manifest.customerReady,
        }),
      );
      if (licenceState !== "active") process.exitCode = 2;
    } else {
      throw new Error(
        "Use build, verify, sign-release or verify-release as documented in DEVELOPMENT.md.",
      );
    }
  } catch (error) {
    console.error(
      action === "sign-release" || action === "verify-release"
        ? "Academy browser release rejected. Check the documented inputs, trusted keys and licence binding."
        : error instanceof Error && error.name !== "ZodError"
          ? error.message
          : "Invalid customer browser package metadata.",
    );
    process.exitCode = 1;
  }
}
