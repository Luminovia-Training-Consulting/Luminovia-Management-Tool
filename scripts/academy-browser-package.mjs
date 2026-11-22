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
import { isDeepStrictEqual } from "node:util";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { z } from "zod";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
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
const demoAssetPattern = /^assets\/(?:demo|learner-demo)(?:[-.])/i;
const demoEntryPattern = /^assets\/demo-[A-Za-z0-9_-]{8}\.js$/;
const demoMeta = '<meta name="portal-public-demo" content="enabled">';
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
  // Absent is the original, demo-free manifest format. Only explicit opt-in is signed.
  publicDemo: z.literal(true).optional(),
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

function approvedPath(path, publicDemo) {
  return (
    fixedFiles.has(path) ||
    workerPattern.test(path) ||
    (assetPattern.test(path) && (publicDemo || !demoAssetPattern.test(path)))
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
function readBrowserOutput(root, publicDemo) {
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
        if (!info.isFile() || !approvedPath(path, publicDemo))
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

// Reviewed full-document fingerprints from prior tracked releases. Some
// revisions shipped distinct operations under the same version.
const reviewedHistoricCatalogueDigests = new Set([
  "193ee8fbcd27ef61541dbc590ad4ae49c7e1170413843779ba72aadeb314cc19", // 1.2.0 at 9fc7124b
  "53dc4e16854b8da09dfa47ca7b3b0882bf844916eeb5a82fd54a919e73019f2a", // 1.3.0 at a14b2bf1
  "9cc7a71d028c715080c16f3fc9828ec5eb20a29ec19ecf3a9ac77508f39dbb95", // 1.4.0 at 731f644a
  "ba24dc961d0fa4420504a30cc7ca95ef4f61194224af8388fc555038a4ca35a9", // 1.5.0 at 3e3b813e
  "e19599cb547f487c1f35d853070fe8781ec4b06f545b6ba6dcaa0859def6d8a6", // 1.6.0 at 0463b0e9
  "5f307b8f9fc211356c01cca2914027239dd13d0871c5ab65fc7c1fc2cd82a28e", // 1.7.0 at c9f7b5cb
  "44d2a909c86d8c6f916bb37233524550f62b9acc5f374795edf280663fa53f1b", // 1.8.0 at 77967930
  "341d6a96873640dd27a134ef41e588d58a04ea0b7904a0da4e7ccee44b30e726", // 1.9.0 at 804eef6f
  "f75ff4c7c483ad495a9f922b79b9b5af30373e2ec3d4b3d075bd42dba7b5d421", // 1.10.0 at 110c0fc7
  "77a6e204bad3611ee62dadd3adcb4117a188d26ca66b28488a6ec743f92a57b1", // 1.10.0 at e4de7f5c
  "1da01bcd83818c8a2b5ef3870dfd834ae83cc835a8ae49f7852365aeaddd2eca", // 1.10.0 at 6559dda0
  "1be1659610492cdf09549ada6b1bc911c3078835ca57eb0b99d56c21f8b83b34", // 1.11.0 at 47a1a01a
  "c211b4b4d39554279e5c6aa244664425712721f1514f3157c3c6c1b50a183db8", // 1.11.0 at 0598f02f
  "4dfabdf95e002ecc600a89d7e5fb514ddeabac25c93d9674d22a7b2cc26ce802", // 1.12.0 at f3566df4
  "06f3245a20e1e37b10bfc24555e305b76634058b02a9dcbf67bcf55a0f760706", // 1.13.0 at 29cb416b
  "38baff0f6c0645806c171f34ce6315ecb80c90648f25cc545e5eabb7b01595c1", // 1.13.0 at eb70d4c1
  "347d199d9d7ae5910b073edb59d81cf3a13102e8c16b935628d95a85ed59ab15", // 1.14.0 at 0c5dc0b7
  "c0fbb7602238e0415aabf411d87c36243d20a4c05cedf9a081bce7ff16bf4068", // 1.15.0 at 8c0ffb25
  "e93e0540d0b71fa919ab4229601ad83966c635fb4a4a42713870b201b4af4559", // 1.16.0 at f52a291d
  "0a55af348cc077552579ea62e8601ac9314264c3a218ce4dabeb3037a9f12d45", // 1.16.0 at 81dabb85
  "f36a3b5c5baa0793ac6974f9ecac555ebbb284cd327e7684398f34f78676991c", // 1.17.0 at 35fd7b04
  "1ccca68d725f9e1963262f0d681c3e10e3408de9dcf57d247e460987940f3d55", // 1.17.0 at 1b039ae5
  "3af7271f0bcc77ce87e56fdbaee4f706486f108097d77a7978de73c1e9c78b32", // 1.18.0 at 325f1736
  "7a684096aec80074d984d307cc6629d11e8a84feda7385878b032003b38c024c", // 1.18.0 at b86c6927
  "36db1a6eee90c837ab19872cc24297543be6bba398d5669c3a0c97f233120792", // 1.19.0 at bda967fa
  "3c04917afcd2375d0505d771412f425d32a95232ad957601d927b0d34f468001", // 1.20.0 at e4763f06
  "b7d534eb7db74ff7bc2e4a48826d374d005e7d85fdf8a32f1c35c062b1b386ba", // 1.21.0 at ff12036f
  "42af2ce29e10952417230a4af184aad7811c60c0e63baea797549eeba015f263", // 1.22.0 at 2bea4aa6
  "f11b8701a3a21471a5aa512056eeec20dadd26252a3d5a199295686f047438a2", // 1.23.0 at d355a867
  "48cd02400c2caa6d17adef84661d171fa43fd5ec6e5a8b76365f92d06e95cb0e", // 1.24.0 at 746e1b2c
  "525694fd71b2da5fdb0e9db2d191709561e49fbcf757f08a8f5c5e00d93205e6", // 1.25.0 at 07dc3047
  "ca0d23471b82a757384bba6c4cbd69aa0ea6a2ac18ce9eeac732660e6f890684", // 1.26.0 at 2f8409fc
  "35c70d4d2eb31dcf558b00f59b4fc78dd4084900996cc5a7f15d15277df46a2c", // 1.27.0 at 80f1cf71
  "18da7946feae760905ee6e84074c1f10a1f9eab652739c928cd8584045e63dc5", // 1.28.0 at 6dbe42ab
  "aaddce805db2ca452464911eb2584732c9775fe1293e2ef6afa9cd6601f54765", // 1.29.0 at ef8a724f
  "357c7a0b831c57e752e1c900bc88e4907108957054e3a4a74aec53d2fa5dc26a", // 1.30.0 at 72b60eec
  "abdf4557bc499a06e85cf92bf9f900cf9ef135f21e32a72eba037906c368c0a7", // 1.31.0 at dac6ad2c
  "7258117b1fb505f2e1a612fdc20282cc4a80c80c24f7d2e0917aeac08993b10f", // 1.32.0 at 80b21cca
  "a26045e621e5519cbfe4580bfdcf00e68fc2712c795671a74c90e283fb9b5296", // 1.33.0 at bb83068f
  "d4c139a21fa64fb6a39d8a0596b828afb2162e59f6033ccbcbfed6150d0a5b5d", // 1.34.0 at dc5d10bb
  "2aa99ba92870cbe472fd9a44ec688ce2017321140bc25f5d3275b2a9bf344530", // 1.35.0 at a47ed0da
]);

/** Check the template identity before removing only its installation-specific values. */
function historicCatalogueDigest(api, brand, backend) {
  const normalized = structuredClone(api);
  const identity = normalized["x-portal-installation"];
  const capabilities =
    normalized.paths?.["/rest/v1/rpc/installation_capabilities"]?.get
      ?.responses?.["200"]?.content?.["application/json"]?.schema?.properties;
  if (
    normalized.info?.title !== `${brand.name} API` ||
    !isDeepStrictEqual(normalized.servers, [{ url: backend }]) ||
    !isDeepStrictEqual(capabilities?.installation_id, {
      const: brand.installationId,
    }) ||
    !isDeepStrictEqual(capabilities?.edition, { const: brand.edition })
  )
    return null;

  // The outer API identity is matched by the caller before this fallback.
  normalized.info.title = null;
  normalized.servers[0].url = null;
  identity.installation_id = null;
  identity.edition = null;
  capabilities.installation_id.const = null;
  capabilities.edition.const = null;
  return sha256(
    JSON.stringify(normalized, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]]),
          )
        : value,
    ),
  );
}

/** Associate every render surface and its dormant public contract with the same customer build. */
function validateBrowserOutput(
  files,
  brand,
  approvedBrandAssets,
  apiHistory = "none",
) {
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
  const publicDemo = brand.publicDemo === true;
  if (
    index.includes(demoMeta) !== publicDemo ||
    [...files.keys()].some((path) => demoEntryPattern.test(path)) !== publicDemo
  )
    throw new Error(
      "The public demo does not match the reviewed browser option.",
    );
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
  const apiBackend = backendUrl(brand.backend);
  const expectedApi = academyOpenApi(apiBackend, brand);
  if (
    api.info?.version === expectedApi.info.version &&
    /["']\/?(?:manifest\.webmanifest|icons\/apple-touch-icon\.png)["']/.test(
      worker,
    )
  ) {
    throw new Error(
      "The PWA cache cannot contain runtime-managed branding assets.",
    );
  }
  // Keep the original empty-catalogue exception exact. Nonempty catalogue
  // history requires a verified release signature in addition to its digest.
  if (apiHistory !== "none" && api.info?.version === "1.1.0") {
    deepStrictEqual(
      api,
      {
        ...expectedApi,
        info: {
          title: `${brand.name} API`,
          version: "1.1.0",
          description:
            "Customer operations become available only when the installation has passed the edition readiness checks.",
        },
        paths: {},
        components: { securitySchemes: {} },
      },
      "Historic customer API differs from the original catalogue.",
    );
  } else if (
    !isDeepStrictEqual(api, expectedApi) &&
    !(
      apiHistory === "verified-release" &&
      reviewedHistoricCatalogueDigests.has(
        historicCatalogueDigest(api, brand, apiBackend),
      )
    )
  ) {
    throw new Error("Customer API differs from the reviewed course profile.");
  }
  if (
    !worker.includes("brand/academy-logo.png") ||
    !worker.includes("icons/icon-512.png") ||
    !worker.includes("push-sw.js") ||
    /(?:luminovia-logo|["']\/?demo(?:[/.-]|["']))/.test(worker)
  )
    throw new Error("The PWA cache does not pass edition preflight.");
  for (const [path, bytes] of files) {
    if (!/\.(?:js|css|html|json|webmanifest|txt)$/.test(path)) continue;
    const source = text(bytes);
    if (
      (publicDemo && /luminovia-logo-(?:full|mark)/i.test(source)) ||
      (!publicDemo &&
        /DEMO · (?:Fictional data only|Nur fiktive Daten)|Fictional course message|Fiktive Kursnachricht/.test(
          source,
        )) ||
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
  const files = readBrowserOutput(dist, metadata.publicDemo === true);
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
async function verifyAcademyArchive(
  directory,
  manifest,
  apiHistory = "legacy-empty",
) {
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
        !approvedPath(path, manifest.publicDemo === true) ||
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
  validateBrowserOutput(files, manifest, undefined, apiHistory);
  return files;
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
 * Installers can request the verified, prefix-relative bytes without reopening
 * the archive. They still decide whether the returned licence state permits use.
 */
export async function verifyAcademyBrowserRelease({
  directory,
  licence,
  licencePublicKey,
  releasePublicKey,
  signature,
  expected,
  now,
  includeFiles = false,
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
  const files = await verifyAcademyArchive(
    directory,
    manifest,
    "verified-release",
  );
  return {
    manifest,
    licenceState: state,
    ...(includeFiles === true ? { files } : {}),
  };
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
    const { brand, assets, publicDemo } = loadAcademyBrand(
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
        ...(publicDemo && { publicDemo: true }),
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
          ...(manifest.publicDemo && { publicDemo: true }),
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
