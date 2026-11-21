/** Initialize a private, empty runtime for one dedicated academy. */
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import {
  createConfiguration,
  writeConfiguration,
} from "../deploy/hostinger/selfhost/generate-env.mjs";

const editions = z.enum(["customer-self-hosted", "customer-managed"]);
const domainLabels =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Derive the exact customer runtime identity without touching the filesystem. */
export function describeAcademyRuntime({
  root,
  installationId,
  edition,
  portalOrigin,
}) {
  if (
    typeof root !== "string" ||
    !/^\/[A-Za-z0-9/_-]+$/.test(root) ||
    resolve(root) !== root
  )
    throw new Error("academy_runtime_path");
  if (
    !z.uuid().safeParse(installationId).success ||
    installationId !== installationId.toLowerCase() ||
    !editions.safeParse(edition).success
  )
    throw new Error("academy_runtime_identity");
  const portal = URL.parse(portalOrigin);
  if (
    !portal ||
    portal.protocol !== "https:" ||
    portal.pathname !== "/" ||
    portal.username ||
    portal.password ||
    portal.port ||
    portal.search ||
    portal.hash ||
    !domainLabels.test(portal.hostname) ||
    portal.hostname.length > 253
  )
    throw new Error("academy_runtime_origin");
  const project = "academy-" + installationId.replaceAll("-", "");
  return {
    version: 1,
    installation_id: installationId,
    edition,
    portal_origin: portal.origin,
    api_base_url: portal.origin + "/backend",
    compose_project: project,
    backend_network: project + "-backend",
    data_directory: join(root, "data"),
    backup_directory: join(root, "backups"),
    browser_directory: join(root, "browser"),
  };
}

/** Reserve fresh private paths and generate the independent runtime settings. */
export function initializeAcademyRuntime({ root, bindAddress, ...target }) {
  const identity = describeAcademyRuntime({ root, ...target });
  if (realpathSync(dirname(root)) !== dirname(root))
    throw new Error("academy_runtime_parent");
  if (typeof bindAddress !== "string" || isIP(bindAddress) !== 4)
    throw new Error("academy_runtime_bind_address");

  const configuration = createConfiguration({
    portalOrigin: identity.portal_origin,
    apiOrigin: identity.api_base_url,
    dataDirectory: identity.data_directory,
    network: identity.backend_network,
  });
  Object.assign(configuration.server, {
    COMPOSE_PROJECT_NAME: identity.compose_project,
    ACADEMY_INSTALLATION_ID: identity.installation_id,
    ACADEMY_EDITION: identity.edition,
    ACADEMY_BIND_ADDRESS: bindAddress,
    PORTAL_DOMAIN: new URL(identity.portal_origin).hostname,
    PORTAL_WWW_DIR: identity.browser_directory,
    PORTAL_INVITES_ENABLED: "false",
    ACADEMY_NOTIFICATION_MAIL_ENABLED: "false",
    GLOBAL_S3_BUCKET: identity.compose_project + "-files",
    STORAGE_TENANT_ID: identity.compose_project,
    SMTP_SENDER_NAME: "Academy",
  });

  // Exclusive creation never resets secrets or retained data, including empty
  // existing directories and symbolic links. All children are operator-owned.
  mkdirSync(root, { mode: 0o700 });
  try {
    for (const path of [
      identity.data_directory,
      identity.backup_directory,
      identity.browser_directory,
    ])
      mkdirSync(path, { mode: 0o700 });
    writeConfiguration(join(root, "runtime.env"), configuration);
    writeFileSync(
      join(root, "installation.json"),
      JSON.stringify(identity, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
    return identity;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [root, installationId, edition, portalOrigin, bindAddress] =
      process.argv.slice(2);
    if (process.argv.length !== 7) throw new Error("academy_runtime_arguments");
    initializeAcademyRuntime({
      root,
      installationId,
      edition,
      portalOrigin,
      bindAddress,
    });
    console.log("Created private configuration for an empty academy runtime.");
  } catch {
    console.error(
      "Could not initialize the academy runtime. Provide a new absolute directory, installation UUID, dedicated edition, HTTPS domain and IPv4 bind address.",
    );
    process.exitCode = 1;
  }
}
