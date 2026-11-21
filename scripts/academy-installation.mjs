/**
 * Operator entry point for preparing the database of a dedicated academy.
 * Its only write is the atomic, idempotent identity/licence setup. The reported
 * bootstrap state comes back from the migrated database, not from the CLI.
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { verifyAcademyLicence } from "./academy-licence.mjs";

const sqlText = (value) => "'" + String(value).replaceAll("'", "''") + "'";

/** Forward only verified terms and confirm that the database accepted the same installation. */
export async function prepareAcademyInstallation(
  { envelope, publicKey, expected, now },
  executeSql,
) {
  const { state, terms } = verifyAcademyLicence(
    envelope,
    publicKey,
    expected,
    now,
  );
  if (state !== "active") throw new Error("academy_licence_is_not_active");
  const result = await executeSql(`
    begin;
    select private.provision_customer_installation(${sqlText(terms.installation_id)}::uuid,${sqlText(terms.edition)});
    select private.apply_verified_installation_licence(${sqlText(JSON.stringify(terms))}::jsonb);
    select public.installation_capabilities();
    commit;
  `);
  const current = JSON.parse(result.trim());
  if (
    current.installation_id !== terms.installation_id ||
    current.edition !== terms.edition ||
    current.licence_status !== "active" ||
    typeof current.customer_ready !== "boolean"
  )
    throw new Error("academy_installation_confirmation_failed");
  return current;
}

/** Use an explicit libpq service or host/database so psql cannot default to an unrelated DB. */
function operatorSql(sql) {
  if (!process.env.PGSERVICE && !(process.env.PGHOST && process.env.PGDATABASE))
    throw new Error("academy_database_connection_required");
  const result = spawnSync(
    "psql",
    ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    {
      input: sql,
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 65536,
    },
  );
  if (result.status !== 0)
    throw new Error("academy_installation_database_rejected");
  return result.stdout;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [licence, key, installationId, edition, release, ...extra] =
      process.argv.slice(2);
    if (
      !licence ||
      !key ||
      !installationId ||
      !edition ||
      !release ||
      extra.length
    )
      throw new Error("academy_installation_usage");
    const [envelope, publicKey] = await Promise.all([
      readFile(licence, "utf8"),
      readFile(key),
    ]);
    const result = await prepareAcademyInstallation(
      {
        envelope: envelope.trim(),
        publicKey,
        expected: {
          installation_id: installationId,
          edition,
          release_commit: release,
        },
      },
      operatorSql,
    );
    console.log(JSON.stringify(result));
  } catch {
    console.error(
      "Academy database preparation was not confirmed. Check the trusted licence, target connection and dedicated database.",
    );
    process.exitCode = 1;
  }
}
