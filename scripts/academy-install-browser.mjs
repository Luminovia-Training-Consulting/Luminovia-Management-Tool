/** Materialize a freshly authorized browser release for the dedicated Caddy runtime. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  constants,
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, parseEnv } from "node:util";
import { verifyAcademyLicence } from "./academy-licence.mjs";
import {
  planAcademyStaging,
  readAcademyOperatorInput,
} from "./academy-staging-plan.mjs";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rateTemplate = new URL(
  "../deploy/academy/api-ingress.template.yml",
  import.meta.url,
);
const revisionPattern = /^[0-9a-f]{40}$/;
const swapBrowserDirectories = `
import ctypes
import os
import sys

AT_FDCWD = -100
RENAME_EXCHANGE = 2
rename = ctypes.CDLL(None, use_errno=True).renameat2
rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
rename.restype = ctypes.c_int
if rename(AT_FDCWD, os.fsencode(sys.argv[1]), AT_FDCWD, os.fsencode(sys.argv[2]), RENAME_EXCHANGE) != 0:
    sys.exit(1)
`;

function requirePrivateDirectory(path) {
  const state = lstatSync(path);
  if (
    !state.isDirectory() ||
    (state.mode & 0o077) !== 0 ||
    state.uid !== process.getuid()
  )
    throw new Error("academy_install_private_directory");
}

function requireMatchingRuntime(root, config, identity, runtime, browser) {
  if (
    identity.version !== 1 ||
    identity.browser_directory !== join(root, "browser") ||
    identity.data_directory !== join(root, "data") ||
    identity.backup_directory !== join(root, "backups")
  )
    throw new Error("academy_install_runtime_identity");
  for (const key of [
    "installation_id",
    "edition",
    "portal_origin",
    "api_base_url",
    "compose_project",
    "backend_network",
    "data_directory",
    "backup_directory",
  ]) {
    if (config[key] !== identity[key])
      throw new Error("academy_install_target_mismatch");
  }

  const exact = {
    ACADEMY_INSTALLATION_ID: identity.installation_id,
    ACADEMY_EDITION: identity.edition,
    COMPOSE_PROJECT_NAME: identity.compose_project,
    PORTAL_BACKEND_NETWORK: identity.backend_network,
    PORTAL_DATA_DIR: identity.data_directory,
    PORTAL_WWW_DIR: identity.browser_directory,
    PORTAL_APP_ORIGIN: identity.portal_origin,
    PORTAL_DOMAIN: new URL(identity.portal_origin).hostname,
    GLOBAL_S3_BUCKET: identity.compose_project + "-files",
    STORAGE_TENANT_ID: identity.compose_project,
    SUPABASE_PUBLIC_URL: identity.api_base_url,
    SITE_URL: identity.portal_origin,
    API_EXTERNAL_URL: identity.api_base_url + "/auth/v1",
    SUPABASE_PUBLISHABLE_KEY: browser.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (
    Object.entries(exact).some(
      ([key, value]) => !value || runtime[key] !== value,
    )
  )
    throw new Error("academy_install_runtime_mismatch");
}

export function requireStoppedAcademyIngress(root, project) {
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--env-file",
      join(root, "runtime.env"),
      "--project-name",
      project,
      "-f",
      fileURLToPath(
        new URL("../deploy/hostinger/selfhost/compose.yml", import.meta.url),
      ),
      "-f",
      fileURLToPath(
        new URL("../deploy/academy/compose.override.yml", import.meta.url),
      ),
      "--profile",
      "ingress",
      "ps",
      "--all",
      "--services",
      "--status",
      "running",
      "--status",
      "paused",
      "--status",
      "restarting",
    ],
    { env: { PATH: process.env.PATH }, encoding: "utf8", timeout: 15000 },
  );
  if (
    result.status !== 0 ||
    result.stdout
      .split(/\s+/)
      .some((service) => service === "web" || service === "api-ingress")
  )
    throw new Error("academy_install_ingress_must_be_stopped");
}

/** Both licence envelopes use the exact same operator-selected trust and release. */
export function verifyAcademyLicenceRenewal({
  previousEnvelope,
  envelope,
  publicKey,
  expected,
  now,
}) {
  const { terms: previous } = verifyAcademyLicence(
    previousEnvelope,
    publicKey,
    expected,
    now,
  );
  const { state, terms } = verifyAcademyLicence(
    envelope,
    publicKey,
    expected,
    now,
  );
  if (state !== "active") throw new Error("academy_install_renewal_inactive");
  if (terms.issued_at <= previous.issued_at)
    throw new Error("academy_install_renewal_issue_time");
  return { previous, terms };
}

async function renewRuntimeLicence(root, input) {
  const { renewAcademyLicenceInRuntime } =
    await import("./academy-installation.mjs");
  await renewAcademyLicenceInRuntime(root, input);
}

/** Publish the exact browser package. An explicit maintenance upgrade retains
 * the previous signed browser directory and never writes application data. */
export async function installAcademyBrowser(
  { root, config, replaceRevision, previousLicence, ...release },
  checkIngress = requireStoppedAcademyIngress,
  renewLicence = renewRuntimeLicence,
) {
  if (!isAbsolute(root ?? "") || realpathSync(root) !== root)
    throw new Error("academy_install_runtime_path");
  requirePrivateDirectory(root);
  const browserRoot = join(root, "browser");
  requirePrivateDirectory(browserRoot);
  const renewal = previousLicence !== undefined;
  const replacement = replaceRevision !== undefined;
  if (!renewal && !replacement && readdirSync(browserRoot).length)
    throw new Error("academy_install_runtime_already_staged");
  if (
    replacement &&
    (renewal ||
      !revisionPattern.test(replaceRevision) ||
      replaceRevision === config.release_commit)
  )
    throw new Error("academy_install_replacement_revision");

  const [identity, runtime, publicConfig] = await Promise.all(
    ["installation.json", "runtime.env", "runtime.env.public.env"].map(
      async (name) =>
        utf8.decode(await readAcademyOperatorInput(join(root, name))),
    ),
  );
  const publicValues = parseEnv(publicConfig);
  requireMatchingRuntime(
    root,
    config,
    JSON.parse(identity),
    parseEnv(runtime),
    publicValues,
  );
  const now = release.now ?? Date.now();
  const { plan, files } = await planAcademyStaging({
    ...release,
    now,
    config,
    publicConfig: publicValues,
    includeFiles: true,
  });

  const expected = {
    installation_id: plan.release.installation_id,
    edition: plan.release.edition,
    release_commit: plan.release.source_revision,
  };
  const renewalInput = {
    previousEnvelope: previousLicence,
    envelope: release.licence,
    publicKey: release.licencePublicKey,
    expected,
    now,
  };
  const { terms } = renewal
    ? verifyAcademyLicenceRenewal(renewalInput)
    : verifyAcademyLicence(
        release.licence,
        release.licencePublicKey,
        expected,
        now,
      );
  // Envoy's local bucket uses uint32 values. A higher signed maximum must
  // never overflow into an unlimited or larger allowance.
  const throughput = Math.min(
    terms.limits.api_requests_per_minute,
    0xffff_ffff,
  );
  const exchange = replacement || renewal;
  const staged = mkdtempSync(
    join(root, exchange ? ".browser-previous-" : ".browser-stage-"),
  );
  let retainPrevious = false;
  try {
    for (const [path, bytes] of files) {
      // These relative names were restricted by the signed archive verifier.
      // Hashed assets must remain outside the replaceable SPA shell in Caddy.
      const immutable =
        path.startsWith("assets/") || path.startsWith("workbox-");
      const destination = join(staged, immutable ? path : "current/" + path);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o755 });
      writeFileSync(destination, bytes, { flag: "wx", mode: 0o644 });
    }
    const receipt = {
      version: 1,
      state: "browser-staged",
      customer_ready: false,
      release: plan.release,
      brand_manifest_sha256: sha256(files.get("manifest.webmanifest")),
      licence: {
        sha256: sha256(release.licence),
        issued_at: terms.issued_at,
        expires_at: terms.expires_at,
        api_requests_per_minute: throughput,
      },
    };
    const ingress = readFileSync(rateTemplate, "utf8").replaceAll(
      "ACADEMY_SIGNED_API_REQUESTS_PER_MINUTE",
      String(throughput),
    );
    writeFileSync(join(staged, "api-ingress.yml"), ingress, {
      flag: "wx",
      mode: 0o644,
    });
    writeFileSync(
      join(staged, "release.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    if (exchange) {
      const lock = join(root, ".browser-upgrade-lock");
      try {
        mkdirSync(lock, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        throw new Error("academy_install_upgrade_in_progress", {
          cause: error,
        });
      }
      try {
        const previous = JSON.parse(
          utf8.decode(
            await readAcademyOperatorInput(join(browserRoot, "release.json")),
          ),
        );
        if (
          previous.version !== 1 ||
          previous.state !== "browser-staged" ||
          previous.release?.installation_id !== plan.release.installation_id ||
          previous.release?.edition !== plan.release.edition ||
          previous.release?.source_revision !==
            (renewal ? expected.release_commit : replaceRevision)
        )
          throw new Error("academy_install_replacement_revision");
        if (
          renewal &&
          (!isDeepStrictEqual(previous.release, receipt.release) ||
            (previous.brand_manifest_sha256 !== undefined &&
              previous.brand_manifest_sha256 !==
                receipt.brand_manifest_sha256) ||
            (previous.licence &&
              previous.licence.sha256 !== sha256(previousLicence) &&
              previous.licence.sha256 !== receipt.licence.sha256))
        )
          throw new Error("academy_install_renewal_receipt_mismatch");

        await checkIngress(root, config.compose_project);
        if (renewal) {
          const marker = join(browserRoot, "maintenance.enabled");
          const markerState = lstatSync(marker, { throwIfNoEntry: false });
          if (markerState) {
            if (!markerState.isFile())
              throw new Error("academy_install_maintenance_marker");
            copyFileSync(
              marker,
              join(staged, "maintenance.enabled"),
              constants.COPYFILE_EXCL,
            );
          }
          const alreadyStaged =
            isDeepStrictEqual(previous, receipt) &&
            utf8.decode(
              await readAcademyOperatorInput(
                join(browserRoot, "api-ingress.yml"),
              ),
            ) === ingress;
          // The DB compares its actual licence before applying the successor.
          // If an exchange failed after DB commit, that exact successor is accepted on retry.
          await renewLicence(root, renewalInput);
          if (alreadyStaged) return previous;
        }
        // From this point the allocated directory may contain the previous
        // release even if the process exits before reporting the exchange.
        retainPrevious = true;
        const swap = spawnSync(
          "python3",
          ["-I", "-c", swapBrowserDirectories, staged, browserRoot],
          {
            env: { PATH: process.env.PATH },
            timeout: 15000,
          },
        );
        if (swap.status !== 0)
          throw new Error("academy_install_atomic_replacement_failed");
      } finally {
        rmSync(lock, { force: true, recursive: true });
      }
    } else {
      // Concurrent first installers cannot overwrite a populated directory.
      renameSync(staged, browserRoot);
    }
    return receipt;
  } finally {
    if (!retainPrevious) rmSync(staged, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [
      root,
      target,
      directory,
      signaturePath,
      licencePath,
      licenceKeyPath,
      releaseKeyPath,
      flag,
      operationArgument,
    ] = process.argv.slice(2);
    if (
      process.argv.length !== 9 &&
      !(
        process.argv.length === 11 &&
        ["--replace-revision", "--renew-licence"].includes(flag)
      )
    )
      throw new Error("academy_install_usage");
    const [config, signature, licence, licencePublicKey, releasePublicKey] =
      await Promise.all(
        [
          target,
          signaturePath,
          licencePath,
          licenceKeyPath,
          releaseKeyPath,
        ].map((path) => readAcademyOperatorInput(path)),
      );
    const receipt = await installAcademyBrowser({
      root,
      config: JSON.parse(utf8.decode(config)),
      directory,
      signature: utf8.decode(signature).trim(),
      licence: utf8.decode(licence).trim(),
      licencePublicKey,
      releasePublicKey,
      replaceRevision:
        flag === "--replace-revision" ? operationArgument : undefined,
      previousLicence:
        flag === "--renew-licence"
          ? utf8
              .decode(await readAcademyOperatorInput(operationArgument))
              .trim()
          : undefined,
    });
    process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  } catch (error) {
    const reason = /^academy_(?:install|staging|browser_release)_[a-z_]+$/.test(
      error?.message,
    )
      ? ` (${error.message})`
      : "";
    process.stderr.write(
      "Academy browser installation rejected" +
        reason +
        ". Check RUNTIME_ROOT TARGET_JSON PACKAGE_DIR RELEASE_SIG LICENCE LICENCE_PUBLIC_KEY RELEASE_PUBLIC_KEY [--replace-revision CURRENT_COMMIT | --renew-licence PREVIOUS_SIGNED_LICENCE].\n",
    );
    process.exitCode = 1;
  }
}
