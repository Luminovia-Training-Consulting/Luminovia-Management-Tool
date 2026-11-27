/** Read-only operational witness for one dedicated Academy installation. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isIPv4 } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { z } from "zod";
import {
  academyDatabaseComposeArguments,
  readAcademyInstallationStatus,
} from "./academy-installation.mjs";
import { verifyAcademyLicence } from "./academy-licence.mjs";
import {
  academyMigrationInventory,
  loadAcademyMigrations,
} from "./academy-migrations.mjs";
import { readRuntimeHandoffFile } from "./academy-runtime-handoff.mjs";
import { readAcademyOperatorInput } from "./academy-staging-plan.mjs";

const privateServices = [
  "db",
  "auth",
  "rest",
  "realtime",
  "storage",
  "functions",
  "api-gw",
  "mail-relay",
];
const ingressServices = ["api-ingress", "web"];
const optionalServices = ["mailpit", "notification-mail"];
const hour = 3_600_000;
const ageHeader = Buffer.from("age-encryption.org/v1\n");
const digest = /^[a-f0-9]{64}$/;
const backupReceiptSchema = z.strictObject({
  installation_id: z.uuid(),
  release: z.string().regex(/^[a-f0-9]{40}$/),
  bundle: z.string().max(400),
  sha256: z.string().regex(digest),
});
// Deliberately project a small subset. Raw inspect also contains environment
// values and recent healthcheck output, neither of which belongs here.
// Report only whether the exact file-validation setting is enabled.
const inspectFormat = `{"id":{{json .Id}},
  "project":{{json (index .Config.Labels "com.docker.compose.project")}},
  "service":{{json (index .Config.Labels "com.docker.compose.service")}},
  "image":{{json .Config.Image}},"status":{{json .State.Status}},
  "health":{{with index .State "Health"}}{{json .Status}}{{else}}null{{end}},
  "networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}},
  "mounts":{{json .Mounts}},
  "formatOnly":{{ $enabled := false }}{{ range .Config.Env }}{{ if eq . "PORTAL_ACADEMY_FILE_VALIDATION=format-only" }}{{ $enabled = true }}{{ end }}{{ end }}{{ json $enabled }}}`.replaceAll(
  "\n",
  " ",
);

function runDocker(args, input) {
  const result = spawnSync(
    "docker",
    ["--host=unix:///var/run/docker.sock", ...args],
    {
      input,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH },
    },
  );
  if (result.status !== 0) throw new Error("academy_health_docker");
  return result.stdout.trim();
}

function mountsExpectedPath(record, destination, source, writable) {
  const matching = record.mounts.filter(
    (mount) => mount.Destination === destination,
  );
  return (
    matching.length === 1 &&
    matching[0].Type === "bind" &&
    matching[0].Source === source &&
    matching[0].RW === writable
  );
}

function serviceState(records, service, context) {
  const entries = records.filter((record) => record.service === service);
  if (!entries.length) return "missing";
  if (entries.length !== 1) return "ownership_mismatch";
  const [record] = entries;
  if (
    record.project !== context.project ||
    !digest.test(record.id) ||
    !/@sha256:[a-f0-9]{64}$/.test(record.image)
  )
    return "ownership_mismatch";
  if (record.status !== "running") return "stopped";

  if (
    Object.keys(record.networks ?? {}).join() !== `${context.project}-backend`
  )
    return "ownership_mismatch";
  const published = Object.entries(record.ports ?? {}).filter(
    ([, bindings]) => bindings?.length,
  );
  if (service === "web") {
    if (
      !isIPv4(context.bindAddress) ||
      published.length !== 2 ||
      ["80", "443"].some(
        (port) =>
          !published.some(
            ([key, bindings]) =>
              key === `${port}/tcp` &&
              bindings.length === 1 &&
              bindings[0].HostIp === context.bindAddress &&
              bindings[0].HostPort === port,
          ),
      )
    )
      return "ownership_mismatch";
  } else if (published.length) return "ownership_mismatch";
  const mount = context.boundMounts[service];
  if (mount && !mountsExpectedPath(record, ...mount))
    return "ownership_mismatch";

  // The ingress pair has no Docker HEALTHCHECK. Its running state is only
  // a process witness; backend services must report healthy.
  if (ingressServices.includes(service) || service === "notification-mail")
    return "running";
  return record.health === "healthy" ? "healthy" : "unhealthy";
}

async function backupState(
  root,
  expected,
  { backupReceipt, maxBackupAgeHours, verifyBackup },
  now,
) {
  if (!backupReceipt) return { state: "not_configured" };
  let receipt;
  try {
    receipt = backupReceiptSchema.parse(
      JSON.parse(readRuntimeHandoffFile(backupReceipt)),
    );
  } catch {
    return { state: "invalid_receipt" };
  }
  if (
    receipt.installation_id !== expected.installation_id ||
    receipt.release !== expected.release_commit
  )
    return { state: "target_mismatch" };

  const backupRoot = join(root, "backups");
  if (
    dirname(receipt.bundle) !== backupRoot ||
    !/^recovery-[a-f0-9]{32}\.tar\.gz\.age$/.test(
      receipt.bundle.slice(backupRoot.length + 1),
    )
  )
    return { state: "invalid_receipt" };
  try {
    if ((await realpath(backupRoot)) !== backupRoot)
      return { state: "archive_unavailable" };
    const file = await open(
      receipt.bundle,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const before = await file.stat({ bigint: true });
      if (
        !before.isFile() ||
        before.nlink !== 1n ||
        (before.mode & 0o077n) !== 0n ||
        before.uid !== BigInt(process.getuid())
      )
        return { state: "archive_unavailable" };
      const header = Buffer.alloc(ageHeader.length);
      if (
        (await file.read(header, 0, header.length, 0)).bytesRead !==
          header.length ||
        !header.equals(ageHeader) ||
        before.size <= BigInt(header.length)
      )
        return { state: "invalid_archive" };
      const age = now - Number(before.mtimeMs);
      if (age < 0) return { state: "invalid_time" };
      const ageMinutes = Math.floor(age / 60_000);
      if (age > maxBackupAgeHours * hour)
        return { state: "stale", age_minutes: ageMinutes };
      if (verifyBackup) {
        const hash = createHash("sha256");
        for await (const chunk of file.createReadStream({
          start: 0,
          autoClose: false,
        }))
          hash.update(chunk);
        if (hash.digest("hex") !== receipt.sha256)
          return { state: "digest_mismatch" };
      }
      const after = await file.stat({ bigint: true });
      if (after.mtimeNs !== before.mtimeNs || after.ctimeNs !== before.ctimeNs)
        return { state: "archive_changed" };
      return {
        state: "fresh",
        age_minutes: ageMinutes,
        digest_verified: verifyBackup,
      };
    } finally {
      await file.close();
    }
  } catch {
    return { state: "archive_unavailable" };
  }
}

function quotaCapacity(used, limit) {
  if (!Number.isSafeInteger(used) || used < 0)
    return { state: "unavailable", used: null, limit };
  const state =
    used < limit
      ? "available"
      : used === limit
        ? "at_capacity"
        : "over_capacity";
  return { state, used, limit };
}

export async function monitorAcademy(
  {
    root,
    envelope,
    publicKey,
    expected,
    backupReceipt,
    maxBackupAgeHours = 24,
    verifyBackup = false,
    expectIngress = false,
    now = Date.now(),
  },
  docker = runDocker,
) {
  if (
    !Number.isInteger(maxBackupAgeHours) ||
    maxBackupAgeHours < 1 ||
    maxBackupAgeHours > 8760 ||
    !Number.isFinite(now)
  )
    throw new Error("academy_health_input");
  const licence = verifyAcademyLicence(envelope, publicKey, expected, now);
  // Reuse the staged identity and private runtime verification. Execute only
  // against the owned container ID from the explicitly local Docker socket.
  await academyDatabaseComposeArguments(root, expected, { allowRoot: true });
  const context = {
    project: `academy-${expected.installation_id.replaceAll("-", "")}`,
    bindAddress: parseEnv(
      (await readAcademyOperatorInput(join(root, "runtime.env"))).toString(),
    ).ACADEMY_BIND_ADDRESS,
    boundMounts: {
      db: ["/var/lib/postgresql/data", join(root, "data/postgres"), true],
      storage: ["/var/lib/storage", join(root, "data/storage"), true],
      web: ["/srv", join(root, "browser"), false],
      "api-ingress": [
        "/etc/envoy/academy-ingress.yml",
        join(root, "browser/api-ingress.yml"),
        false,
      ],
    },
  };
  const receipt = JSON.parse(
    (
      await readAcademyOperatorInput(join(root, "browser/release.json"))
    ).toString(),
  );
  const stagedLicence = !Object.hasOwn(receipt, "licence")
    ? "legacy_metadata"
    : receipt.licence?.sha256 ===
        createHash("sha256").update(envelope).digest("hex")
      ? "matched"
      : "target_mismatch";
  const ids = docker([
    "ps",
    "--all",
    "--quiet",
    "--no-trunc",
    "--filter",
    `label=com.docker.compose.project=${context.project}`,
  ])
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.every((id) => digest.test(id)))
    throw new Error("academy_health_docker");
  const records = ids.length
    ? docker([
        "inspect",
        "--type",
        "container",
        "--format",
        inspectFormat,
        ...ids,
      ])
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
  if (
    records.length !== ids.length ||
    ids.some((id) => records.filter((row) => row.id === id).length !== 1)
  )
    throw new Error("academy_health_docker");

  const availableOptionalServices = optionalServices.filter((service) =>
    records.some((row) => row.service === service),
  );
  const ingressExpected =
    expectIngress ||
    records.some(
      (row) =>
        ingressServices.includes(row.service) && row.status === "running",
    );
  const watched = [
    ...privateServices,
    ...availableOptionalServices,
    ...(ingressExpected ? ingressServices : []),
  ];
  const services = Object.fromEntries(
    watched.map((service) => [
      service,
      serviceState(records, service, context),
    ]),
  );
  const expectedServices = [
    ...privateServices,
    ...ingressServices,
    ...optionalServices,
  ];
  // Optional profiles may be stopped, but an observed ownership or network
  // violation must degrade the whole installation even in those profiles.
  const topology =
    records.every(
      (record) =>
        expectedServices.includes(record.service) &&
        record.project === context.project,
    ) && !Object.values(services).includes("ownership_mismatch")
      ? "recognised"
      : "ownership_mismatch";
  const limits = licence.terms.limits;
  let quotas = {
    seats: quotaCapacity(null, limits.seat_count),
    storage: quotaCapacity(null, limits.storage_bytes),
    api_requests_per_minute: limits.api_requests_per_minute,
  };
  let database = {
    state: "unavailable",
    migration_ledger: null,
    course_access: null,
  };
  if (services.db === "healthy") {
    try {
      const db = records.find((record) => record.service === "db").id;
      const current = await readAcademyInstallationStatus(
        {
          envelope,
          publicKey,
          expected,
          now,
          requireExactLicence: true,
          operationalInventory: true,
        },
        (sql) =>
          docker(
            [
              "exec",
              "-i",
              db,
              "psql",
              "-U",
              "postgres",
              "-d",
              "postgres",
              "-X",
              "-qAt",
              "-v",
              "ON_ERROR_STOP=1",
              "-f",
              "-",
            ],
            sql,
          ),
      );
      const databaseLicenceState =
        current.licence_status === "scheduled"
          ? "not-yet-valid"
          : current.licence_status;
      if (
        current.installation_id !== expected.installation_id ||
        current.edition !== expected.edition ||
        current.release_commit !== expected.release_commit ||
        databaseLicenceState !== licence.state
      )
        throw new Error("academy_status_target_mismatch");
      const ledger = current.migration_ledger;
      const complete =
        Number.isSafeInteger(ledger?.count) &&
        ledger.count > 0 &&
        typeof ledger.last_version === "string" &&
        /^[0-9]{14}$/.test(ledger.last_version);
      const expectedLedger = academyMigrationInventory(
        await loadAcademyMigrations(),
      );
      const ledgerState = !complete
        ? "missing_ledger"
        : ledger.count === expectedLedger.count &&
            ledger.last_version === expectedLedger.last_version &&
            ledger.sha256 === expectedLedger.sha256
          ? "verified"
          : "ledger_mismatch";
      quotas = {
        ...quotas,
        seats: quotaCapacity(
          current.quota_usage?.occupied_seats,
          limits.seat_count,
        ),
        storage: quotaCapacity(
          current.quota_usage?.used_storage_bytes,
          limits.storage_bytes,
        ),
      };
      const access = ["active", "grace"].includes(current.course_access_status)
        ? current.course_access_status
        : null;
      database = {
        state: ledgerState,
        migration_ledger: complete
          ? { count: ledger.count, last_version: ledger.last_version }
          : null,
        course_access: access,
      };
    } catch (error) {
      if (error.message === "academy_status_target_mismatch")
        database.state = "target_mismatch";
    }
  }
  const fileValidation =
    services.functions === "healthy" &&
    records.find((record) => record.service === "functions")?.formatOnly ===
      true
      ? "format-only"
      : "unverified";
  const backup = await backupState(
    root,
    expected,
    { backupReceipt, maxBackupAgeHours, verifyBackup },
    now,
  );
  const healthy =
    stagedLicence !== "target_mismatch" &&
    licence.state === "active" &&
    database.state === "verified" &&
    database.course_access === "active" &&
    quotas.seats.state === "available" &&
    quotas.storage.state === "available" &&
    fileValidation === "format-only" &&
    backup.state === "fresh" &&
    topology === "recognised" &&
    watched
      .filter((service) => !optionalServices.includes(service))
      .every(
        (service) =>
          services[service] === "running" || services[service] === "healthy",
      );
  return {
    version: 1,
    status: healthy ? "healthy" : "degraded",
    checked_at: new Date(now).toISOString(),
    installation_id: expected.installation_id,
    edition: expected.edition,
    release_commit: expected.release_commit,
    licence_status: licence.state,
    staged_licence: stagedLicence,
    topology,
    services,
    database,
    quotas,
    file_validation: fileValidation,
    backup,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  try {
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        "backup-receipt": { type: "string" },
        "max-backup-age-hours": { type: "string", default: "24" },
        "verify-backup": { type: "boolean" },
        "expect-ingress": { type: "boolean" },
      },
    });
    if (
      positionals.length !== 6 ||
      !/^\d{1,4}$/.test(values["max-backup-age-hours"])
    )
      throw new Error("academy_health_input");
    const [
      root,
      licenceFile,
      keyFile,
      installation_id,
      edition,
      release_commit,
    ] = positionals;
    const result = await monitorAcademy({
      root,
      envelope: readRuntimeHandoffFile(licenceFile).toString().trim(),
      publicKey: readRuntimeHandoffFile(keyFile, false),
      expected: { installation_id, edition, release_commit },
      backupReceipt: values["backup-receipt"],
      maxBackupAgeHours: Number(values["max-backup-age-hours"]),
      verifyBackup: values["verify-backup"],
      expectIngress: values["expect-ingress"],
    });
    console.log(JSON.stringify(result));
    if (result.status !== "healthy") process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({ version: 1, status: "unavailable" }));
    console.error(
      "Academy health unavailable. Check the local Docker socket, installation and release, signed licence and operator input.",
    );
    process.exitCode = 2;
  }
}
