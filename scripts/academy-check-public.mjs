/** Read-only evidence for a signed Academy target's public ingress. */
import { createHash } from "node:crypto";
import { Resolver } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { describeAcademyRuntime } from "./academy-runtime-config.mjs";
import {
  readRuntimeHandoffFile,
  verifyAcademyRuntimeHandoff,
} from "./academy-runtime-handoff.mjs";
import { planAcademyStaging } from "./academy-staging-plan.mjs";
import { publicAddress } from "./notification-push-worker.mjs";

const reservedOrigins = new Set([
  "https://cms.luminovia.org",
  "https://portal.luminovia.org",
  "https://lms.luminovia.org",
]);
const identityFields = [
  "installation_id",
  "edition",
  "portal_origin",
  "api_base_url",
  "compose_project",
  "backend_network",
  "data_directory",
  "backup_directory",
];
const shellPaths = ["/", "/auth/callback", "/auth/password"];
const uncachedPaths = ["/index.html", "/manifest.webmanifest", "/sw.js"];
const deniedPaths = [
  "/backend/auth/v1/admin/users",
  "/backend/storage/v1/bucket",
];
const capabilitiesPath = "/backend/rest/v1/rpc/installation_capabilities";
const redirectPath = "/auth/callback?academy-acceptance=1";
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

class PublicCheckFailure extends Error {
  constructor(reason) {
    super("academy_public_" + reason);
  }
}

function requireEvidence(condition, reason) {
  if (!condition) throw new PublicCheckFailure(reason);
}

async function resolvePublicAddresses(hostname) {
  const resolver = new Resolver({ timeout: 3000, tries: 2 });
  const ignoreEmpty = (error) => {
    if (error.code === "ENODATA") return [];
    throw error;
  };
  const [ipv4, ipv6] = await Promise.all([
    resolver.resolve4(hostname).catch(ignoreEmpty),
    resolver.resolve6(hostname).catch(ignoreEmpty),
  ]);
  return [...ipv4, ...ipv6];
}

function readEndpoint({ hostname, address, path, secure = true, key, limit }) {
  return new Promise((fulfil, reject) => {
    const transport = secure ? https : http;
    const request = transport.get(
      {
        hostname: address,
        path,
        ...(secure && { servername: hostname, rejectUnauthorized: true }),
        agent: false,
        signal: AbortSignal.timeout(8000),
        headers: {
          host: hostname,
          "accept-encoding": "identity",
          ...(key && { apikey: key }),
        },
      },
      async (response) => {
        try {
          const chunks = [];
          let bytes = 0;
          for await (const chunk of response) {
            bytes += chunk.length;
            requireEvidence(bytes <= limit, "response_size");
            chunks.push(chunk);
          }
          fulfil({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks, bytes),
          });
        } catch (error) {
          reject(error);
        }
      },
    );
    request.on("error", reject);
  });
}

function cacheDirective(response, directive) {
  return (response.headers["cache-control"] ?? "")
    .toLowerCase()
    .split(",")
    .some((value) => value.trim() === directive);
}

export async function checkAcademyPublic(
  { handoff, handoffPublicKey, ...inputs },
  { resolveAddresses = resolvePublicAddresses, request = readEndpoint } = {},
) {
  let target;
  let handoffDigest;
  let plan;
  let files;
  try {
    ({ target, sha256: handoffDigest } = verifyAcademyRuntimeHandoff(
      handoff,
      handoffPublicKey,
    ));
    const expected = describeAcademyRuntime({
      root: target.runtime_directory,
      installationId: target.installation_id,
      edition: target.edition,
      portalOrigin: target.portal_origin,
    });
    requireEvidence(
      !reservedOrigins.has(expected.portal_origin) &&
        target.portal_origin === expected.portal_origin &&
        identityFields.every(
          (field) => inputs.config[field] === expected[field],
        ),
      "target",
    );
    ({ plan, files } = await planAcademyStaging({
      ...inputs,
      includeFiles: true,
    }));
  } catch (error) {
    if (error instanceof PublicCheckFailure) throw error;
    throw new PublicCheckFailure("trust_inputs");
  }

  const hostname = new URL(plan.browser.origin).hostname;
  let addresses;
  try {
    addresses = [...new Set(await resolveAddresses(hostname))];
  } catch {
    throw new PublicCheckFailure("dns");
  }
  requireEvidence(
    addresses.length > 0 &&
      addresses.length <= 8 &&
      addresses.every(publicAddress),
    "addresses",
  );

  const shell = Buffer.from(files.get("index.html")).toString("utf8");
  const entryAssets = Array.from(
    new Set(
      Array.from(
        shell.matchAll(/(?:src|href)="\/(assets\/[^"]+)"/g),
        (match) => match[1],
      ),
    ),
  );
  requireEvidence(
    entryAssets.length > 0 && entryAssets.length <= 16,
    "entry_assets",
  );
  const signedPaths = new Map([
    ...shellPaths.map((path) => [path, "index.html"]),
    ...[
      ...uncachedPaths,
      "/api/openapi.json",
      ...entryAssets.map((file) => "/" + file),
    ].map((path) => [path, path.slice(1)]),
  ]);
  const probes = Array.from(signedPaths, ([path, name]) => {
    const bytes = files.get(name);
    return { path, size: bytes.byteLength, digest: sha256(bytes) };
  });

  const checkAddress = async (address) => {
    const get = (path, options = {}) =>
      request({ hostname, address, path, limit: 8192, ...options });
    if (plan.infrastructure.tls === "acme") {
      const redirect = await get(redirectPath, { secure: false });
      requireEvidence(
        redirect.status === 308 &&
          redirect.headers.location === plan.browser.origin + redirectPath,
        "redirect",
      );
    }
    for (const { path, size, digest } of probes) {
      const response = await get(path, { limit: size });
      requireEvidence(
        response.status === 200 && sha256(response.body) === digest,
        "signed_bytes",
      );
      if (uncachedPaths.includes(path))
        requireEvidence(cacheDirective(response, "no-store"), "shell_cache");
    }
    const response = await get(capabilitiesPath, {
      key: inputs.publicConfig.VITE_SUPABASE_PUBLISHABLE_KEY,
    });
    requireEvidence(
      response.status === 200 &&
        cacheDirective(response, "no-store") &&
        cacheDirective(response, "private"),
      "capabilities_http",
    );
    let body;
    try {
      body = JSON.parse(response.body);
    } catch {
      throw new PublicCheckFailure("capabilities_identity");
    }
    const expected = {
      installation_id: target.installation_id,
      edition: target.edition,
      licence_status: "active",
      customer_ready: false,
      lms_available: false,
      marketplace_available: false,
      company_premium_switch_available: false,
    };
    requireEvidence(
      body &&
        typeof body === "object" &&
        Object.keys(body).length === Object.keys(expected).length &&
        Object.entries(expected).every(
          ([field, value]) => body[field] === value,
        ),
      "capabilities_identity",
    );
    for (const path of deniedPaths)
      requireEvidence((await get(path)).status === 404, "restricted_route");
  };
  try {
    await Promise.all(addresses.map(checkAddress));
  } catch (error) {
    if (error instanceof PublicCheckFailure) throw error;
    throw new PublicCheckFailure("transport");
  }

  return {
    version: 1,
    status: "public_ingress_verified",
    checked_at: new Date().toISOString(),
    installation_id: target.installation_id,
    edition: target.edition,
    portal_origin: plan.browser.origin,
    source_revision: plan.release.source_revision,
    handoff_sha256: handoffDigest,
    archive_sha256: plan.release.archive_sha256,
    public_dns_address_count: addresses.length,
    tls_mode: plan.infrastructure.tls,
    http_redirect:
      plan.infrastructure.tls === "acme"
        ? "verified"
        : "operator_check_required",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [
    handoff,
    handoffKey,
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
    requireEvidence(releaseKey && !extra.length, "usage");
    const receipt = await checkAcademyPublic({
      handoff: readRuntimeHandoffFile(handoff),
      handoffPublicKey: readRuntimeHandoffFile(handoffKey, false),
      config: JSON.parse(readRuntimeHandoffFile(config)),
      publicConfig: parseEnv(
        readRuntimeHandoffFile(publicEnv, false).toString("utf8"),
      ),
      directory,
      signature: readRuntimeHandoffFile(signature, false)
        .toString("utf8")
        .trim(),
      licence: readRuntimeHandoffFile(licence).toString("utf8").trim(),
      licencePublicKey: readRuntimeHandoffFile(licenceKey, false),
      releasePublicKey: readRuntimeHandoffFile(releaseKey, false),
    });
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } catch (error) {
    const reason =
      error instanceof PublicCheckFailure
        ? error.message
        : "academy_public_trust_inputs";
    process.stderr.write(
      "Academy public ingress could not be verified (" + reason + ").\n",
    );
    process.exitCode = 1;
  }
}
