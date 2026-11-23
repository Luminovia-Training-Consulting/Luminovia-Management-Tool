/** Initialize a private, empty runtime for one dedicated academy. */
import {
  lstatSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { academyDomainLabels } from "../src/features/branding/academy-customer-draft-schema.ts";
import {
  createConfiguration,
  writeConfiguration,
} from "../deploy/hostinger/selfhost/generate-env.mjs";
import {
  readRuntimeHandoffFile,
  verifyAcademyRuntimeHandoff,
} from "./academy-runtime-handoff.mjs";

const editions = z.enum(["customer-self-hosted", "customer-managed"]);
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
    !academyDomainLabels.test(portal.hostname) ||
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
export function initializeAcademyRuntime(
  { root, bindAddress, ...target },
  handoffReceipt,
) {
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
    if (handoffReceipt)
      writeFileSync(
        join(root, "runtime-handoff.json"),
        JSON.stringify(handoffReceipt, null, 2) + "\n",
        { flag: "wx", mode: 0o600 },
      );
    return identity;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function requireHandoffParent(root) {
  const operator = process.getuid();
  const parent = dirname(root);
  const checkout = resolve(fileURLToPath(new URL("../", import.meta.url)));
  if (realpathSync(parent) !== parent || root.startsWith(checkout + "/"))
    throw new Error("academy_runtime_handoff_parent");
  for (let path = parent; ; path = dirname(path)) {
    const directory = lstatSync(path);
    if (
      !directory.isDirectory() ||
      (directory.uid !== operator && directory.uid !== 0) ||
      ((directory.mode & 0o022) !== 0 &&
        !(directory.uid === 0 && (directory.mode & 0o1000) !== 0))
    )
      throw new Error("academy_runtime_handoff_parent");
    if (path === dirname(path)) break;
  }
}

/** Initialize only the path independently confirmed by the local operator. */
function initializeAcademyRuntimeFromHandoff({
  root,
  handoff,
  trustedKey,
  bindAddress,
}) {
  const { target, sha256 } = verifyAcademyRuntimeHandoff(
    readRuntimeHandoffFile(handoff),
    readRuntimeHandoffFile(trustedKey, false),
  );
  if (root !== target.runtime_directory)
    throw new Error("academy_runtime_handoff_local_path_mismatch");
  const options = {
    root,
    bindAddress,
    installationId: target.installation_id,
    edition: target.edition,
    portalOrigin: target.portal_origin,
  };
  const identity = describeAcademyRuntime(options);
  if (
    identity.portal_origin !== target.portal_origin ||
    isIP(bindAddress) !== 4
  )
    throw new Error("academy_runtime_handoff_target");
  requireHandoffParent(root);
  const receipt = {
    version: 1,
    installation_id: identity.installation_id,
    source_revision: target.source_revision,
    handoff_sha256: sha256,
    bind_address: bindAddress,
  };
  try {
    initializeAcademyRuntime(options, receipt);
    return "initialized";
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const directory = lstatSync(root);
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid() ||
      (directory.mode & 0o077) !== 0 ||
      !isDeepStrictEqual(
        JSON.parse(readRuntimeHandoffFile(join(root, "runtime-handoff.json"))),
        receipt,
      ) ||
      !isDeepStrictEqual(
        JSON.parse(readRuntimeHandoffFile(join(root, "installation.json"))),
        identity,
      )
    )
      throw new Error("academy_runtime_handoff_existing_target", {
        cause: error,
      });
    for (const name of [
      "runtime.env",
      "runtime.env.public.env",
      "runtime.env.notification.env",
    ]) {
      const file = lstatSync(join(root, name));
      if (
        !file.isFile() ||
        file.nlink !== 1 ||
        file.uid !== process.getuid() ||
        (file.mode & 0o077) !== 0
      )
        throw new Error("academy_runtime_handoff_existing_target", {
          cause: error,
        });
    }
    for (const path of [
      identity.data_directory,
      identity.backup_directory,
      identity.browser_directory,
    ]) {
      const child = lstatSync(path);
      if (
        !child.isDirectory() ||
        child.uid !== process.getuid() ||
        (child.mode & 0o077) !== 0
      )
        throw new Error("academy_runtime_handoff_existing_target", {
          cause: error,
        });
    }
    return "already-initialized";
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === "from-handoff") {
      const [, root, handoff, trustedKey, bindAddress] = args;
      if (args.length !== 5) throw new Error("academy_runtime_arguments");
      const status = initializeAcademyRuntimeFromHandoff({
        root,
        handoff,
        trustedKey,
        bindAddress,
      });
      console.log(JSON.stringify({ status }));
    } else {
      const [root, installationId, edition, portalOrigin, bindAddress] = args;
      if (args.length !== 5) throw new Error("academy_runtime_arguments");
      initializeAcademyRuntime({
        root,
        installationId,
        edition,
        portalOrigin,
        bindAddress,
      });
      console.log(
        "Created private configuration for an empty academy runtime.",
      );
    }
  } catch {
    console.error(
      process.argv[2] === "from-handoff"
        ? "Could not initialize the academy runtime. Verify the explicitly selected absolute directory, signed handoff, trusted public key and local IPv4 bind address."
        : "Could not initialize the academy runtime. Provide a new absolute directory, installation UUID, dedicated edition, HTTPS domain and IPv4 bind address.",
    );
    process.exitCode = 1;
  }
}
