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

/** Pair the browser and gateway on a customer-owned HTTPS origin and reserve fresh private paths. */
export function initializeAcademyRuntime({
  root,
  installationId,
  edition,
  portalOrigin,
  bindAddress,
}) {
  if (
    typeof root !== "string" ||
    !/^\/[A-Za-z0-9/_-]+$/.test(root) ||
    resolve(root) !== root
  )
    throw new Error("academy_runtime_path");
  if (realpathSync(dirname(root)) !== dirname(root))
    throw new Error("academy_runtime_parent");
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
  if (typeof bindAddress !== "string" || isIP(bindAddress) !== 4)
    throw new Error("academy_runtime_bind_address");

  const project = "academy-" + installationId.replaceAll("-", "");
  const api = portal.origin + "/backend";
  const network = project + "-backend";
  const layout = {
    data: join(root, "data"),
    backups: join(root, "backups"),
    browser: join(root, "browser"),
  };
  const configuration = createConfiguration({
    portalOrigin: portal.origin,
    apiOrigin: api,
    dataDirectory: layout.data,
    network,
  });
  Object.assign(configuration.server, {
    COMPOSE_PROJECT_NAME: project,
    ACADEMY_INSTALLATION_ID: installationId,
    ACADEMY_EDITION: edition,
    ACADEMY_BIND_ADDRESS: bindAddress,
    PORTAL_DOMAIN: portal.hostname,
    PORTAL_WWW_DIR: layout.browser,
    PORTAL_INVITES_ENABLED: "false",
    GLOBAL_S3_BUCKET: project + "-files",
    STORAGE_TENANT_ID: project,
    SMTP_SENDER_NAME: "Academy",
  });

  // Exclusive creation never resets secrets or retained data, including empty
  // existing directories and symbolic links. All children are operator-owned.
  mkdirSync(root, { mode: 0o700 });
  try {
    for (const path of Object.values(layout)) mkdirSync(path, { mode: 0o700 });
    writeConfiguration(join(root, "runtime.env"), configuration);
    const identity = {
      version: 1,
      installation_id: installationId,
      edition,
      portal_origin: portal.origin,
      api_base_url: api,
      compose_project: project,
      backend_network: network,
      data_directory: layout.data,
      backup_directory: layout.backups,
      browser_directory: layout.browser,
    };
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
