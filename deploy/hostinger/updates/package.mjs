/**
 * Build a verifiable CMS development release from one tracked commit. Validate
 * allowed paths, exact file/migration hashes, public build values and pinned
 * images; worker artifacts retain locked dependencies and license evidence.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";

export const REPOSITORY =
  "Luminovia-Training-Consulting/Luminovia-Management-Tool";
export const API_URL = "https://cms.luminovia.org/backend";
const SHA = /^[0-9a-f]{40}$/;
const IMMUTABLE_IMAGE = /^[a-z0-9][a-z0-9._/:+-]*@sha256:[0-9a-f]{64}$/;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const PG_PROOF = "deploy/hostinger/selfhost/postgres-candidate-proof.json";
const PG_IMAGE = /^supabase\/postgres:17\.\d+\.\d+\.\d+@sha256:[a-f0-9]{64}$/;
const SKIP_SOURCE =
  /(?:^|\/)(?:tests?|__tests__|fixtures|node_modules|\.git|\.local|private)(?:\/|$)|(?:_test\.ts|\.test\.[cm]?[jt]sx?)$/;
const REQUIRED_FILES = [
  "deploy/hostinger/Caddyfile",
  "deploy/hostinger/compose.yml",
  "deploy/hostinger/clamd.conf",
  "deploy/hostinger/instance.json",
  "deploy/hostinger/selfhost/compose.yml",
  "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
  "deploy/hostinger/supabase/images.lock.json",
  "deploy/hostinger/supabase/upstream-provenance.json",
  "deploy/hostinger/supabase/UPSTREAM_LICENSE",
  "deploy/hostinger/supabase/upstream/volumes/functions/deno.jsonc",
  "deploy/hostinger/updates/updater.py",
  "deploy/hostinger/updates/luminovia-update.service",
  "deploy/hostinger/maintenance/pg_preflight.py",
  "deploy/hostinger/maintenance/atomic_recovery.py",
  "deploy/hostinger/maintenance/configure-os-daily.sh",
  "deploy/hostinger/backups/complete_backup.py",
  "deploy/hostinger/backups/database-summary.sql",
  "deploy/hostinger/backups/extension-recovery.json",
];
const OPTIONAL_FILES = [
  PG_PROOF,
  "deploy/hostinger/backups/luminovia-complete-backup.service",
  "deploy/hostinger/backups/luminovia-complete-backup.timer",
];
const WORKER_FILES = [
  ...["notification-mail", "notification-push"].flatMap((kind) => [
    `deploy/hostinger/${kind}/luminovia-${kind}.service`,
    `deploy/hostinger/${kind}/luminovia-${kind}.timer`,
    `deploy/hostinger/${kind}/worker.env.example`,
  ]),
];

// The finite worker has no proxy option. Excluding an unused optional proxy
// implementation avoids native Kerberos/runtime npm dependencies. Standard
// web-push encryption/VAPID/request generation remain the exact locked source.
const BUILD_PUSH = String.raw`
import {rolldown} from 'rolldown';
const bundle=await rolldown({input:'scripts/notification-push-worker.mjs',platform:'node',external:id=>id.startsWith('node:'),plugins:[{name:'luminovia-no-proxy',resolveId(id){if(id==='https-proxy-agent')return '\0luminovia-no-proxy';},load(id){if(id==='\0luminovia-no-proxy')return 'export class HttpsProxyAgent { constructor() { throw new Error("Proxy support is disabled in the finite Luminovia worker"); } }';}}]});
try{const result=await bundle.generate({format:'esm',codeSplitting:false,comments:false,legalComments:'none'});if(result.output.length!==1||result.output[0].type!=='chunk')throw new Error('single_worker_chunk_required');const chunk=result.output[0];process.stdout.write(JSON.stringify({code:chunk.code,modules:Object.keys(chunk.modules),imports:chunk.imports,dynamicImports:chunk.dynamicImports}));}finally{await bundle.close();}
`;

/** Open a worker input once and validate/read that descriptor, never a checked
 * path again. Nonblocking/no-follow opens reject links and cannot hang on FIFOs;
 * the finite read and post-read metadata check reject replacement/in-place edits.
 */
function readWorkerInput(path) {
  if (
    !Number.isInteger(constants.O_NOFOLLOW) ||
    !Number.isInteger(constants.O_NONBLOCK)
  )
    throw new Error("Secure worker input descriptor flags are unavailable.");
  const descriptor = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_FILE_BYTES))
      throw new Error("Worker input must be a bounded regular file.");
    const size = Number(before.size);
    const bytes = Buffer.alloc(size + 1);
    let count = 0;
    while (count < bytes.length) {
      const received = readSync(
        descriptor,
        bytes,
        count,
        bytes.length - count,
        null,
      );
      if (!received) break;
      count += received;
    }
    const after = fstatSync(descriptor, { bigint: true });
    if (
      count !== size ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    )
      throw new Error("Worker input changed while reading.");
    return bytes.subarray(0, count);
  } finally {
    closeSync(descriptor);
  }
}

/** Bundle only reviewed worker paths; runtime imports and provenance fail closed. */
function workerArtifacts(sourceRoot, tracked) {
  const sourceNames = [
    "scripts/notification-push-worker.mjs",
    "scripts/notification-mail-worker.py",
    "package-lock.json",
    "package.json",
  ];
  const sources = sourceNames.map((path) => {
    plainFile(join(sourceRoot, path), sourceRoot);
    if (tracked && !tracked.has(path))
      throw new Error("Worker source is not tracked by release commit.");
    return { path, sha256: hash(readWorkerInput(join(sourceRoot, path))) };
  });
  const lock = JSON.parse(
    readWorkerInput(join(sourceRoot, "package-lock.json")).toString("utf8"),
  );
  if (lock.packages?.["node_modules/web-push"]?.version !== "4.0.0")
    throw new Error("Reviewed exact web-push lock version required.");
  const generated = JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", BUILD_PUSH], {
      cwd: sourceRoot,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_FILE_BYTES,
      timeout: 60000,
    }).toString(),
  );
  if (
    !generated.code ||
    generated.imports.some((name) => !isBuiltin(name)) ||
    generated.dynamicImports.length
  )
    throw new Error("Push worker must be standalone with Node builtins only.");
  const artifacts = new Map();
  const dependencies = new Map();
  for (const module of generated.modules) {
    if (module.startsWith("\0")) continue;
    const normalized = module.split(sep).join("/");
    const marker = normalized.lastIndexOf("/node_modules/");
    if (marker < 0) {
      if (
        realpathSync(module) !==
        realpathSync(join(sourceRoot, "scripts/notification-push-worker.mjs"))
      )
        throw new Error("Unexpected worker source module.");
      continue;
    }
    const suffix = normalized.slice(marker + 14),
      segments = suffix.split("/"),
      name = segments[0].startsWith("@")
        ? segments.slice(0, 2).join("/")
        : segments[0];
    const packageRoot = normalized.slice(0, marker + 14) + name;
    const metadata = JSON.parse(
      readWorkerInput(join(packageRoot, "package.json")).toString("utf8"),
    );
    const candidates = Object.entries(lock.packages ?? {}).filter(
      ([path, value]) =>
        (path === `node_modules/${name}` ||
          path.endsWith(`/node_modules/${name}`)) &&
        value.version === metadata.version,
    );
    if (
      metadata.name !== name ||
      !candidates.length ||
      !candidates[0][1].integrity ||
      new Set(candidates.map(([, item]) => item.integrity)).size !== 1
    )
      throw new Error("Worker dependency is missing exact lock integrity.");
    let record = dependencies.get(name);
    if (!record) {
      record = {
        name,
        version: metadata.version,
        integrity: candidates[0][1].integrity,
        license: metadata.license,
        modules: [],
      };
      dependencies.set(name, record);
      const licenses = readdirSync(packageRoot).filter((file) =>
        /^(?:licen[cs]e|copying|copyright)(?:[.-].*)?$/i.test(file),
      );
      if (!licenses.length && name === "http_ece") {
        const fallback =
          "deploy/hostinger/notification-push/licenses/http_ece-LICENSE.txt";
        plainFile(join(sourceRoot, fallback), sourceRoot);
        if (tracked && !tracked.has(fallback))
          throw new Error("Worker license fallback is not tracked.");
        const bytes = readWorkerInput(join(sourceRoot, fallback));
        if (
          hash(bytes) !==
          "717363ac0c7f0883042868db171cfed1f4b423119249eac9bce5131291017ea8"
        )
          throw new Error("Reviewed http_ece license source differs.");
        artifacts.set(fallback, bytes);
        record.licenseSource =
          "https://raw.githubusercontent.com/martinthomson/encrypted-content-encoding/v1.2.1/LICENSE";
      } else if (!licenses.length)
        throw new Error("Worker dependency license is missing.");
      for (const file of licenses) {
        const licensePath = join(packageRoot, file);
        artifacts.set(
          `deploy/hostinger/notification-push/licenses/${name.replaceAll("/", "_")}-${file.replaceAll(" ", "_")}`,
          readWorkerInput(licensePath),
        );
      }
    }
    record.modules.push({
      path: relative(packageRoot, module).split(sep).join("/"),
      sha256: hash(readWorkerInput(module)),
    });
  }
  const toolRoot = realpathSync(join(sourceRoot, "node_modules/rolldown"));
  const tool = JSON.parse(
    readWorkerInput(join(toolRoot, "package.json")).toString("utf8"),
  );
  if (tool.version !== lock.packages?.["node_modules/rolldown"]?.version)
    throw new Error("Worker bundler differs from lockfile.");
  artifacts.set(
    "deploy/hostinger/notification-push/licenses/rolldown-LICENSE",
    readWorkerInput(join(toolRoot, "LICENSE")),
  );
  artifacts.set(
    "deploy/hostinger/notification-push/worker.mjs",
    Buffer.from(generated.code),
  );
  artifacts.set(
    "deploy/hostinger/notification-push/provenance.json",
    Buffer.from(
      JSON.stringify(
        {
          schemaVersion: 1,
          format: "luminovia-standalone-push-worker-v1",
          sources,
          tool: {
            name: tool.name,
            version: tool.version,
            integrity: lock.packages["node_modules/rolldown"].integrity,
          },
          proxySupport: false,
          imports: generated.imports,
          dependencies: [...dependencies.values()]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((record) => ({
              ...record,
              modules: record.modules.sort((a, b) =>
                a.path.localeCompare(b.path),
              ),
            })),
          bundleSha256: hash(Buffer.from(generated.code)),
        },
        null,
        2,
      ) + "\n",
    ),
  );
  for (const source of sources)
    if (hash(readWorkerInput(join(sourceRoot, source.path))) !== source.sha256)
      throw new Error("Worker source changed during packaging.");
  return artifacts;
}

// Compute a stable SHA-256 digest for the source/artifact comparison.
const hash = (data) => createHash("sha256").update(data).digest("hex");

// Limit archive paths to the fixed app allowlist; reject traversal and private checkout paths.
function safePath(name) {
  if (
    !name ||
    name.length > 250 ||
    name.includes("\\") ||
    Array.from(name).some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    ) ||
    name.startsWith("/") ||
    name.split("/").some((part) => !part || part === "." || part === "..") ||
    name.split("/").some((part) => part.startsWith(".env")) ||
    /(?:^|\/)(?:private|\.local|\.git|node_modules)(?:\/|$)/.test(name)
  )
    throw new Error("Unsafe release path.");
  if (
    !/^(?:site\/|supabase\/(?:functions|migrations)\/|deploy\/hostinger\/)/.test(
      name,
    )
  ) {
    throw new Error("Release path is outside the application allowlist.");
  }
}

// Check path components for symlinks and require a regular source file within its size limit.
function plainFile(path, sourceRoot) {
  const rel = relative(sourceRoot, path);
  if (rel === ".." || rel.startsWith(".." + sep) || rel.startsWith(sep)) {
    throw new Error("Source path escapes the checkout.");
  }
  let current = sourceRoot;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink())
      throw new Error("Release source contains a symbolic link.");
  }
  const info = lstatSync(path);
  if (!info.isFile() || info.size > MAX_FILE_BYTES)
    throw new Error("Invalid release file.");
  return info;
}

// Collect only allowed files from an approved source tree and reject duplicate archive destinations.
function collectTree(
  sourceRoot,
  sourceDirectory,
  targetDirectory,
  collected,
  skipTests = false,
) {
  const directory = join(sourceRoot, sourceDirectory);
  if (!existsSync(directory))
    throw new Error("Required release source directory is missing.");
  if (lstatSync(directory).isSymbolicLink())
    throw new Error("Release source directory is a symbolic link.");
  const visit = (path, suffix) => {
    const info = lstatSync(path);
    if (info.isSymbolicLink())
      throw new Error("Release source contains a symbolic link.");
    if (skipTests && SKIP_SOURCE.test(suffix)) return;
    if (info.isDirectory()) {
      for (const item of readdirSync(path).sort())
        visit(join(path, item), suffix ? suffix + "/" + item : item);
      return;
    }
    const target = targetDirectory + "/" + suffix;
    safePath(target);
    plainFile(path, sourceRoot);
    if (collected.has(target)) throw new Error("Duplicate release path.");
    collected.set(target, path);
  };
  visit(directory, "");
}

// Read each Compose service's immutable digest pin from actual source.
function serviceImages(text) {
  const result = [];
  let service;
  for (const line of text.split("\n")) {
    const key = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(line);
    if (key) service = key[1];
    const image = /^ {4}image:\s*([^#]+?)\s*$/.exec(line);
    if (image) {
      const value = image[1].replace(/^["']|["']$/g, "");
      if (!service || !IMMUTABLE_IMAGE.test(value))
        throw new Error("Runtime images require immutable digest pins.");
      result.push({ service, image: value });
    }
  }
  return result;
}

// Bind the expected service inventory and PostgreSQL proof to exact release migrations.
function runtimeMetadata(sourceRoot, migrations) {
  const images = [
    ...serviceImages(
      readFileSync(
        join(sourceRoot, "deploy/hostinger/selfhost/compose.yml"),
        "utf8",
      ),
    ),
    ...serviceImages(
      readFileSync(join(sourceRoot, "deploy/hostinger/compose.yml"), "utf8"),
    ),
  ].sort((a, b) => a.service.localeCompare(b.service));
  const expected = [
    "api-gw",
    "auth",
    "clamav",
    "db",
    "functions",
    "mailpit",
    "realtime",
    "rest",
    "storage",
    "web",
  ].sort();
  if (
    JSON.stringify(images.map((item) => item.service).sort()) !==
    JSON.stringify(expected)
  ) {
    throw new Error("The reviewed runtime service set changed.");
  }
  const database = images.find((item) => item.service === "db").image;
  const major = /^supabase\/postgres:(\d+)\./.exec(database)?.[1];
  if (major !== "17")
    throw new Error(
      "PostgreSQL major upgrades require a separate reviewed procedure.",
    );
  const provenance = JSON.parse(
    readFileSync(
      join(
        sourceRoot,
        "deploy/hostinger/selfhost/postgres-upgrade-provenance.json",
      ),
      "utf8",
    ),
  );
  const required = [
    "candidateRestorePassed",
    "migrationSourcesExact",
    "roleAndMembershipExact",
    "persistentFilesExact",
  ];
  const manual =
    provenance.schemaVersion === 1 &&
    provenance.reviewed === true &&
    provenance.targetImage === database &&
    provenance.validation?.helperSelfTestPassed === true &&
    required.every((field) => provenance[field] === true);
  let generated = false;
  if (existsSync(join(sourceRoot, PG_PROOF))) {
    const proof = JSON.parse(readFileSync(join(sourceRoot, PG_PROOF), "utf8"));
    const inventory = migrations
      .map(({ path, sha256 }) => ({ path, sha256 }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    // A completed image-upgrade proof remains valid when later application
    // migrations append to its byte-exact history. Fresh image promotion still
    // requires a proof of the complete candidate inventory.
    const proven = proof.migrationInventory;
    const unchangedPrefix =
      Array.isArray(proven) &&
      proven.length > 0 &&
      proven.length <= inventory.length &&
      proven.every(
        (entry, index) =>
          entry !== null &&
          typeof entry === "object" &&
          JSON.stringify(Object.keys(entry).sort()) ===
            JSON.stringify(["path", "sha256"]) &&
          entry.path === inventory[index].path &&
          entry.sha256 === inventory[index].sha256,
      );
    generated =
      proof.schemaVersion === 1 &&
      proof.postgresMajor === 17 &&
      proof.requiresLiveDataPreflight === true &&
      typeof proof.sourceCommit === "string" &&
      SHA.test(proof.sourceCommit) &&
      PG_IMAGE.test(proof.sourceImage ?? "") &&
      PG_IMAGE.test(proof.targetImage ?? "") &&
      proof.sourceImage !== proof.targetImage &&
      proof.targetImage === database &&
      unchangedPrefix &&
      proof.migrationInventorySha256 === hash(JSON.stringify(proven)) &&
      proof.validation?.kind === "isolated-selfhost-upgrade-fixture" &&
      [
        "passed",
        "migrationSourcesExact",
        "existingCredentialsAndFileExact",
        "roleAndMembershipExact",
      ].every((field) => proof.validation[field] === true);
    if (!generated)
      throw new Error(
        "PostgreSQL candidate proof lacks exact completed compatibility evidence.",
      );
  }
  if (!manual && !generated)
    throw new Error(
      "Database image lacks matching completed compatibility evidence.",
    );
  return {
    postgresMajor: 17,
    reviewed: true,
    images,
    ...(generated
      ? { requiresLiveDataPreflight: true, postgresCandidateProof: PG_PROOF }
      : {}),
  };
}

// Reject known server-secret patterns before including content in a distributable release.
function assertNoCredentials(data, source, publicKey, forbiddenValues) {
  const text = data.toString("utf8");
  if (
    forbiddenValues.some((value) => value && data.includes(Buffer.from(value)))
  ) {
    throw new Error("A private credential value appears in release content.");
  }
  if (
    /sb_secret_[A-Za-z0-9_-]{16,}/.test(text) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
  ) {
    throw new Error("Release content contains a secret-key value.");
  }
  for (const assignment of text.matchAll(
    /(?:SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|POSTGRES_PASSWORD|JWT_SECRET)["']?\s*[:=]\s*["']([^"']+)["']/g,
  )) {
    if (assignment[1].length >= 12 && !assignment[1].startsWith("${")) {
      throw new Error(
        "Release content contains a literal server credential assignment.",
      );
    }
  }
  for (const match of text.matchAll(
    /eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g,
  )) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(match[1], "base64url").toString());
    } catch {
      continue;
    }
    if (payload.role === "service_role")
      throw new Error("Release content contains a service-role token.");
  }
  if (
    source.startsWith("site/") &&
    text.includes("VITE_SUPABASE_PUBLISHABLE_KEY=")
  ) {
    throw new Error("Frontend output contains an environment file.");
  }
  if (source.startsWith("site/") && publicKey.startsWith("sb_secret_"))
    throw new Error("Secret key cannot be public build configuration.");
}

// Validate build configuration, source inventory and runtime contract before creating the manifest/archive.
export function createRelease(options) {
  const sourceRoot = realpathSync(resolve(options.sourceRoot ?? "."));
  const output = resolve(options.outputDirectory);
  const commit = options.commit;
  const publicKey = options.publicConfig?.publishableKey;
  if (!SHA.test(commit ?? ""))
    throw new Error("Expected an exact lowercase 40-character source commit.");
  if (
    options.publicConfig?.apiUrl !== API_URL ||
    typeof publicKey !== "string" ||
    !/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(publicKey)
  ) {
    throw new Error(
      "Expected the CMS public API URL and a publishable browser key.",
    );
  }
  const verifyCheckout = () => {
    if (options.verifyGit === false) return;
    const actual = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: sourceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (actual !== commit)
      throw new Error("Release commit does not match the checked-out source.");
    const dirty = execFileSync(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      { cwd: sourceRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (dirty)
      throw new Error("Release source has uncommitted tracked changes.");
  };
  verifyCheckout();
  const tracked =
    options.verifyGit === false
      ? null
      : new Set(
          execFileSync("git", ["ls-files", "-z"], {
            cwd: sourceRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }).split("\0"),
        );
  const collected = new Map();
  collectTree(sourceRoot, "dist", "site", collected);
  collectTree(
    sourceRoot,
    "supabase/functions",
    "supabase/functions",
    collected,
    true,
  );
  collectTree(
    sourceRoot,
    "supabase/migrations",
    "supabase/migrations",
    collected,
  );
  collectTree(
    sourceRoot,
    "deploy/hostinger/selfhost/runtime",
    "deploy/hostinger/selfhost/runtime",
    collected,
  );
  collectTree(
    sourceRoot,
    "deploy/hostinger/selfhost/envoy",
    "deploy/hostinger/selfhost/envoy",
    collected,
  );
  collectTree(
    sourceRoot,
    "deploy/hostinger/supabase/upstream/volumes/db",
    "deploy/hostinger/supabase/upstream/volumes/db",
    collected,
    true,
  );
  collectTree(
    sourceRoot,
    "deploy/hostinger/supabase/upstream/volumes/api/envoy",
    "deploy/hostinger/supabase/upstream/volumes/api/envoy",
    collected,
  );
  for (const file of REQUIRED_FILES) {
    plainFile(join(sourceRoot, file), sourceRoot);
    safePath(file);
    collected.set(file, join(sourceRoot, file));
  }
  for (const file of OPTIONAL_FILES) {
    if (!existsSync(join(sourceRoot, file))) continue;
    plainFile(join(sourceRoot, file), sourceRoot);
    safePath(file);
    collected.set(file, join(sourceRoot, file));
  }
  for (const kind of ["invite", "recovery"]) {
    const source = join(sourceRoot, "supabase/templates/" + kind + ".html");
    plainFile(source, sourceRoot);
    collected.set("deploy/hostinger/mail-templates/" + kind + ".html", source);
  }
  const forbiddenValues = options.forbiddenValues ?? [];
  if (
    !Array.isArray(forbiddenValues) ||
    forbiddenValues.some(
      (value) => typeof value !== "string" || value.length < 8,
    )
  ) {
    throw new Error("Invalid private-value exclusion configuration.");
  }
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const archivePath = join(output, "cms-release.tar.gz");
  const manifestPath = join(output, "cms-release.json");
  if (existsSync(archivePath) || existsSync(manifestPath))
    throw new Error("Refusing to overwrite an existing release artifact.");
  const stage = mkdtempSync(join(tmpdir(), "luminovia-release-"));
  const files = [];
  let total = 0;
  let configuredBundle = false;
  try {
    for (const file of WORKER_FILES) {
      plainFile(join(sourceRoot, file), sourceRoot);
      collected.set(file, join(sourceRoot, file));
    }
    collected.set(
      "deploy/hostinger/notification-mail/worker.py",
      join(sourceRoot, "scripts/notification-mail-worker.py"),
    );
    const generated = workerArtifacts(sourceRoot, tracked);
    for (const [name, path] of [
      ...collected,
      ...[...generated.keys()].map((name) => [name, null]),
    ].sort(([a], [b]) => a.localeCompare(b))) {
      safePath(name);
      const info =
        path === null
          ? { size: generated.get(name).length, mode: 0o644 }
          : plainFile(path, sourceRoot);
      if (
        tracked &&
        path !== null &&
        !name.startsWith("site/") &&
        !tracked.has(relative(sourceRoot, path).split(sep).join("/"))
      ) {
        throw new Error(
          "Runtime input is not tracked by the release source commit.",
        );
      }
      const data = path === null ? generated.get(name) : readFileSync(path);
      total += data.length;
      if (total > MAX_TOTAL_BYTES || data.length !== info.size)
        throw new Error("Release input changed or exceeded its size bound.");
      assertNoCredentials(data, name, publicKey, forbiddenValues);
      if (
        name.startsWith("site/") &&
        name.endsWith(".js") &&
        data.includes(Buffer.from(API_URL)) &&
        data.includes(Buffer.from(publicKey))
      )
        configuredBundle = true;
      const destination = join(stage, name);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
      writeFileSync(destination, data, {
        flag: "wx",
        mode: info.mode & 0o111 ? 0o755 : 0o644,
      });
      files.push({ path: name, sha256: hash(data), size: data.length });
    }
    if (
      !files.some((file) => file.path === "site/index.html") ||
      !configuredBundle
    )
      throw new Error(
        "Frontend build is missing its CMS public configuration.",
      );
    verifyCheckout();
    const migrations = files
      .filter((file) => file.path.startsWith("supabase/migrations/"))
      .map((file) => {
        const match = /^supabase\/migrations\/(\d{14})_([a-z0-9_]+)\.sql$/.exec(
          file.path,
        );
        if (!match) throw new Error("Unexpected migration path.");
        return { version: match[1], path: file.path, sha256: file.sha256 };
      })
      .sort((a, b) => a.version.localeCompare(b.version));
    if (
      !migrations.length ||
      new Set(migrations.map((item) => item.version)).size !== migrations.length
    )
      throw new Error("Invalid migration inventory.");
    // Verify proof inventories against the exact staged bytes entering the tar.
    const runtime = runtimeMetadata(stage, migrations);
    const list = join(stage, "release-files.list");
    writeFileSync(list, files.map((file) => file.path).join("\0") + "\0", {
      mode: 0o600,
    });
    execFileSync(
      "tar",
      [
        "--format=ustar",
        "--sort=name",
        "--mtime=@0",
        "--owner=0",
        "--group=0",
        "--numeric-owner",
        "-czf",
        archivePath,
        "--null",
        "--verbatim-files-from",
        "--files-from",
        list,
      ],
      { cwd: stage, stdio: ["ignore", "pipe", "pipe"] },
    );
    chmodSync(archivePath, 0o600);
    const manifest = {
      schemaVersion: 1,
      repository: REPOSITORY,
      branch: "main",
      commit,
      archiveSha256: hash(readFileSync(archivePath)),
      siteEntry: "site/index.html",
      publicBuild: { apiUrl: API_URL, publishableKeySha256: hash(publicKey) },
      files,
      migrations,
      runtime,
    };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    return { archivePath, manifestPath, manifest };
  } catch (error) {
    rmSync(archivePath, { force: true });
    rmSync(manifestPath, { force: true });
    throw error;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    const flags = {};
    if (args.length % 2) throw new Error("Arguments require explicit values.");
    for (let index = 0; index < args.length; index += 2) {
      if (
        !["--commit", "--output", "--source-root"].includes(args[index]) ||
        flags[args[index]]
      )
        throw new Error("Unknown or repeated release argument.");
      flags[args[index]] = args[index + 1];
    }
    if (!flags["--output"])
      throw new Error("A release output directory is required.");
    const excluded = [
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SECRET_KEY",
      "POSTGRES_PASSWORD",
      "JWT_SECRET",
      "SMTP_PASS",
      "PORTAL_NOTIFICATION_SMTP_PASSWORD",
      "PORTAL_NOTIFICATION_SERVICE_KEY",
      "PORTAL_PUSH_SERVICE_KEY",
      "PORTAL_PUSH_VAPID_PRIVATE_KEY",
    ]
      .map((key) => process.env[key])
      .filter(Boolean);
    createRelease({
      commit: flags["--commit"],
      sourceRoot: flags["--source-root"] ?? ".",
      outputDirectory: flags["--output"],
      publicConfig: {
        apiUrl: process.env.VITE_SUPABASE_URL,
        publishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      forbiddenValues: excluded,
    });
    console.log(
      "Created immutable CMS release archive and hash manifest; no credential values printed.",
    );
  } catch {
    console.error(
      "CMS release packaging failed; verify source, public build configuration and reviewed runtime provenance.",
    );
    process.exitCode = 1;
  }
}
