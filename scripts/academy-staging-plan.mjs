/** Verify one customer release and emit its offline, non-secret infrastructure handoff. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";
import { checkAcademyHost } from "./academy-host-preflight.mjs";
import { verifyAcademyBrowserRelease } from "./academy-browser-package.mjs";
import { verifyAcademyLicence } from "./academy-licence.mjs";
import { validatePublicConfig } from "./public-config.ts";

const controlCharacters = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const smallFileBytes = 16_384;
const jsStringDelimiters = ['"', "'", "`"];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true });

const projectName = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,62}$/);
const hostLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const dnsName = z
  .string()
  .max(253)
  .refine(
    (name) =>
      name.includes(".") &&
      !/^[0-9.]+$/.test(name) &&
      name.split(".").every((label) => hostLabel.test(label)),
  );
const privateDirectory = z
  .string()
  .max(240)
  .regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/)
  .refine((path) => posix.normalize(path) === path);
const senderEmail = z
  .string()
  .max(254)
  .regex(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,63}$/i);
const senderName = z
  .string()
  .min(1)
  .max(120)
  .refine((name) => name.trim() === name && !controlCharacters.test(name));
const mailSender = { sender_email: senderEmail, sender_name: senderName };

const configSchema = z.strictObject({
  version: z.literal(1),
  installation_id: z.uuid(),
  edition: z.enum(["customer-self-hosted", "customer-managed"]),
  release_commit: z.string().regex(/^[0-9a-f]{40}$/),
  portal_origin: z.string().max(300),
  api_base_url: z.string().max(300),
  compose_project: projectName,
  backend_network: projectName,
  data_directory: privateDirectory,
  backup_directory: privateDirectory,
  backup_retention_days: z.int().positive(),
  data_region: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/),
  time_zone: z
    .string()
    .max(80)
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return /^[A-Za-z][A-Za-z0-9_+/-]*$/.test(zone);
      } catch {
        return false;
      }
    }),
  tls: z.enum(["acme", "operator-terminated"]),
  smtp: z.discriminatedUnion("mode", [
    z.strictObject({ mode: z.literal("capture"), ...mailSender }),
    z.strictObject({
      mode: z.literal("provider"),
      ...mailSender,
      host: dnsName.refine(
        (host) =>
          !/\.(localhost|local|internal|test|invalid|onion)$/.test(host),
      ),
      port: z.number().int().min(1).max(65535),
      security: z.enum(["implicit_tls", "starttls"]),
    }),
  ]),
});

const publicConfigSchema = z.strictObject({
  VITE_SUPABASE_URL: z.string().max(300),
  VITE_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .max(2048)
    .regex(
      /^sb_publishable_[A-Za-z0-9_-]{16,128}$|^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    ),
});

function httpsBase(value, rootOnly = false) {
  if (!/^https:\/\/[A-Za-z0-9._:/-]+$/.test(value))
    throw new Error("academy_staging_https_url");
  const url = new URL(value);
  if (
    !dnsName.safeParse(url.hostname).success ||
    url.hostname === "cms.luminovia.org" ||
    !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(url.pathname) ||
    (rootOnly && url.pathname !== "/") ||
    (value !== url.href && value + "/" !== url.href)
  )
    throw new Error("academy_staging_https_url");
  return url.href.replace(/\/$/, "");
}

const inside = (candidate, root) =>
  candidate === root || candidate.startsWith(root + "/");

function infrastructurePlan(config) {
  const site = httpsBase(config.portal_origin, true);
  const api = httpsBase(config.api_base_url);
  if (
    site === api ||
    [config.compose_project, config.backend_network].some((name) =>
      [
        "luminovia-supabase",
        "luminovia-portal",
        "luminovia-portal-backend",
      ].includes(name),
    ) ||
    inside(config.backup_directory, config.data_directory) ||
    inside(config.data_directory, config.backup_directory) ||
    [config.data_directory, config.backup_directory].some((path) =>
      ["/opt/luminovia-portal", "/var/backups/luminovia-complete"].some(
        (reserved) => inside(path, reserved) || inside(reserved, path),
      ),
    )
  )
    throw new Error("academy_staging_target_collision");
  if (
    config.smtp.mode === "provider" &&
    (config.smtp.port === 465) !== (config.smtp.security === "implicit_tls")
  )
    throw new Error("academy_staging_smtp_policy");
  const redirects = [site + "/auth/callback", site + "/auth/password"];
  const verifyPath =
    new URL(api).pathname.replace(/\/$/, "") + "/auth/v1/verify";
  const storageNamespace =
    "academy-" + config.installation_id.replaceAll("-", "");
  return {
    site,
    api,
    redirects,
    verifyPath,
    environment: {
      PORTAL_APP_ORIGIN: site,
      PORTAL_ALLOWED_ORIGINS: site,
      PORTAL_MAIL_TEMPLATE_ORIGIN: site,
      PORTAL_BACKEND_NETWORK: config.backend_network,
      PORTAL_DATA_DIR: config.data_directory,
      PORTAL_INVITES_ENABLED: "false",
      PORTAL_WEBSITE_ENQUIRIES_ENABLED: "false",
      SUPABASE_PUBLIC_URL: api,
      API_EXTERNAL_URL: api + "/auth/v1",
      SITE_URL: site,
      ADDITIONAL_REDIRECT_URLS: redirects.join(","),
      MAILER_URLPATHS_INVITE: verifyPath,
      MAILER_URLPATHS_CONFIRMATION: verifyPath,
      MAILER_URLPATHS_RECOVERY: verifyPath,
      MAILER_URLPATHS_EMAIL_CHANGE: verifyPath,
      SMTP_ADMIN_EMAIL: config.smtp.sender_email,
      SMTP_SENDER_NAME: config.smtp.sender_name,
      GLOBAL_S3_BUCKET: storageNamespace + "-files",
      STORAGE_TENANT_ID: storageNamespace,
      REGION: config.data_region,
    },
  };
}

/** Do not follow symlinks or read unbounded input from a pipe or growing file. */
export async function readAcademyOperatorInput(path, limit = smallFileBytes) {
  if (!isAbsolute(path ?? ""))
    throw new Error("academy_staging_absolute_input");
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await file.stat({ bigint: true });
    if (
      !before.isFile() ||
      before.nlink !== 1n ||
      before.size < 1n ||
      before.size > BigInt(limit)
    )
      throw new Error("academy_staging_input_file");
    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) throw new Error("academy_staging_input_changed");
      offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      after.nlink !== 1n
    )
      throw new Error("academy_staging_input_changed");
    return buffer;
  } finally {
    await file.close();
  }
}

/** Confirm the target's public key is in the signed browser chunks without returning it. */
function matchBrowserKey(files, key) {
  for (const [path, bytes] of files) {
    if (!path.startsWith("assets/") || !path.endsWith(".js")) continue;
    const source = utf8.decode(bytes);
    // Vite can emit a static template literal. The input schema excludes
    // delimiters, escapes and interpolation characters in the key itself.
    if (
      jsStringDelimiters.some((delimiter) =>
        source.includes(delimiter + key + delimiter),
      )
    )
      return;
  }
  throw new Error("academy_staging_browser_key_mismatch");
}

export async function planAcademyStaging({
  config,
  publicConfig,
  directory,
  signature,
  licence,
  licencePublicKey,
  releasePublicKey,
  now,
  includeFiles = false,
  verifyInactiveRenewal = false,
}) {
  const target = configSchema.parse(config);
  const infra = infrastructurePlan(target);
  const browser = publicConfigSchema.parse(publicConfig);
  if (httpsBase(browser.VITE_SUPABASE_URL) !== infra.api)
    throw new Error("academy_staging_public_url_mismatch");
  validatePublicConfig(infra.api, browser.VITE_SUPABASE_PUBLISHABLE_KEY, true);
  const expected = {
    installation_id: target.installation_id,
    edition: target.edition,
    release_commit: target.release_commit,
  };
  const verifiedAt = now ?? Date.now();
  const { manifest, licenceState, files } = await verifyAcademyBrowserRelease({
    directory,
    signature,
    licence,
    licencePublicKey,
    releasePublicKey,
    expected,
    now: verifiedAt,
    includeFiles: true,
  });
  // The installer may verify historical bytes for a recovery. Publishing
  // them still requires an exact, already committed database licence.
  if (
    licenceState !== "active" &&
    !(verifyInactiveRenewal && ["grace", "expired"].includes(licenceState))
  )
    throw new Error("academy_staging_inactive_licence");
  if (manifest.backend !== infra.api)
    throw new Error("academy_staging_signed_backend_mismatch");
  matchBrowserKey(files, browser.VITE_SUPABASE_PUBLISHABLE_KEY);
  const { terms } = verifyAcademyLicence(
    licence,
    licencePublicKey,
    expected,
    verifiedAt,
  );

  const plan = {
    version: 1,
    kind: "academy-staging-plan",
    state: "offline-preflight-verified",
    customer_ready: false,
    release: {
      installation_id: manifest.installationId,
      edition: manifest.edition,
      source_revision: manifest.sourceRevision,
      package_lock_sha256: manifest.packageLockSha256,
      archive_sha256: manifest.archive.sha256,
      licence_state: licenceState,
      browser_public_key_sha256: sha256(browser.VITE_SUPABASE_PUBLISHABLE_KEY),
    },
    licensed_limits: terms.limits,
    infrastructure: {
      compose_project: target.compose_project,
      backend_network: target.backend_network,
      data_directory: target.data_directory,
      backup_directory: target.backup_directory,
      backup_retention_days: target.backup_retention_days,
      data_region: target.data_region,
      time_zone: target.time_zone,
      tls: target.tls,
      smtp: target.smtp,
    },
    browser: {
      origin: infra.site,
      api_base_url: infra.api,
      name: manifest.name,
      language: manifest.defaultLanguage,
    },
    auth: {
      allowed_origins: [infra.site],
      redirect_urls: infra.redirects,
      mail_verify_path: infra.verifyPath,
      mail_template_urls: [
        infra.site + "/mail-templates/invite.html",
        infra.site + "/mail-templates/recovery.html",
      ],
    },
    environment: infra.environment,
    pending: [
      "isolated runtime and persistent volume setup",
      "gateway public key, DNS, TLS and Auth callback checks",
      "branded Auth templates and SMTP acceptance",
      "reviewed migrations, licensed database and first administrator",
      "Storage, scanner, realtime, quota and health acceptance",
      "independent encrypted backup, restore and retained-data upgrade",
    ],
  };
  return includeFiles ? { plan, files } : plan;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [
    config,
    publicEnv,
    directory,
    signature,
    licence,
    licenceKey,
    releaseKey,
    ...extra
  ] = process.argv.slice(2);
  try {
    if (
      !releaseKey ||
      (extra.length !== 0 &&
        !(
          extra.length === 2 &&
          extra[0] === "--check-host" &&
          isAbsolute(extra[1])
        ))
    )
      throw new Error("academy_staging_usage");
    const [target, browser, detached, envelope, issuer, signer] =
      await Promise.all(
        [config, publicEnv, signature, licence, licenceKey, releaseKey].map(
          (path) => readAcademyOperatorInput(path),
        ),
      );
    const settings = JSON.parse(utf8.decode(target));
    const publicConfig = parseEnv(utf8.decode(browser));
    const plan = await planAcademyStaging({
      config: settings,
      publicConfig,
      directory,
      signature: utf8.decode(detached).trim(),
      licence: utf8.decode(envelope).trim(),
      licencePublicKey: issuer,
      releasePublicKey: signer,
    });
    if (extra.length) {
      const host = await checkAcademyHost({
        root: extra[1],
        config: settings,
        publicConfig,
        plan,
        readPrivate: readAcademyOperatorInput,
      });
      process.stdout.write(JSON.stringify({ ...plan, host }, null, 2) + "\n");
      if (host.status === "blocked") process.exitCode = 1;
    } else {
      process.stdout.write(JSON.stringify(plan, null, 2) + "\n");
    }
  } catch (error) {
    const reason = /^academy_staging_[a-z_]+$/.test(error?.message)
      ? ` (${error.message})`
      : "";
    process.stderr.write(
      "Academy staging plan rejected" +
        reason +
        ". Check TARGET_JSON PUBLIC_ENV PACKAGE_DIR RELEASE_SIG LICENCE LICENCE_PUBLIC_KEY RELEASE_PUBLIC_KEY [--check-host RUNTIME_ROOT].\n",
    );
    process.exitCode = 1;
  }
}
