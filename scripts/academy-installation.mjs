/**
 * Operator entry point for preparing the database of a dedicated academy.
 * Preparation pins identity/licence. An explicit optional Auth account can be
 * confirmed as the first administrator once the dedicated instance is prepared.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { requireStoppedAcademyIngress } from "./academy-install-browser.mjs";
import { verifyAcademyLicence } from "./academy-licence.mjs";
import {
  academyMigrationsScript,
  loadAcademyMigrations,
} from "./academy-migrations.mjs";
import { readAcademyOperatorInput } from "./academy-staging-plan.mjs";

import {
  academyBrandColor,
  academyBrandName,
  academyBrandShortName,
} from "../src/features/branding/academy-branding-schema.ts";

const sqlText = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const authIdPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function requirePrivateAcademyRuntime(root) {
  if (!isAbsolute(root ?? "") || realpathSync(root) !== root)
    throw new Error("academy_database_runtime_path");
  const info = lstatSync(root);
  if (!info.isDirectory() || info.uid !== process.getuid() || info.mode & 0o077)
    throw new Error("academy_database_runtime_path");
}

/** Read only the staged local manifest after matching the private release receipt. */
export async function readStagedAcademyDocumentBrand(root, expected) {
  requirePrivateAcademyRuntime(root);
  const browser = join(root, "browser");
  const staged = join(browser, "current");
  if (realpathSync(staged) !== staged)
    throw new Error("academy_database_staged_manifest_path");
  const receiptPath = join(browser, "release.json");
  const first = await readAcademyOperatorInput(receiptPath);
  const { release, brand_manifest_sha256: hash } = JSON.parse(
    first.toString("utf8"),
  );
  if (
    release?.installation_id !== expected.installation_id ||
    release.edition !== expected.edition ||
    release.source_revision !== expected.release_commit
  )
    throw new Error("academy_database_runtime_release_mismatch");
  const bytes = await readAcademyOperatorInput(
    join(staged, "manifest.webmanifest"),
  );
  if (
    !first.equals(await readAcademyOperatorInput(receiptPath)) ||
    (hash !== undefined &&
      createHash("sha256").update(bytes).digest("hex") !== hash)
  )
    throw new Error("academy_database_staged_manifest_changed");
  const manifest = JSON.parse(bytes.toString("utf8"));
  return {
    name: academyBrandName.parse(manifest.name),
    short_name: academyBrandShortName.parse(manifest.short_name),
    theme_color: academyBrandColor.parse(manifest.theme_color).toLowerCase(),
  };
}

function pinPdfBrand(terms, brand) {
  if (!brand) return "";
  const name = academyBrandName.parse(brand.name);
  const shortName = academyBrandShortName.parse(brand.short_name);
  const color = academyBrandColor.parse(brand.theme_color);
  return `select private.pin_academy_pdf_release_brand(
    ${sqlText(terms.installation_id)}::uuid, ${sqlText(terms.release_commit)},
    ${sqlText(name)}, ${sqlText(shortName)}, ${sqlText(color)});`;
}

/** Forward only verified terms and confirm that the database accepted the same installation. */
export async function prepareAcademyInstallation(
  { envelope, publicKey, expected, now, firstAdministrator, releasePdfBrand },
  executeSql,
) {
  const { state, terms } = verifyAcademyLicence(
    envelope,
    publicKey,
    expected,
    now,
  );
  if (state !== "active") throw new Error("academy_licence_is_not_active");
  if (
    firstAdministrator !== undefined &&
    (typeof firstAdministrator !== "string" ||
      !authIdPattern.test(firstAdministrator))
  )
    throw new Error("academy_first_administrator_id_invalid");
  const adminId = firstAdministrator?.toLowerCase();
  const receipt = adminId
    ? ` || jsonb_build_object('first_administrator', private.bootstrap_academy_first_administrator(
        ${sqlText(terms.installation_id)}::uuid, ${sqlText(terms.release_commit)}, ${sqlText(adminId)}::uuid))`
    : "";
  const result = await executeSql(`
    begin;
    select private.provision_customer_installation(${sqlText(terms.installation_id)}::uuid,${sqlText(terms.edition)});
    select private.apply_verified_installation_licence(${sqlText(JSON.stringify(terms))}::jsonb);
    ${pinPdfBrand(terms, releasePdfBrand)}
    select public.installation_capabilities()${receipt};
    commit;
  `);
  const current = JSON.parse(result.trim());
  if (
    current.installation_id !== terms.installation_id ||
    current.edition !== terms.edition ||
    current.licence_status !== "active" ||
    typeof current.customer_ready !== "boolean" ||
    (adminId !== undefined && current.first_administrator !== adminId)
  )
    throw new Error("academy_installation_confirmation_failed");
  return current;
}

/** Return an operator's current release and licence inventory without taking write locks. */
export async function readAcademyInstallationStatus(
  { envelope, publicKey, expected, now },
  executeSql,
) {
  const { terms } = verifyAcademyLicence(envelope, publicKey, expected, now);
  const output = await executeSql(String.raw`
    begin read only;
    select to_regclass('supabase_migrations.schema_migrations') is not null
      as academy_has_ledger \gset
    \if :academy_has_ledger
    select jsonb_build_object('count',count(*),'last_version',max(version))
      as academy_ledger from supabase_migrations.schema_migrations \gset
    \else
    \set academy_ledger 'null'
    \endif
    select jsonb_build_object(
      'installation_id', capability.installation_id,
      'edition', capability.edition,
      'release_commit', licence.terms->>'release_commit',
      'licence_status', capability.licence_status,
      'licence_expires_at', licence.expires_at,
      'licence_grace_until', licence.grace_until,
      'course_access_status', private.academy_course_access_status(),
      'migration_ledger', :'academy_ledger'::jsonb
    )
    from public.installation_capability_state capability
    join private.installation_verified_licence licence using (installation_id)
    where capability.installation_id = ${sqlText(terms.installation_id)}::uuid
      and capability.edition = ${sqlText(terms.edition)}
      and licence.terms->>'release_commit' = ${sqlText(terms.release_commit)};
    commit;
  `);
  if (!output.trim()) throw new Error("academy_status_target_mismatch");
  return JSON.parse(output.trim());
}

/** Open or close only the course profile for a prepared, exact licensed release.
 * An expired signed licence remains sufficient to close its own profile.
 */
export async function configureAcademyCourseAccess(
  { envelope, publicKey, expected, now, enabled, releasePdfBrand },
  executeSql,
) {
  const { state, terms } = verifyAcademyLicence(
    envelope,
    publicKey,
    expected,
    now,
  );
  if (typeof enabled !== "boolean")
    throw new Error("academy_course_access_option_invalid");
  if (enabled && state !== "active")
    throw new Error("academy_licence_is_not_active");
  const installation = sqlText(terms.installation_id);
  const release = sqlText(terms.release_commit);
  const result = await executeSql(`
    begin;
    ${enabled ? pinPdfBrand(terms, releasePdfBrand) : ""}
    select private.configure_academy_course_access(${installation}::uuid, ${release}, ${enabled})
    from private.installation_identity
    where installation_id = ${installation}::uuid and edition = ${sqlText(terms.edition)};
    select jsonb_build_object(
      'installation_id', identity.installation_id,
      'edition', identity.edition,
      'release_commit', ${release}::text,
      'enabled', access.release_commit is not distinct from ${release}::text
    )
    from private.installation_identity identity
    left join private.academy_course_access access using (installation_id)
    where identity.singleton;
    commit;
  `);
  const current = JSON.parse(result.trim());
  if (
    current.installation_id !== terms.installation_id ||
    current.edition !== terms.edition ||
    current.release_commit !== terms.release_commit ||
    current.enabled !== enabled
  )
    throw new Error("academy_course_access_confirmation_failed");
  return current;
}

/** Pin the private Compose target to this generated runtime and staged release. */
export async function academyDatabaseComposeArguments(root, expected) {
  requirePrivateAcademyRuntime(root);
  const browser = join(root, "browser");
  if (realpathSync(browser) !== browser)
    throw new Error("academy_database_runtime_path");
  const [identityText, receiptText, environmentText] = await Promise.all(
    [
      join(root, "installation.json"),
      join(browser, "release.json"),
      join(root, "runtime.env"),
    ].map(async (path) =>
      (await readAcademyOperatorInput(path)).toString("utf8"),
    ),
  );
  const identity = JSON.parse(identityText);
  const receipt = JSON.parse(receiptText);
  const environment = parseEnv(environmentText);
  const project = "academy-" + expected.installation_id.replaceAll("-", "");
  if (
    identity.version !== 1 ||
    identity.installation_id !== expected.installation_id ||
    identity.edition !== expected.edition ||
    identity.compose_project !== project ||
    identity.browser_directory !== browser ||
    identity.data_directory !== join(root, "data") ||
    environment.COMPOSE_PROJECT_NAME !== project ||
    environment.ACADEMY_INSTALLATION_ID !== expected.installation_id ||
    environment.ACADEMY_EDITION !== expected.edition ||
    environment.PORTAL_BACKEND_NETWORK !== project + "-backend" ||
    environment.PORTAL_DATA_DIR !== identity.data_directory ||
    environment.PORTAL_WWW_DIR !== identity.browser_directory ||
    environment.POSTGRES_DB !== "postgres" ||
    receipt.version !== 1 ||
    receipt.state !== "browser-staged" ||
    receipt.release?.installation_id !== expected.installation_id ||
    receipt.release?.edition !== expected.edition ||
    receipt.release?.source_revision !== expected.release_commit
  )
    throw new Error("academy_database_runtime_release_mismatch");

  return [
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
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
  ];
}

/** Always use an explicit private libpq target or the staged Compose project. */
async function operatorSql(expected, timeout = 30000) {
  const root = process.env.PORTAL_ACADEMY_RUNTIME_ROOT;
  const privateLibpq =
    process.env.PGSERVICE || (process.env.PGHOST && process.env.PGDATABASE);
  if (Boolean(root) === Boolean(privateLibpq))
    throw new Error("academy_database_connection_required");
  const command = root ? "docker" : "psql";
  const target = root
    ? await academyDatabaseComposeArguments(root, expected)
    : [];
  return (sql) => {
    const result = spawnSync(
      command,
      [...target, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-"],
      {
        input: sql,
        encoding: "utf8",
        timeout,
        maxBuffer: 4 * 1024 * 1024,
        env: root ? { PATH: process.env.PATH } : process.env,
      },
    );
    if (result.status !== 0)
      throw new Error("academy_installation_database_rejected");
    return result.stdout;
  };
}

async function migrateAcademyInstallation(input) {
  if (!process.env.PORTAL_ACADEMY_RUNTIME_ROOT)
    throw new Error("academy_migration_requires_private_compose_runtime");
  const { state, terms } = verifyAcademyLicence(
    input.envelope,
    input.publicKey,
    input.expected,
  );
  if (state !== "active") throw new Error("academy_licence_is_not_active");
  const checkout = fileURLToPath(new URL("../", import.meta.url));
  const git = (args) => {
    const result = spawnSync("git", ["-C", checkout, ...args], {
      encoding: "utf8",
      timeout: 10000,
      env: { PATH: process.env.PATH },
    });
    if (result.status !== 0) throw new Error("academy_migration_checkout");
    return result.stdout.trim();
  };
  if (
    git(["rev-parse", "HEAD"]) !== terms.release_commit ||
    git([
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--",
      "supabase/migrations",
      "deploy/academy",
      "deploy/hostinger/selfhost",
      "scripts/academy-installation.mjs",
      "scripts/academy-migrations.mjs",
    ])
  )
    throw new Error("academy_migration_release_checkout");
  const migrations = await loadAcademyMigrations();
  const executeSql = await operatorSql(input.expected, 10 * 60 * 1000);
  requireStoppedAcademyIngress(
    process.env.PORTAL_ACADEMY_RUNTIME_ROOT,
    "academy-" + terms.installation_id.replaceAll("-", ""),
  );
  const output = executeSql(
    academyMigrationsScript({
      installationId: terms.installation_id,
      edition: terms.edition,
      migrations,
    }),
  );
  const receipt = JSON.parse(output.trim().split("\n").at(-1));
  if (
    receipt.migration_count !== migrations.length ||
    receipt.last_version !== migrations.at(-1).version
  )
    throw new Error("academy_migration_receipt");
  return receipt;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [licence, key, installationId, edition, release, ...extra] =
      process.argv.slice(2);
    const [option, value] = extra;
    const courseAccess = option === "--course-access";
    const migrations = option === "--migrate" && extra.length === 1;
    const status = option === "--status" && extra.length === 1;
    if (
      !licence ||
      !key ||
      !installationId ||
      !edition ||
      !release ||
      (extra.length > 0 &&
        !migrations &&
        !status &&
        (extra.length !== 2 ||
          (courseAccess
            ? !["on", "off"].includes(value)
            : option !== "--first-admin" || !value)))
    )
      throw new Error("academy_installation_usage");
    const [envelope, publicKey] = await Promise.all([
      readFile(licence, "utf8"),
      readFile(key),
    ]);
    const input = {
      envelope: envelope.trim(),
      publicKey,
      expected: {
        installation_id: installationId,
        edition,
        release_commit: release,
      },
    };
    let result;
    if (migrations) {
      result = await migrateAcademyInstallation(input);
    } else if (status) {
      result = await readAcademyInstallationStatus(
        input,
        await operatorSql(input.expected),
      );
    } else {
      const executeSql = await operatorSql(input.expected);
      const root =
        process.env.PORTAL_ACADEMY_RUNTIME_ROOT ??
        process.env.PORTAL_ACADEMY_STAGED_BROWSER_ROOT;
      const releasePdfBrand =
        root && (!courseAccess || value === "on")
          ? await readStagedAcademyDocumentBrand(root, input.expected)
          : undefined;
      result = courseAccess
        ? await configureAcademyCourseAccess(
            { ...input, enabled: value === "on", releasePdfBrand },
            executeSql,
          )
        : await prepareAcademyInstallation(
            { ...input, firstAdministrator: value, releasePdfBrand },
            executeSql,
          );
    }
    console.log(JSON.stringify(result));
  } catch (error) {
    const reason =
      /^(?:academy_migration_[a-z_]+|academy_install_ingress_must_be_stopped|academy_status_target_mismatch)$/.test(
        error?.message,
      )
        ? ` (${error.message})`
        : "";
    console.error(
      "Academy database preparation was not confirmed" +
        reason +
        ". Check the trusted licence, target connection and dedicated database.",
    );
    process.exitCode = 1;
  }
}
