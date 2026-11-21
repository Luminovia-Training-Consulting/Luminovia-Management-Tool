/** Review and register an offline customer academy draft. No remote side effects. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  realpath,
  rename,
  rmdir,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  academyBrandColor,
  academyBrandName,
  academyBrandShortName,
} from "../src/features/branding/academy-branding-schema.ts";
import { describeAcademyRuntime } from "./academy-runtime-config.mjs";
import { readAcademyOperatorInput } from "./academy-staging-plan.mjs";

const checkout = fileURLToPath(new URL("../", import.meta.url)).replace(
  /\/$/,
  "",
);
const reservedRoots = [
  "/opt/luminovia-portal",
  "/var/backups/luminovia-complete",
];
const registryFile = "approved-drafts.json";
const lockFile = ".academy-drafts.lock";
const maxRegistryBytes = 4 * 1024 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const inside = (candidate, parent) =>
  candidate === parent || candidate.startsWith(parent + "/");
const overlaps = (a, b) => inside(a, b) || inside(b, a);

const privateLabel = (length) =>
  z
    .string()
    .trim()
    .min(1)
    .max(length)
    .regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]+$/u);
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/);
const email = z.email().max(254).toLowerCase();
const origin = z
  .string()
  .max(261)
  .toLowerCase()
  .regex(/^https:\/\/(?:[a-z0-9][a-z0-9-]*\.)+[a-z0-9][a-z0-9-]*\/?$/)
  .transform((value) => new URL(value).origin);
const timeZone = z
  .string()
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  });
const localHostname =
  /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/;
const fixtureHostname = /(?:^|\.)example\.(?:com|org|net)$/;
const vendorHostname = /(?:^|\.)luminovia\.org$/;

const draftSchema = z
  .strictObject({
    version: z.literal(1),
    request_id: z.uuidv4().toLowerCase(),
    purpose: z.enum(["customer", "rehearsal"]),
    legal_customer_name: privateLabel(120),
    branding: z.strictObject({
      name: academyBrandName,
      short_name: academyBrandShortName,
      theme: z.enum(["light", "dark", "system"]),
      theme_color: academyBrandColor.toLowerCase(),
      approved_assets_reference: reference,
    }),
    initial_administrator: z.strictObject({
      email,
      username: z
        .string()
        .regex(/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/)
        .nullish()
        .transform((name) => name ?? null),
    }),
    target: z.strictObject({
      edition: z.enum(["customer-self-hosted", "customer-managed"]),
      portal_origin: origin,
      domain_status: z.enum(["verified-by-operator", "temporary-pending"]),
      runtime_directory: z
        .string()
        .max(240)
        .regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/),
      host_reference: reference,
      data_region: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/),
      tls: z.enum(["acme", "operator-terminated"]),
    }),
    preferences: z.strictObject({
      locale: z.enum(["de", "en"]),
      time_zone: timeZone,
    }),
    smtp_mode: z.enum(["capture", "provider"]),
    backup_retention_days: z.int().positive(),
    support: z.strictObject({
      agreement_reference: reference,
      contact_email: email,
    }),
    licence: z.strictObject({
      release_commit: z
        .string()
        .regex(/^[a-f0-9]{40}$/)
        .refine((value) => /[1-9a-f]/.test(value)),
      limits: z.strictObject({
        seat_count: z.int().positive(),
        storage_bytes: z.int().positive(),
        api_requests_per_minute: z.int().positive().max(0xffff_ffff),
      }),
    }),
  })
  .superRefine((draft, state) => {
    const host = new URL(draft.target.portal_origin).hostname;
    if (
      vendorHostname.test(host) ||
      (draft.purpose === "customer" &&
        (localHostname.test(host) || fixtureHostname.test(host)))
    ) {
      state.addIssue({
        code: "custom",
        path: ["target", "portal_origin"],
        message: "Invalid academy domain",
      });
    }
    const directory = draft.target.runtime_directory;
    if (reservedRoots.some((root) => overlaps(directory, root))) {
      state.addIssue({
        code: "custom",
        path: ["target", "runtime_directory"],
        message: "Reserved installation path",
      });
    }
  });

const receiptSchema = z.strictObject({
  version: z.literal(1),
  status: z.literal("approved-draft"),
  installation_id: z.uuid(),
  approval_sha256: digestSchema,
  approved_at: z.iso.datetime(),
  draft: draftSchema,
});
const registrySchema = z.strictObject({
  version: z.literal(1),
  drafts: z.array(receiptSchema),
});

/** A random request ID fixes the installation UUID across previews and retry. */
function installationId(requestId) {
  const bytes = createHash("sha256")
    .update("Luminovia Academy Draft Identity v1\n" + requestId)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytes
    .toString("hex")
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.+)$/, "$1-$2-$3-$4-$5");
}

const approvalHash = (draft) =>
  createHash("sha256")
    .update("Luminovia Academy Draft Approval v1\n" + JSON.stringify(draft))
    .digest("hex");

function parseDraft(input) {
  const result = draftSchema.safeParse(input);
  if (!result.success) {
    const fields = [
      ...new Set(
        result.error.issues.map(({ path }) => path.join(".") || "draft"),
      ),
    ];
    throw new Error("Invalid draft fields: " + fields.join(", "));
  }
  return result.data;
}

/** Canonical private input and exact downstream targets, with no generated secrets. */
export function planCustomerAcademyDraft(input) {
  const draft = parseDraft(input);
  const id = installationId(draft.request_id);
  let runtime;
  try {
    runtime = describeAcademyRuntime({
      root: draft.target.runtime_directory,
      installationId: id,
      edition: draft.target.edition,
      portalOrigin: draft.target.portal_origin,
    });
  } catch {
    throw new Error(
      "Invalid draft fields: target.portal_origin, target.runtime_directory",
    );
  }
  return {
    draft,
    runtime,
    unsigned_licence_selection: {
      installation_id: id,
      edition: draft.target.edition,
      release_commit: draft.licence.release_commit,
      modules: ["lms"],
      limits: draft.licence.limits,
    },
    approval_sha256: approvalHash(draft),
  };
}

function privateOwner(stat) {
  return stat.uid === process.getuid() && (stat.mode & 0o077) === 0;
}

async function requireRegistryRoot(root) {
  if (
    !isAbsolute(root ?? "") ||
    root !== resolve(root) ||
    (await realpath(root)) !== root ||
    inside(root, checkout) ||
    reservedRoots.some((reserved) => overlaps(root, reserved))
  ) {
    throw new Error(
      "Use a private registry directory outside the checkout and runtime.",
    );
  }
  const stat = await lstat(root);
  if (!stat.isDirectory() || !privateOwner(stat))
    throw new Error(
      "The registry directory must be private to the current operator.",
    );
}

async function readPrivateJson(path, maxBytes) {
  if (
    !isAbsolute(path ?? "") ||
    path !== resolve(path) ||
    (await realpath(path)) !== path ||
    inside(path, checkout)
  )
    throw new Error("Use an absolute private input outside the checkout.");
  const before = await lstat(path);
  if (!before.isFile() || !privateOwner(before) || before.nlink !== 1)
    throw new Error("The input file must be private to the current operator.");
  const bytes = await readAcademyOperatorInput(path, maxBytes);
  const after = await lstat(path);
  if (
    before.ino !== after.ino ||
    before.dev !== after.dev ||
    before.ctimeMs !== after.ctimeMs
  )
    throw new Error("The private input changed while it was being read.");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("The private input is not valid UTF-8 JSON.");
  }
}

async function readRegistry(root) {
  let record;
  try {
    record = await readPrivateJson(join(root, registryFile), maxRegistryBytes);
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, drafts: [] };
    throw error;
  }
  const parsed = registrySchema.safeParse(record);
  if (!parsed.success)
    throw new Error("The private draft registry does not match its schema.");
  const { data } = parsed;
  const domains = new Set(),
    targets = new Map(),
    requests = new Set();
  for (const receipt of data.drafts) {
    const { draft } = receipt;
    const hostPaths = targets.get(draft.target.host_reference) ?? [];
    if (
      receipt.installation_id !== installationId(draft.request_id) ||
      receipt.approval_sha256 !== approvalHash(draft) ||
      requests.has(draft.request_id) ||
      domains.has(draft.target.portal_origin) ||
      hostPaths.some((directory) =>
        overlaps(directory, draft.target.runtime_directory),
      )
    ) {
      throw new Error(
        "The private draft registry has conflicting or modified receipts.",
      );
    }
    requests.add(draft.request_id);
    domains.add(draft.target.portal_origin);
    targets.set(draft.target.host_reference, [
      ...hostPaths,
      draft.target.runtime_directory,
    ]);
  }
  return data;
}

function existingReceipt(registry, plan) {
  const { draft } = plan;
  const existing = registry.drafts.find(
    (item) => item.draft.request_id === draft.request_id,
  );
  if (existing && existing.approval_sha256 !== plan.approval_sha256)
    throw new Error("This request already has a different approved draft.");
  if (
    !existing &&
    registry.drafts.some(
      ({ draft: approved }) =>
        approved.target.portal_origin === draft.target.portal_origin ||
        (approved.target.host_reference === draft.target.host_reference &&
          overlaps(
            approved.target.runtime_directory,
            draft.target.runtime_directory,
          )),
    )
  )
    throw new Error(
      "The domain or host runtime directory belongs to another approved draft.",
    );
  return existing;
}

async function loadPlan(root, sourcePath) {
  await requireRegistryRoot(root);
  if ([join(root, registryFile), join(root, lockFile)].includes(sourcePath))
    throw new Error("Choose a separate private draft input.");
  const plan = planCustomerAcademyDraft(await readPrivateJson(sourcePath));
  if (overlaps(root, plan.draft.target.runtime_directory))
    throw new Error(
      "Choose a runtime directory separate from the draft registry.",
    );
  return plan;
}

export async function previewCustomerAcademyDraft(root, sourcePath) {
  const plan = await loadPlan(root, sourcePath);
  const receipt = existingReceipt(await readRegistry(root), plan);
  return { ...plan, status: receipt ? "approved-draft" : "preview" };
}

async function withRegistryLock(root, operation) {
  // Linux flock holds the lock on the inherited open file description until
  // this process closes it. A lost process cannot leave a stuck approval.
  const file = await open(
    join(root, lockFile),
    constants.O_CREAT |
      constants.O_RDWR |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  try {
    const stat = await file.stat();
    if (!stat.isFile() || !privateOwner(stat) || stat.nlink !== 1)
      throw new Error("The registry lock is not an operator-private file.");
    const lock = spawn("flock", ["--exclusive", "--timeout", "5", "3"], {
      stdio: ["ignore", "ignore", "ignore", file.fd],
      timeout: 7000,
    });
    const [status] = await once(lock, "close");
    if (status !== 0)
      throw new Error(
        "Could not lock the draft registry. Retry when it is available.",
      );
    return await operation();
  } finally {
    await file.close();
  }
}

async function writeRegistry(root, registry) {
  const bytes = JSON.stringify(registry, null, 2) + "\n";
  if (Buffer.byteLength(bytes) > maxRegistryBytes)
    throw new Error("The private draft registry is full.");
  const temporary = await mkdtemp(join(root, ".academy-draft-"));
  const staged = join(temporary, "draft.json");
  try {
    const file = await open(staged, "wx", 0o600);
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(staged, join(root, registryFile));
    const directory = await open(
      root,
      constants.O_DIRECTORY | constants.O_RDONLY,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(staged).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rmdir(temporary);
  }
}

export async function approveCustomerAcademyDraft(root, sourcePath, approval) {
  const plan = await loadPlan(root, sourcePath);
  if (approval !== "APPROVE " + plan.approval_sha256)
    throw new Error("Approval does not match this draft. Preview it again.");
  return withRegistryLock(root, async () => {
    const registry = await readRegistry(root);
    const existing = existingReceipt(registry, plan);
    if (existing) return { receipt: existing, created: false };
    const receipt = {
      version: 1,
      status: "approved-draft",
      installation_id: plan.runtime.installation_id,
      approval_sha256: plan.approval_sha256,
      approved_at: new Date().toISOString(),
      draft: plan.draft,
    };
    await writeRegistry(root, {
      ...registry,
      drafts: [...registry.drafts, receipt],
    });
    return { receipt, created: true };
  });
}

function publicReview(plan) {
  const { draft, runtime, approval_sha256 } = plan;
  // Keep customer names and addresses in the operator's private input and
  // receipt. The output supplies the particulars needed to verify the target.
  return {
    status: plan.status,
    request_id: draft.request_id,
    installation_id: runtime.installation_id,
    purpose: draft.purpose,
    edition: runtime.edition,
    portal_origin: runtime.portal_origin,
    domain_status: draft.target.domain_status,
    locale: draft.preferences.locale,
    time_zone: draft.preferences.time_zone,
    theme: draft.branding.theme,
    data_region: draft.target.data_region,
    tls: draft.target.tls,
    smtp_mode: draft.smtp_mode,
    backup_retention_days: draft.backup_retention_days,
    licensed_limits: draft.licence.limits,
    release_commit: draft.licence.release_commit,
    approval: "APPROVE " + approval_sha256,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [command, root, source, approval, ...rest] = process.argv.slice(2);
    if (
      rest.length ||
      !root ||
      !source ||
      !(
        (command === "preview" && approval === undefined) ||
        (command === "approve" && approval !== undefined)
      )
    ) {
      throw new Error(
        "Usage: node scripts/academy-customer-draft.mjs preview|approve PRIVATE_REGISTRY PRIVATE_DRAFT [APPROVAL]",
      );
    }
    if (command === "preview") {
      console.log(
        JSON.stringify(
          publicReview(await previewCustomerAcademyDraft(root, source)),
          null,
          2,
        ),
      );
    } else {
      const { receipt, created } = await approveCustomerAcademyDraft(
        root,
        source,
        approval,
      );
      console.log(
        JSON.stringify(
          {
            status: receipt.status,
            installation_id: receipt.installation_id,
            created,
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    // Application errors contain fixed copy or schema-owned field labels.
    // OS errors can contain absolute private paths and are never printed.
    console.error(
      error?.code
        ? "Could not open or update the private draft files."
        : error.message,
    );
    process.exitCode = 1;
  }
}
