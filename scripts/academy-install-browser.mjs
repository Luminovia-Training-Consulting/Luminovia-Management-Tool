/** Materialize a freshly authorized browser release for the dedicated Caddy runtime. */
import { spawnSync } from "node:child_process";
import {
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
import { parseEnv } from "node:util";
import {
  planAcademyStaging,
  readAcademyOperatorInput,
} from "./academy-staging-plan.mjs";

const utf8 = new TextDecoder("utf-8", { fatal: true });
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

/** Publish the exact browser package. An explicit maintenance upgrade retains
 * the previous signed browser directory and never writes application data. */
export async function installAcademyBrowser(
  { root, config, replaceRevision, ...release },
  checkIngress = requireStoppedAcademyIngress,
) {
  if (!isAbsolute(root ?? "") || realpathSync(root) !== root)
    throw new Error("academy_install_runtime_path");
  requirePrivateDirectory(root);
  const browserRoot = join(root, "browser");
  requirePrivateDirectory(browserRoot);
  if (replaceRevision === undefined && readdirSync(browserRoot).length)
    throw new Error("academy_install_runtime_already_staged");
  if (
    replaceRevision !== undefined &&
    (!revisionPattern.test(replaceRevision) ||
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
  const { plan, files } = await planAcademyStaging({
    ...release,
    config,
    publicConfig: publicValues,
    includeFiles: true,
  });

  const replacement = replaceRevision !== undefined;
  const staged = mkdtempSync(
    join(root, replacement ? ".browser-previous-" : ".browser-stage-"),
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
    };
    // Envoy's local bucket uses uint32 values. A higher signed maximum must
    // never overflow into an unlimited or larger allowance.
    const throughput = Math.min(
      plan.licensed_limits.api_requests_per_minute,
      0xffff_ffff,
    );
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
    if (replacement) {
      const lock = join(root, ".browser-upgrade-lock");
      try {
        mkdirSync(lock, { mode: 0o700 });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        throw new Error("academy_install_upgrade_in_progress", { cause: error });
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
          previous.release?.source_revision !== replaceRevision
        )
          throw new Error("academy_install_replacement_revision");
        await checkIngress(root, config.compose_project);
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
      replaceRevision,
    ] = process.argv.slice(2);
    if (
      process.argv.length !== 9 &&
      !(process.argv.length === 11 && flag === "--replace-revision")
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
      replaceRevision,
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
        ". Check RUNTIME_ROOT TARGET_JSON PACKAGE_DIR RELEASE_SIG LICENCE LICENCE_PUBLIC_KEY RELEASE_PUBLIC_KEY [--replace-revision CURRENT_COMMIT].\n",
    );
    process.exitCode = 1;
  }
}
