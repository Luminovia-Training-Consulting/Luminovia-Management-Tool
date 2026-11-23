/** Review and register an offline customer academy draft. No remote side effects. */
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { constants } from "node:fs";
import {
  link,
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
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  academyCustomerDraftSchema as draftSchema,
  academyPathsOverlap as overlaps,
  academyReservedRoots as reservedRoots,
} from "../src/features/branding/academy-customer-draft-schema.ts";
import { describeAcademyRuntime } from "./academy-runtime-config.mjs";
import {
  readRuntimeHandoffFile,
  signAcademyRuntimeHandoff,
  verifyAcademyRuntimeHandoff,
} from "./academy-runtime-handoff.mjs";
import { readAcademyOperatorInput } from "./academy-staging-plan.mjs";
import {
  signAcademyLicence,
  verifyAcademyLicence,
} from "./academy-licence.mjs";
import {
  digestSchema,
  indexLicenceActions,
  licenceReceiptSchema,
  parseLicenceRequest,
  planLicenceAction,
  sha256,
} from "./academy-customer-licensing.mjs";
import {
  fulfilmentReceiptSchema,
  handoffTarget,
  indexFulfilments,
  parseFulfilmentRequest,
  planFulfilment,
} from "./academy-customer-fulfilment.mjs";

const checkout = fileURLToPath(new URL("../", import.meta.url)).replace(
  /\/$/,
  "",
);
const registryFile = "approved-drafts.json";
const lockFile = ".academy-drafts.lock";
const maxRegistryBytes = 4 * 1024 * 1024;
const inside = (candidate, parent) =>
  candidate === parent || candidate.startsWith(parent + "/");

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
  licences: z.array(licenceReceiptSchema).optional(),
  fulfilments: z.array(fulfilmentReceiptSchema).optional(),
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

async function readPrivateInput(path, maxBytes) {
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
  return bytes;
}

async function readPrivateJson(path, maxBytes) {
  const bytes = await readPrivateInput(path, maxBytes);
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

async function writePrivateFile(root, destination, bytes, replace = false) {
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
    if (replace) await rename(staged, destination);
    else await link(staged, destination);
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

async function writeRegistry(root, registry) {
  const bytes = JSON.stringify(registry, null, 2) + "\n";
  if (Buffer.byteLength(bytes) > maxRegistryBytes)
    throw new Error("The private draft registry is full.");
  await writePrivateFile(root, join(root, registryFile), bytes, true);
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

async function loadLicenceRequest(root, source) {
  await requireRegistryRoot(root);
  return parseLicenceRequest(await readPrivateJson(source, 16 * 1024));
}

function prepareLicenceAction(registry, request) {
  const { actions, drafts, latest, previousByAction, termsByAction } =
    indexLicenceActions(registry);
  const draft = drafts.get(request.draft_request_id);
  if (!draft)
    throw new Error("This licence request needs an approved academy draft.");
  const existing = actions.get(request.action_id);
  if (existing && !isDeepStrictEqual(existing.request, request))
    throw new Error(
      "This licence action already has different approved terms.",
    );
  const previous = existing
    ? previousByAction.get(request.action_id)
    : latest.get(request.draft_request_id);
  return {
    ...planLicenceAction(draft, request, previous),
    request,
    existing,
    previous,
    previousTerms: previous && termsByAction.get(previous.request.action_id),
  };
}

function licenceSummary(receipt) {
  const { request, installation_id, approval_sha256, tier } = receipt;
  const {
    action_id,
    draft_request_id,
    action,
    release_commit,
    limits,
    issued_at,
    starts_at,
    expires_at,
    grace_until,
  } = request;
  return {
    action_id,
    draft_request_id,
    action,
    tier,
    installation_id,
    release_commit,
    limits,
    issued_at,
    starts_at,
    expires_at,
    grace_until,
    ...(receipt.recorded_at && {
      recorded_at: receipt.recorded_at,
      licence_sha256: receipt.licence_sha256,
    }),
    approval: "ISSUE " + approval_sha256,
  };
}

async function previewLicence(root, source) {
  const request = await loadLicenceRequest(root, source);
  const plan = prepareLicenceAction(await readRegistry(root), request);
  return licenceSummary(
    plan.existing ?? { ...plan, installation_id: plan.terms.installation_id },
  );
}

async function issueLicence(root, source, approval, keyPath, existingPath) {
  const request = await loadLicenceRequest(root, source);
  if (Boolean(existingPath) !== (request.existing_licence_sha256 !== null))
    throw new Error(
      "Supply an existing signed licence only when registering it.",
    );
  return withRegistryLock(root, async () => {
    const registry = await readRegistry(root);
    const plan = prepareLicenceAction(registry, request);
    if (approval !== "ISSUE " + plan.approval_sha256)
      throw new Error(
        "Approval does not match this licence request. Preview it again.",
      );

    const key = createPrivateKey(await readPrivateInput(keyPath, 16 * 1024));
    const publicKey = createPublicKey(key);
    if (plan.previous) {
      const { terms } = verifyAcademyLicence(
        plan.previous.envelope,
        publicKey,
        plan.previousTerms,
      );
      if (!isDeepStrictEqual(terms, plan.previousTerms))
        throw new Error(
          "The preceding signed licence differs from its recorded terms.",
        );
    }
    const envelope = existingPath
      ? (await readPrivateInput(existingPath, 17 * 1024))
          .toString("utf8")
          .trim()
      : signAcademyLicence(plan.terms, key);
    const licence_sha256 = sha256(envelope);
    if (
      existingPath &&
      (licence_sha256 !== request.existing_licence_sha256 ||
        !isDeepStrictEqual(
          verifyAcademyLicence(envelope, publicKey, plan.terms).terms,
          plan.terms,
        ))
    )
      throw new Error("The existing licence differs from the reviewed terms.");
    if (plan.existing) {
      if (plan.existing.licence_sha256 !== licence_sha256)
        throw new Error(
          "Use the original trusted issuer for this already recorded licence.",
        );
      return { ...licenceSummary(plan.existing), created: false };
    }
    const receipt = {
      request,
      installation_id: plan.terms.installation_id,
      tier: plan.tier,
      approval_sha256: plan.approval_sha256,
      recorded_at: new Date().toISOString(),
      licence_sha256,
      envelope,
    };
    await writeRegistry(root, {
      ...registry,
      licences: [...(registry.licences ?? []), receipt],
    });
    return { ...licenceSummary(receipt), created: true };
  });
}

async function licenceHistory(root, draftId) {
  await requireRegistryRoot(root);
  const registry = await readRegistry(root);
  const { drafts, actions } = indexLicenceActions(registry);
  if (!drafts.has(draftId))
    throw new Error("The approved academy draft could not be found.");
  return Array.from(actions.values())
    .filter((receipt) => receipt.request.draft_request_id === draftId)
    .map(licenceSummary);
}

async function exportLicence(root, actionId) {
  await requireRegistryRoot(root);
  return withRegistryLock(root, async () => {
    const registry = await readRegistry(root);
    const { actions } = indexLicenceActions(registry);
    const receipt = actions.get(actionId);
    if (!receipt)
      throw new Error("The approved licence action could not be found.");
    const filename = licenceFilename(receipt);
    const output = join(root, filename);
    const bytes = Buffer.from(receipt.envelope + "\n");
    try {
      await writePrivateFile(root, output, bytes);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await readPrivateInput(output, 17 * 1024)).equals(bytes))
        throw new Error(
          "An unrelated file already occupies the licence output path.",
          { cause: error },
        );
    }
    return { filename, licence_sha256: receipt.licence_sha256 };
  });
}

const licenceFilename = ({ request }) =>
  "licence-" + request.action_id + ".signed";
const handoffFilename = ({ installation_id }) =>
  "runtime-handoff-" + installation_id + ".signed";

async function exportRuntimeHandoff(root, requestId, keyPath) {
  await requireRegistryRoot(root);
  return withRegistryLock(root, async () => {
    const { drafts } = await readRegistry(root);
    const receipt = drafts.find(({ draft }) => draft.request_id === requestId);
    if (!receipt)
      throw new Error("The approved customer draft could not be found.");
    const handoff = Buffer.from(
      signAcademyRuntimeHandoff(
        handoffTarget(receipt),
        createPrivateKey(await readPrivateInput(keyPath, 16 * 1024)),
      ),
    );
    const filename = handoffFilename(receipt);
    const output = join(root, filename);
    try {
      await writePrivateFile(root, output, handoff);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await readPrivateInput(output, 16 * 1024)).equals(handoff))
        throw new Error(
          "An unrelated file already occupies the runtime handoff path.",
          { cause: error },
        );
    }
    return { filename, installation_id: receipt.installation_id };
  });
}

async function readOptionalExport(root, filename) {
  try {
    return await readPrivateInput(join(root, filename), 17 * 1024);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function readFulfilmentState(registry, draftId) {
  const index = indexLicenceActions(registry);
  const draft = index.drafts.get(draftId);
  if (!draft)
    throw new Error("The approved customer draft could not be found.");
  const licence = index.latest.get(draftId);
  return {
    draft,
    licence,
    terms: licence && index.termsByAction.get(licence.request.action_id),
    confirmed: indexFulfilments(registry, index).get(draftId),
  };
}

async function verifyFulfilmentArtifacts(
  root,
  { draft, licence, terms },
  handoffKeyPath,
  licenceKeyPath,
) {
  const [handoffKey, licenceKey] = [handoffKeyPath, licenceKeyPath].map(
    (path) => createPublicKey(readRuntimeHandoffFile(path, false)),
  );
  if (
    [handoffKey, licenceKey].some((key) => key.asymmetricKeyType !== "ed25519")
  )
    throw new Error(
      "Use independently trusted Ed25519 public keys for handover checks.",
    );
  const [handoff, signedLicence] = await Promise.all([
    readOptionalExport(root, handoffFilename(draft)),
    licence && readOptionalExport(root, licenceFilename(licence)),
  ]);
  if (handoff) {
    try {
      const { target } = verifyAcademyRuntimeHandoff(handoff, handoffKey);
      if (!isDeepStrictEqual(target, handoffTarget(draft)))
        throw new Error("handoff_target_mismatch");
    } catch (cause) {
      throw new Error(
        "The exported runtime handoff does not match the approved target and trusted key.",
        { cause },
      );
    }
  }
  const now = Date.now();
  let licence_state;
  if (licence) {
    try {
      const result = verifyAcademyLicence(
        licence.envelope,
        licenceKey,
        terms,
        now,
      );
      if (
        !isDeepStrictEqual(result.terms, terms) ||
        (signedLicence &&
          !signedLicence.equals(Buffer.from(licence.envelope + "\n")))
      )
        throw new Error("licence_export_mismatch");
      licence_state = result.state;
    } catch (cause) {
      throw new Error(
        "The current licence or its export does not match the recorded terms and trusted key.",
        { cause },
      );
    }
  }
  return {
    handoff_sha256: handoff && sha256(handoff),
    licence_exported: Boolean(signedLicence),
    licence_state,
    now,
  };
}

function fulfilmentSummary(draft, record) {
  return {
    request_id: draft.draft.request_id,
    installation_id: draft.installation_id,
    purpose: draft.draft.purpose,
    approved_release: draft.draft.licence.release_commit,
    licence_action_id: record.request.licence_action_id,
    handoff_sha256: record.handoff_sha256,
    licence_sha256: record.licence_sha256,
    ...(record.confirmed_at
      ? { status: "handover-confirmed", confirmed_at: record.confirmed_at }
      : {
          status: "handover-review",
          approval: "CONFIRM " + record.approval_sha256,
        }),
  };
}

async function fulfilmentStatus(root, draftId, handoffKey, licenceKey) {
  await requireRegistryRoot(root);
  const state = readFulfilmentState(await readRegistry(root), draftId);
  const { draft, licence, confirmed } = state;
  const artifacts = await verifyFulfilmentArtifacts(
    root,
    state,
    handoffKey,
    licenceKey,
  );
  const materialsReady =
    artifacts.handoff_sha256 &&
    artifacts.licence_exported &&
    artifacts.licence_state === "active" &&
    licence.request.release_commit === draft.draft.licence.release_commit;
  let status = "draft-approved";
  if (licence || artifacts.handoff_sha256) status = "preparing-handover";
  if (materialsReady) status = "ready-for-handover";
  if (confirmed) status = "handover-confirmed";
  return {
    status,
    request_id: draftId,
    installation_id: draft.installation_id,
    purpose: draft.draft.purpose,
    edition: draft.draft.target.edition,
    approved_release: draft.draft.licence.release_commit,
    handoff_exported: Boolean(artifacts.handoff_sha256),
    current_licence: licence
      ? {
          action_id: licence.request.action_id,
          release_commit: licence.request.release_commit,
          tier: licence.tier,
          state: artifacts.licence_state,
          exported: artifacts.licence_exported,
        }
      : null,
    handover: confirmed ? fulfilmentSummary(draft, confirmed) : null,
  };
}

async function fulfilmentAction(
  root,
  source,
  handoffKey,
  licenceKey,
  approval,
) {
  await requireRegistryRoot(root);
  const request = parseFulfilmentRequest(
    await readPrivateJson(source, 16 * 1024),
  );
  const review = async () => {
    const registry = await readRegistry(root);
    const state = readFulfilmentState(registry, request.draft_request_id);
    const { draft, licence, confirmed } = state;
    if (confirmed && !isDeepStrictEqual(confirmed.request, request))
      throw new Error(
        "This academy already has a different confirmed handover.",
      );
    if (!confirmed && licence?.request.action_id !== request.licence_action_id)
      throw new Error(
        "Review the current licence action before confirming delivery.",
      );
    const artifacts = confirmed
      ? null
      : await verifyFulfilmentArtifacts(root, state, handoffKey, licenceKey);
    const plan =
      confirmed ?? planFulfilment(draft, request, licence, artifacts);
    if (approval === undefined) return fulfilmentSummary(draft, plan);
    if (approval !== "CONFIRM " + plan.approval_sha256)
      throw new Error(
        "Approval does not match this handover request. Preview it again.",
      );
    if (confirmed)
      return { ...fulfilmentSummary(draft, confirmed), created: false };
    const receipt = {
      ...plan,
      confirmed_at: new Date(artifacts.now).toISOString(),
    };
    const updated = {
      ...registry,
      fulfilments: [...(registry.fulfilments ?? []), receipt],
    };
    indexFulfilments(updated, indexLicenceActions(registry));
    await writeRegistry(root, updated);
    return { ...fulfilmentSummary(draft, receipt), created: true };
  };
  return approval === undefined ? review() : withRegistryLock(root, review);
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
    const [command, root, ...args] = process.argv.slice(2);
    const counts = {
      preview: [1],
      approve: [2],
      "preview-licence": [1],
      "issue-licence": [3, 4],
      "licence-history": [1],
      "export-licence": [1],
      "export-runtime-handoff": [2],
      "fulfilment-status": [3],
      "preview-fulfilment": [3],
      "confirm-fulfilment": [4],
    };
    if (
      !root ||
      !args.every(Boolean) ||
      !Object.hasOwn(counts, command) ||
      !counts[command].includes(args.length)
    ) {
      throw new Error(
        "Usage: academy-customer-draft.mjs COMMAND PRIVATE_REGISTRY INPUT [OPTIONS]. Commands: " +
          Object.keys(counts).join(", ") +
          ". See deploy/academy/FULFILMENT.md for private handover commands.",
      );
    }
    const [source, approval, key, existing] = args;
    let result;
    switch (command) {
      case "preview":
        result = publicReview(await previewCustomerAcademyDraft(root, source));
        break;
      case "approve": {
        const { receipt, created } = await approveCustomerAcademyDraft(
          root,
          source,
          approval,
        );
        result = {
          status: receipt.status,
          installation_id: receipt.installation_id,
          created,
        };
        break;
      }
      case "preview-licence":
        result = await previewLicence(root, source);
        break;
      case "issue-licence":
        result = await issueLicence(root, source, approval, key, existing);
        break;
      case "licence-history":
        result = await licenceHistory(root, source);
        break;
      case "export-licence":
        result = await exportLicence(root, source);
        break;
      case "export-runtime-handoff":
        result = await exportRuntimeHandoff(root, source, approval);
        break;
      case "fulfilment-status":
        result = await fulfilmentStatus(root, ...args);
        break;
      case "preview-fulfilment":
      case "confirm-fulfilment":
        result = await fulfilmentAction(root, ...args);
        break;
    }
    console.log(JSON.stringify(result, null, 2));
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
