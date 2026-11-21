/** Materialize a freshly authorized browser release for the dedicated Caddy runtime. */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

/** On a fresh runtime only, publish the verified in-memory bytes in one directory rename. */
export async function installAcademyBrowser({ root, config, ...release }) {
  if (!isAbsolute(root ?? "") || realpathSync(root) !== root)
    throw new Error("academy_install_runtime_path");
  requirePrivateDirectory(root);
  const browserRoot = join(root, "browser");
  requirePrivateDirectory(browserRoot);
  if (readdirSync(browserRoot).length)
    throw new Error("academy_install_runtime_already_staged");

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

  const staged = mkdtempSync(join(root, ".browser-stage-"));
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
    writeFileSync(
      join(staged, "release.json"),
      JSON.stringify(receipt, null, 2) + "\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
    // Concurrent installers cannot replace the already populated directory.
    renameSync(staged, browserRoot);
    return receipt;
  } finally {
    rmSync(staged, { recursive: true, force: true });
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
    ] = process.argv.slice(2);
    if (process.argv.length !== 9) throw new Error("academy_install_usage");
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
        ". Check RUNTIME_ROOT TARGET_JSON PACKAGE_DIR RELEASE_SIG LICENCE LICENCE_PUBLIC_KEY RELEASE_PUBLIC_KEY.\n",
    );
    process.exitCode = 1;
  }
}
