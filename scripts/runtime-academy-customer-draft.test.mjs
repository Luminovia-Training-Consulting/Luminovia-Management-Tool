/** Exercise approval, licence continuity and signed customer handover with private fictional fixtures. */
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  approveCustomerAcademyDraft,
  planCustomerAcademyDraft,
  previewCustomerAcademyDraft,
} from "./academy-customer-draft.mjs";
import {
  signAcademyLicence,
  verifyAcademyLicence,
} from "./academy-licence.mjs";
import { planLicenceAction } from "./academy-customer-licensing.mjs";
import { signAcademyRuntimeHandoff } from "./academy-runtime-handoff.mjs";
import { readPrivateFixture } from "./testing/read-private-fixture.mjs";

const run = promisify(execFile);
const cli = fileURLToPath(
  new URL("./academy-customer-draft.mjs", import.meta.url),
);
const example = JSON.parse(
  await readFile(
    new URL("../deploy/academy/customer-draft.example.json", import.meta.url),
    "utf8",
  ),
);
const ledger = "approved-drafts.json";
const reviewToken = (plan) => "APPROVE " + plan.approval_sha256;
const draft = () => ({ ...structuredClone(example), request_id: randomUUID() });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "academy-customer-draft-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  return root;
}
async function input(root, entry, name = "input.json") {
  const path = join(root, name);
  await writeFile(path, JSON.stringify(entry), { mode: 0o600 });
  return path;
}

test("saved portal settings can be reviewed and approved through stdin", async (t) => {
  const root = await fixture(t);
  const entry = draft();
  const receipt = JSON.stringify({ revision: 3, settings: entry });
  const execute = (...args) => {
    const result = spawnSync(
      process.execPath,
      [cli, args[0], root, "-", ...args.slice(1)],
      {
        input: receipt,
        encoding: "utf8",
        timeout: 10_000,
      },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const preview = execute("preview");
  assert.equal(preview.approval, reviewToken(planCustomerAcademyDraft(entry)));
  assert.equal(execute("approve", preview.approval).created, true);
  assert.equal(execute("approve", preview.approval).created, false);
});

test("binds the explicitly selected setup package to the first licence without changing legacy digests", () => {
  const entry = draft();
  const legacy = planCustomerAcademyDraft(entry);
  assert.equal(legacy.draft.licence.lms_package, undefined);
  assert.deepEqual(legacy.unsigned_licence_selection.modules, ["lms"]);
  const standard = planCustomerAcademyDraft({
    ...entry,
    licence: { ...entry.licence, lms_package: "standard" },
  });
  const premium = planCustomerAcademyDraft({
    ...entry,
    licence: { ...entry.licence, lms_package: "premium" },
  });
  assert.deepEqual(standard.unsigned_licence_selection.modules, [
    "lms-standard",
  ]);
  assert.notEqual(standard.approval_sha256, legacy.approval_sha256);
  assert.equal(
    planCustomerAcademyDraft(legacy.draft).approval_sha256,
    legacy.approval_sha256,
  );

  const receipt = (plan) => ({
    ...plan,
    installation_id: plan.runtime.installation_id,
  });
  const request = {
    version: 2,
    action_id: randomUUID(),
    draft_request_id: entry.request_id,
    action: "initial-licensed",
    preceding_licence_sha256: null,
    agreement_reference: entry.support.agreement_reference,
    release_commit: entry.licence.release_commit,
    limits: entry.licence.limits,
    issued_at: "2026-11-20T00:00:00.000Z",
    starts_at: "2026-11-23T00:00:00.000Z",
    expires_at: "2026-12-21T00:00:00.000Z",
    grace_until: "2026-12-28T00:00:00.000Z",
  };
  assert.throws(
    () => planLicenceAction(receipt(standard), request),
    /match the approved Academy LMS package/,
  );
  assert.throws(
    () =>
      planLicenceAction(receipt(premium), {
        ...request,
        lms_package: "standard",
      }),
    /match the approved Academy LMS package/,
  );
  assert.deepEqual(
    planLicenceAction(receipt(standard), {
      ...request,
      lms_package: "standard",
    }).terms.modules,
    ["lms-standard"],
  );
  assert.deepEqual(planLicenceAction(receipt(legacy), request).terms.modules, [
    "lms",
  ]);
});

async function vendorFixture(t, edition) {
  const root = await fixture(t);
  const entry = draft();
  entry.target.edition = edition;
  const draftPath = await input(root, entry);
  const reviewed = await approveCustomerAcademyDraft(
    root,
    draftPath,
    reviewToken(planCustomerAcademyDraft(entry)),
  );
  const keys = generateKeyPairSync("ed25519");
  const privateKeyPath = join(root, "signing-key.pem");
  await writeFile(
    privateKeyPath,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  const command = async (...args) =>
    JSON.parse(
      (await run(process.execPath, [cli, args[0], root, ...args.slice(1)]))
        .stdout,
    );
  const request = {
    version: 1,
    action_id: randomUUID(),
    draft_request_id: entry.request_id,
    action: "initial-licensed",
    preceding_licence_sha256: null,
    agreement_reference: "AGREEMENT-NEUTRAL-01",
    ...entry.licence,
    issued_at: "2026-11-20T00:00:00.000Z",
    starts_at: "2026-11-23T00:00:00.000Z",
    expires_at: "2026-12-21T00:00:00.000Z",
    grace_until: "2026-12-28T00:00:00.000Z",
  };
  const stage = async (value, name = "action.json") => {
    const path = await input(root, value, name);
    const preview = await command("preview-licence", path);
    return { path, preview };
  };
  const issue = ({ path, preview }, key = privateKeyPath, ...extra) =>
    command("issue-licence", path, preview.approval, key, ...extra);
  return {
    root,
    request,
    stage,
    issue,
    command,
    keys,
    privateKeyPath,
    installation: reviewed.receipt.installation_id,
  };
}

function extend(request, receipt, overrides = {}) {
  return {
    ...request,
    action_id: randomUUID(),
    action: "renew",
    preceding_licence_sha256: receipt.licence_sha256,
    agreement_reference: "SUPPORT-RENEWAL-02",
    issued_at: "2026-12-20T00:00:00.000Z",
    starts_at: "2026-12-21T00:00:00.000Z",
    expires_at: "2027-12-21T00:00:00.000Z",
    grace_until: "2027-12-28T00:00:00.000Z",
    ...overrides,
  };
}

async function handoverFixture(t, edition) {
  const vendor = await vendorFixture(t, edition);
  const handoffKeys = generateKeyPairSync("ed25519");
  const keyFile = join(vendor.root, "handoff-issuer.pem");
  const handoffKey = join(vendor.root, "handoff-public.pem");
  const licenceKey = join(vendor.root, "licence-public.pem");
  await writeFile(
    keyFile,
    handoffKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  await writeFile(
    handoffKey,
    handoffKeys.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
  await writeFile(
    licenceKey,
    vendor.keys.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
  const requestId = vendor.request.draft_request_id;
  const status = () =>
    vendor.command("fulfilment-status", requestId, handoffKey, licenceKey);
  const handoff = () =>
    vendor.command("export-runtime-handoff", requestId, keyFile);
  const preview = (source) =>
    vendor.command("preview-fulfilment", source, handoffKey, licenceKey);
  const confirm = (source, approval) =>
    vendor.command(
      "confirm-fulfilment",
      source,
      handoffKey,
      licenceKey,
      approval,
    );
  return {
    ...vendor,
    handoffKeys,
    handoffKey,
    licenceKey,
    status,
    handoff,
    preview,
    confirm,
  };
}

function licenceDates(issued, start, end, grace) {
  const instant = (minutes) =>
    new Date(Date.now() + minutes * 60_000).toISOString();
  return {
    issued_at: instant(issued),
    starts_at: instant(start),
    expires_at: instant(end),
    grace_until: instant(grace),
  };
}

test("confirms a private handover only from the reviewed signed exports and preserves its receipt after renewal", async (t) => {
  const {
    root,
    request,
    stage,
    issue,
    command,
    installation,
    handoffKeys,
    handoffKey,
    licenceKey,
    status,
    handoff,
    preview,
    confirm,
  } = await handoverFixture(t, "customer-managed");
  assert.equal((await status()).status, "draft-approved");
  const issued = await issue(
    await stage({ ...request, ...licenceDates(-90, -60, 60, 120) }),
  );
  const review = {
    version: 1,
    draft_request_id: request.draft_request_id,
    licence_action_id: issued.action_id,
    agreement_reference: request.agreement_reference,
    handover_reference: "CUSTOMER-RECEIPT-FICTIONAL",
  };
  const source = await input(root, review, "handover.json");
  assert.equal((await status()).current_licence.exported, false);
  await assert.rejects(preview(source), /Export the verified runtime handoff/);
  const handoffExport = await handoff();
  await assert.rejects(preview(source), /Export the verified runtime handoff/);
  const licenceExport = await command("export-licence", issued.action_id);
  assert.equal((await status()).status, "ready-for-handover");

  const wrongAgreement = await input(
    root,
    { ...review, agreement_reference: "WRONG-AGREEMENT" },
    "other-agreement.json",
  );
  await assert.rejects(
    preview(wrongAgreement),
    /match the handoff release and reviewed agreement/,
  );
  await assert.rejects(
    command(
      "fulfilment-status",
      request.draft_request_id,
      licenceKey,
      handoffKey,
    ),
    /handoff does not match the approved target and trusted key/,
  );
  const handoffPath = join(root, handoffExport.filename);
  const handoffBytes = readPrivateFixture(handoffPath);
  const foreignHandoff = signAcademyRuntimeHandoff(
    {
      ...JSON.parse(handoffBytes).target,
      installation_id: randomUUID(),
    },
    handoffKeys.privateKey,
  );
  await writeFile(handoffPath, foreignHandoff);
  await assert.rejects(
    preview(source),
    /handoff does not match the approved target and trusted key/,
  );
  await writeFile(handoffPath, handoffBytes);

  const licencePath = join(root, licenceExport.filename);
  const licenceBytes = readPrivateFixture(licencePath);
  await writeFile(
    licencePath,
    Buffer.concat([licenceBytes, Buffer.from("\n")]),
  );
  await assert.rejects(preview(source), /licence or its export does not match/);
  await writeFile(licencePath, licenceBytes);

  const before = readPrivateFixture(join(root, ledger));
  const exactReview = await preview(source);
  assert.deepEqual(readPrivateFixture(join(root, ledger)), before);
  assert.equal(
    exactReview.handoff_sha256,
    createHash("sha256").update(handoffBytes).digest("hex"),
  );
  assert.equal(exactReview.licence_sha256, issued.licence_sha256);
  await assert.rejects(
    confirm(source, "CONFIRM wrong"),
    /Approval does not match/,
  );
  assert.deepEqual(readPrivateFixture(join(root, ledger)), before);
  const results = await Promise.all([
    confirm(source, exactReview.approval),
    confirm(source, exactReview.approval),
  ]);
  const first = results.find(({ created }) => created);
  assert.deepEqual(
    results.find(({ created }) => !created),
    { ...first, created: false },
  );
  assert.equal(first.installation_id, installation);
  assert.equal(first.status, "handover-confirmed");
  const after = readPrivateFixture(join(root, ledger));
  const stored = JSON.parse(after).fulfilments;
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].request, review);
  assert.equal(
    JSON.stringify(first).includes(review.handover_reference),
    false,
  );
  await assert.rejects(
    preview(
      await input(
        root,
        { ...review, handover_reference: "CHANGED-RECEIPT" },
        "changed.json",
      ),
    ),
    /different confirmed handover/,
  );

  const renewal = await issue(
    await stage(
      extend(request, issued, {
        ...licenceDates(-30, -15, 1440, 1500),
        release_commit: "b".repeat(40),
      }),
    ),
  );
  const current = await status();
  assert.equal(current.status, "handover-confirmed");
  assert.equal(current.current_licence.action_id, renewal.action_id);
  assert.equal(current.handover.licence_action_id, first.licence_action_id);
  assert.deepEqual(await confirm(source, exactReview.approval), {
    ...first,
    created: false,
  });
  const ledgerPath = join(root, ledger);
  const altered = JSON.parse(readPrivateFixture(ledgerPath));
  altered.fulfilments[0].handoff_sha256 = "0".repeat(64);
  await writeFile(ledgerPath, JSON.stringify(altered));
  await assert.rejects(status(), /conflicting or modified handover receipts/);
});

test("expired, stale and wrong-release licences cannot confirm the first handover", async (t) => {
  const {
    root,
    request,
    stage,
    issue,
    command,
    status,
    handoff,
    preview,
    confirm,
  } = await handoverFixture(t, "customer-self-hosted");
  const issued = await issue(
    await stage({ ...request, ...licenceDates(-180, -160, -120, -90) }),
  );
  await handoff();
  await command("export-licence", issued.action_id);
  const review = {
    version: 1,
    draft_request_id: request.draft_request_id,
    licence_action_id: issued.action_id,
    agreement_reference: request.agreement_reference,
    handover_reference: "FICTIONAL-EXPIRED-HANDOVER",
  };
  const source = await input(root, review, "handover-expired.json");
  assert.equal((await status()).current_licence.state, "expired");
  await assert.rejects(
    confirm(source, "CONFIRM invalid"),
    /current active licence/,
  );
  const renewed = await issue(
    await stage(
      extend(request, issued, {
        ...licenceDates(-60, -30, 90, 120),
        release_commit: "b".repeat(40),
      }),
    ),
  );
  await command("export-licence", renewed.action_id);
  await assert.rejects(preview(source), /current licence action/);
  const wrongRelease = await input(
    root,
    {
      ...review,
      licence_action_id: renewed.action_id,
      agreement_reference: "SUPPORT-RENEWAL-02",
    },
    "handover-wrong-release.json",
  );
  assert.equal((await status()).status, "preparing-handover");
  await assert.rejects(preview(wrongRelease), /match the handoff release/);
  assert.equal(
    JSON.parse(readPrivateFixture(join(root, ledger))).fulfilments,
    undefined,
  );
});

test("issues from a v1 approved draft, renews quotas and release, and exports the exact signed envelope", async (t) => {
  const {
    root,
    request,
    stage,
    issue,
    command,
    keys,
    installation,
    privateKeyPath,
  } = await vendorFixture(t, "customer-managed");
  const registry = join(root, ledger);
  const draftBytes = await readFile(registry);
  const initial = await stage(request, "initial.json");
  assert.deepEqual(await readFile(registry), draftBytes);
  await assert.rejects(
    command("issue-licence", initial.path, "ISSUE 0", privateKeyPath),
    /Approval does not match/,
  );
  assert.deepEqual(await readFile(registry), draftBytes);
  const firstReceipt = await issue(initial);
  assert.equal(firstReceipt.tier, "licensed");
  assert.equal(firstReceipt.created, true);
  assert.equal(firstReceipt.installation_id, installation);
  assert.equal("envelope" in firstReceipt, false);

  const renewal = extend(request, firstReceipt, {
    version: 2,
    release_commit: "b".repeat(40),
    limits: { ...request.limits, seat_count: 50, api_requests_per_minute: 240 },
  });
  const renewed = await issue(await stage(renewal, "renewal.json"));
  assert.equal(renewed.tier, "licensed");
  const output = await command("export-licence", renewal.action_id);
  const signedFile = join(root, output.filename);
  const signedBytes = readPrivateFixture(signedFile);
  assert.deepEqual(await command("export-licence", renewal.action_id), output);
  assert.deepEqual(readPrivateFixture(signedFile), signedBytes);
  const verified = verifyAcademyLicence(
    signedBytes.toString("utf8").trim(),
    keys.publicKey,
    {
      installation_id: installation,
      edition: "customer-managed",
      release_commit: renewal.release_commit,
    },
    Date.parse(renewal.starts_at),
  );
  assert.equal(verified.state, "active");
  assert.deepEqual(verified.terms.limits, renewal.limits);
  assert.deepEqual(await issue(initial), { ...firstReceipt, created: false });
  assert.deepEqual(
    (await command("licence-history", request.draft_request_id)).map(
      (entry) => entry.action,
    ),
    ["initial-licensed", "renew"],
  );
});

test("rejects retired requests and keeps recorded legacy envelopes valid through licensed renewal", async (t) => {
  const fixture = await vendorFixture(t, "customer-managed");
  const {
    root,
    request,
    keys,
    installation,
    stage,
    issue,
    command,
    privateKeyPath,
  } = fixture;
  const registry = join(root, ledger);
  const draftBytes = await readFile(registry);

  for (const action of ["initial-trial", "adopt-trial", "convert-trial"]) {
    const source = await input(root, { ...request, action });
    await assert.rejects(
      command("preview-licence", source),
      /Invalid private licence request/,
    );
    await assert.rejects(
      command("issue-licence", source, "ISSUE invalid", privateKeyPath),
      /Invalid private licence request/,
    );
  }
  assert.deepEqual(await readFile(registry), draftBytes);

  // Reproduce the receipt format written by the previous CLI, with the v1
  // approval digest's original field order and a real signed envelope.
  const {
    version,
    action_id,
    draft_request_id,
    preceding_licence_sha256,
    agreement_reference,
    release_commit,
    limits,
    issued_at,
    starts_at,
    expires_at,
    grace_until,
  } = request;
  const historical = {
    version,
    action_id,
    draft_request_id,
    action: "initial-trial",
    preceding_licence_sha256,
    existing_licence_sha256: null,
    agreement_reference,
    release_commit,
    limits,
    issued_at,
    starts_at,
    expires_at,
    grace_until,
  };
  const records = JSON.parse(draftBytes);
  const envelope = signAcademyLicence(
    {
      installation_id: installation,
      edition: "customer-managed",
      release_commit,
      issued_at,
      starts_at,
      expires_at,
      grace_until,
      modules: ["lms"],
      limits,
    },
    keys.privateKey,
  );
  const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const oldReceipt = {
    request: historical,
    installation_id: installation,
    tier: "trial",
    approval_sha256: digest(
      "Luminovia Academy Licence Approval v1\n" +
        records.drafts[0].approval_sha256 +
        "\n" +
        JSON.stringify(historical),
    ),
    recorded_at: request.issued_at,
    licence_sha256: digest(envelope),
    envelope,
  };
  records.licences = [oldReceipt];
  await writeFile(registry, JSON.stringify(records));
  const history = () => command("licence-history", request.draft_request_id);
  assert.equal((await history())[0].tier, "trial");
  const { filename } = await command("export-licence", action_id);
  assert.equal(
    readPrivateFixture(join(root, filename)).toString("utf8"),
    envelope + "\n",
  );

  const renewal = extend(request, oldReceipt);
  await assert.rejects(stage(renewal), /Use a version 2 request/);
  const approved = await stage({ ...renewal, version: 2 });
  assert.equal((await issue(approved)).tier, "licensed");
  assert.deepEqual(
    (await history()).map(({ tier }) => tier),
    ["trial", "licensed"],
  );
  assert.deepEqual(
    JSON.parse(await readFile(registry)).licences[0],
    oldReceipt,
  );
});

test("concurrent renewals from the same receipt allow only one successor and cannot overwrite an export", async (t) => {
  const { root, request, stage, issue, command } = await vendorFixture(
    t,
    "customer-self-hosted",
  );
  const first = await issue(
    await stage({ ...request, action: "initial-licensed" }),
  );
  const rivals = await Promise.all(
    [extend(request, first), extend(request, first)].map((value, index) =>
      stage(value, `renewal-${index}.json`),
    ),
  );
  const results = await Promise.allSettled(
    rivals.map((candidate) => issue(candidate)),
  );
  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  assert.match(
    results.find(({ status }) => status === "rejected").reason.stderr,
    /follow the current receipt/,
  );
  const winner = results.find(({ status }) => status === "fulfilled").value;
  assert.equal(
    (await command("licence-history", request.draft_request_id)).length,
    2,
  );
  const output = join(root, "licence-" + winner.action_id + ".signed");
  await writeFile(output, "preserve this file", { mode: 0o600 });
  await assert.rejects(
    command("export-licence", winner.action_id),
    /unrelated file/,
  );
  assert.equal(await readFile(output, "utf8"), "preserve this file");
});

test("registers an existing trusted licence without changing its signed terms or issuing a second one", async (t) => {
  const { root, request, stage, issue, command, keys, installation } =
    await vendorFixture(t, "customer-self-hosted");
  const terms = {
    installation_id: installation,
    edition: "customer-self-hosted",
    modules: ["lms"],
    release_commit: "d".repeat(40),
    limits: { ...request.limits, seat_count: 30 },
    issued_at: request.issued_at,
    starts_at: request.starts_at,
    expires_at: request.expires_at,
    grace_until: request.grace_until,
  };
  const envelope = signAcademyLicence(terms, keys.privateKey);
  const digest = createHash("sha256").update(envelope).digest("hex");
  const envelopePath = join(root, "existing.signed");
  await writeFile(envelopePath, envelope + "\n", { mode: 0o600 });
  const registration = {
    ...request,
    ...{
      action: "adopt-licensed",
      existing_licence_sha256: digest,
      release_commit: terms.release_commit,
      limits: terms.limits,
    },
  };
  const reviewed = await stage(registration, "registration.json");
  const wrong = await stage({ ...registration, limits: request.limits });
  await assert.rejects(
    issue(wrong, undefined, envelopePath),
    /differs from the reviewed terms/,
  );
  const imported = await issue(reviewed, undefined, envelopePath);
  assert.equal(imported.licence_sha256, digest);
  assert.equal(imported.tier, "licensed");
  assert.deepEqual(await issue(reviewed, undefined, envelopePath), {
    ...imported,
    created: false,
  });
  const output = await command("export-licence", registration.action_id);
  assert.equal(
    await readFile(join(root, output.filename), "utf8"),
    envelope + "\n",
  );
});

test("plans each edition without provisioning and produces a usable unsigned licence selection", () => {
  for (const edition of ["customer-self-hosted", "customer-managed"]) {
    const entry = draft();
    entry.target.edition = edition;
    const preview = planCustomerAcademyDraft(entry);
    assert.equal(preview.runtime.edition, edition);
    assert.equal(
      preview.runtime.api_base_url,
      entry.target.portal_origin + "/backend",
    );
    assert.ok(preview.runtime.compose_project.startsWith("academy-"));
    assert.notEqual(preview.runtime.installation_id, entry.request_id);
    assert.equal(
      planCustomerAcademyDraft(entry).runtime.installation_id,
      preview.runtime.installation_id,
    );
    assert.deepEqual(
      preview.unsigned_licence_selection.limits,
      entry.licence.limits,
    );
    assert.equal("signature" in preview.unsigned_licence_selection, false);
    const dates = {
      issued_at: "2026-11-20T00:00:00.000Z",
      starts_at: "2026-11-21T00:00:00.000Z",
      expires_at: "2027-11-21T00:00:00.000Z",
      grace_until: "2027-11-28T00:00:00.000Z",
    };
    const keys = generateKeyPairSync("ed25519");
    const signedFixture = signAcademyLicence(
      { ...preview.unsigned_licence_selection, ...dates },
      keys.privateKey,
    );
    assert.equal(
      verifyAcademyLicence(
        signedFixture,
        keys.publicKey,
        preview.unsigned_licence_selection,
        Date.parse(dates.starts_at),
      ).state,
      "active",
    );
  }
});

test("preview and wrong or stale approval do not write a registry, while exact retries return the same receipt", async (t) => {
  const root = await fixture(t);
  const entry = draft();
  const source = await input(root, entry);
  const preview = await previewCustomerAcademyDraft(root, source);
  assert.equal(preview.status, "preview");
  assert.deepEqual(await readdir(root), ["input.json"]);
  await assert.rejects(
    approveCustomerAcademyDraft(root, source, "APPROVE"),
    /does not match/,
  );

  const changed = {
    ...entry,
    support: { ...entry.support, agreement_reference: "A-DIFFERENT-AGREEMENT" },
  };
  await input(root, changed);
  await assert.rejects(
    approveCustomerAcademyDraft(root, source, reviewToken(preview)),
    /does not match/,
  );
  assert.deepEqual(await readdir(root), ["input.json"]);
  await input(root, entry);
  const first = await approveCustomerAcademyDraft(
    root,
    source,
    reviewToken(preview),
  );
  assert.equal(first.created, true);
  assert.equal(first.receipt.status, "approved-draft");
  assert.equal(first.receipt.installation_id, preview.runtime.installation_id);
  assert.equal(
    first.receipt.draft.initial_administrator.email,
    entry.initial_administrator.email,
  );
  const before = readPrivateFixture(join(root, ledger));
  assert.equal(
    (await previewCustomerAcademyDraft(root, source)).status,
    "approved-draft",
  );
  assert.deepEqual(
    await approveCustomerAcademyDraft(root, source, reviewToken(preview)),
    { ...first, created: false },
  );
  assert.deepEqual(readPrivateFixture(join(root, ledger)), before);
  assert.deepEqual((await readdir(root)).sort(), [
    ".academy-drafts.lock",
    ledger,
    "input.json",
  ]);
});

test("immutable request reuse, normalised duplicate domains and host-local duplicate paths are rejected", async (t) => {
  const root = await fixture(t);
  const existing = draft();
  const path = await input(root, existing);
  await approveCustomerAcademyDraft(
    root,
    path,
    reviewToken(planCustomerAcademyDraft(existing)),
  );
  existing.branding.name = "Different Academy";
  await input(root, existing);
  await assert.rejects(
    previewCustomerAcademyDraft(root, path),
    /different approved draft/,
  );

  const other = draft();
  other.target.portal_origin = "HTTPS://Academy.EXAMPLE.INVALID/";
  other.target.runtime_directory = "/opt/academy/different";
  await input(root, other);
  await assert.rejects(
    approveCustomerAcademyDraft(
      root,
      path,
      reviewToken(planCustomerAcademyDraft(other)),
    ),
    /another approved draft/,
  );

  other.target.portal_origin = "https://different.example.invalid";
  other.target.runtime_directory = example.target.runtime_directory;
  await input(root, other);
  await assert.rejects(
    approveCustomerAcademyDraft(
      root,
      path,
      reviewToken(planCustomerAcademyDraft(other)),
    ),
    /another approved draft/,
  );

  other.target.runtime_directory =
    example.target.runtime_directory + "/overlap";
  await input(root, other);
  await assert.rejects(
    approveCustomerAcademyDraft(
      root,
      path,
      reviewToken(planCustomerAcademyDraft(other)),
    ),
    /another approved draft/,
  );

  other.target.runtime_directory = example.target.runtime_directory;
  other.target.host_reference = "independent-customer-host";
  await input(root, other);
  assert.equal(
    (
      await approveCustomerAcademyDraft(
        root,
        path,
        reviewToken(planCustomerAcademyDraft(other)),
      )
    ).created,
    true,
  );
  assert.equal(JSON.parse(await readFile(join(root, ledger))).drafts.length, 2);
});

test("two CLI processes racing the same approval produce exactly one private receipt", async (t) => {
  const root = await fixture(t);
  const entry = draft();
  const path = await input(root, entry);
  const preview = await run(process.execPath, [cli, "preview", root, path]);
  assert.doesNotMatch(
    preview.stdout,
    /Fictional Training Company|admin@|support@/,
  );
  const approval = JSON.parse(preview.stdout).approval;
  const replies = await Promise.all([
    run(process.execPath, [cli, "approve", root, path, approval]),
    run(process.execPath, [cli, "approve", root, path, approval]),
  ]);
  assert.equal(
    replies.map(({ stdout }) => JSON.parse(stdout).created).filter(Boolean)
      .length,
    1,
  );
  assert.equal(JSON.parse(await readFile(join(root, ledger))).drafts.length, 1);
});

test("distinct concurrent approvals preserve both records", async (t) => {
  const root = await fixture(t);
  const first = draft();
  const second = draft();
  second.target.portal_origin = "https://second.example.invalid";
  second.target.runtime_directory = "/opt/academies/second";
  const [path1, path2] = await Promise.all([
    input(root, first),
    input(root, second, "second.json"),
  ]);
  const receipts = await Promise.all([
    approveCustomerAcademyDraft(
      root,
      path1,
      reviewToken(planCustomerAcademyDraft(first)),
    ),
    approveCustomerAcademyDraft(
      root,
      path2,
      reviewToken(planCustomerAcademyDraft(second)),
    ),
  ]);
  assert.ok(receipts.every(({ created }) => created));
  assert.equal(JSON.parse(await readFile(join(root, ledger))).drafts.length, 2);
});

test("does not accept reserved targets, fictitious live domains or unreviewed fields", () => {
  for (const invalid of [
    (value) => {
      value.target.edition = "internal";
    },
    (value) => {
      value.target.portal_origin = "https://cms.luminovia.org";
    },
    (value) => {
      value.target.portal_origin = "https://unverified.localhost";
      value.purpose = "customer";
    },
    (value) => {
      value.purpose = "customer";
    },
    (value) => {
      value.target.portal_origin = "https://127.0.0.1";
    },
    (value) => {
      value.target.portal_origin = "https://academy.example.invalid/admin";
    },
    (value) => {
      value.target.runtime_directory = "/opt/luminovia-portal/existing";
    },
    (value) => {
      value.licence.limits.seat_count = 0;
    },
    (value) => {
      value.licence.limits.storage_bytes = Number.MAX_SAFE_INTEGER + 1;
    },
    (value) => {
      value.preferences.time_zone = "Oceania/Somewhere";
    },
    (value) => {
      value.preferences.locale = "es";
    },
    (value) => {
      value.support.agreement_reference = "";
    },
    (value) => {
      value.licence.release_commit = "0".repeat(40);
    },
    (value) => {
      value.initial_administrator.password = "Unreviewed credential";
    },
  ]) {
    const entry = draft();
    invalid(entry);
    assert.throws(
      () => planCustomerAcademyDraft(entry),
      /Invalid draft fields/,
    );
  }
  const valid = draft();
  valid.purpose = "customer";
  valid.target.portal_origin = "https://training.academy-provider-example.edu";
  valid.target.domain_status = "verified-by-operator";
  assert.equal(planCustomerAcademyDraft(valid).draft.purpose, "customer");
});

test("rejects non-private files and symlinks, and will not overwrite a modified registry", async (t) => {
  const root = await fixture(t);
  const entry = draft();
  const source = await input(root, entry);
  const linked = join(root, "link.json");
  await symlink(source, linked);
  await assert.rejects(
    previewCustomerAcademyDraft(root, linked),
    /absolute private input/,
  );
  await chmod(source, 0o644);
  await assert.rejects(
    previewCustomerAcademyDraft(root, source),
    /private to the current operator/,
  );
  await chmod(source, 0o600);
  const approval = reviewToken(planCustomerAcademyDraft(entry));
  await approveCustomerAcademyDraft(root, source, approval);
  const path = join(root, ledger);
  const altered = JSON.parse(await readFile(path));
  altered.drafts[0].draft.legal_customer_name = "Unapproved Change";
  const corrupted = JSON.stringify(altered);
  await writeFile(path, corrupted);
  await assert.rejects(
    approveCustomerAcademyDraft(root, source, approval),
    /conflicting or modified/,
  );
  assert.equal(await readFile(path, "utf8"), corrupted);
});

test("an approved handoff creates exactly its independently confirmed private runtime and safely retries", async (t) => {
  const registry = await fixture(t);
  const operator = await fixture(t);
  const runtimeCli = fileURLToPath(
    new URL("./academy-runtime-config.mjs", import.meta.url),
  );
  const vendorKey = generateKeyPairSync("ed25519");
  const untrustedKey = generateKeyPairSync("ed25519");
  const vendorKeyPath = join(registry, "issuer.pem");
  const trust = join(operator, "trusted.pem");
  const otherTrust = join(operator, "other.pem");
  await writeFile(
    vendorKeyPath,
    vendorKey.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  await writeFile(
    trust,
    vendorKey.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
  await writeFile(
    otherTrust,
    untrustedKey.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
  const runtimes = [];

  for (const [i, edition] of [
    "customer-self-hosted",
    "customer-managed",
  ].entries()) {
    const entry = draft();
    const localRoot = join(operator, "runtime-" + i);
    const targetOrigin = `https://academy-${i}.example.invalid`;
    Object.assign(entry.target, {
      portal_origin: targetOrigin,
      edition,
      runtime_directory: localRoot,
    });
    const source = await input(registry, entry, `private-draft-${i}.json`);
    const exportCommand = () =>
      run(process.execPath, [
        cli,
        "export-runtime-handoff",
        registry,
        entry.request_id,
        vendorKeyPath,
      ]);
    await assert.rejects(
      exportCommand(),
      /approved customer draft could not be found/,
    );
    const { receipt } = await approveCustomerAcademyDraft(
      registry,
      source,
      reviewToken(planCustomerAcademyDraft(entry)),
    );
    const result = JSON.parse((await exportCommand()).stdout);
    const vendorFile = join(registry, result.filename);
    const delivered = readPrivateFixture(vendorFile);
    assert.deepEqual(JSON.parse((await exportCommand()).stdout), result);
    assert.deepEqual(readPrivateFixture(vendorFile), delivered);
    const handoff = JSON.parse(delivered);
    assert.deepEqual(Object.keys(handoff).sort(), [
      "signature",
      "target",
      "version",
    ]);
    assert.deepEqual(handoff.target, {
      installation_id: receipt.installation_id,
      edition,
      portal_origin: targetOrigin,
      runtime_directory: localRoot,
      source_revision: entry.licence.release_commit,
    });
    for (const privateValue of [
      entry.legal_customer_name,
      entry.branding.name,
      entry.initial_administrator.email,
      entry.support.contact_email,
      entry.support.agreement_reference,
    ]) {
      assert.equal(delivered.includes(privateValue), false);
    }

    const received = join(operator, `received-${i}.signed`);
    await writeFile(received, delivered, { mode: 0o600 });
    const initialize = async ({
      root = localRoot,
      from = received,
      key = trust,
      address = "127.0.0.1",
    } = {}) =>
      JSON.parse(
        (
          await run(process.execPath, [
            runtimeCli,
            "from-handoff",
            root,
            from,
            key,
            address,
          ])
        ).stdout,
      );
    await assert.rejects(
      initialize({ root: join(operator, "unapproved") }),
      /Could not initialize/,
    );
    await assert.rejects(
      initialize({ key: otherTrust }),
      /Could not initialize/,
    );
    assert.ok(!(await readdir(operator)).includes(`runtime-${i}`));
    if (i === 0) {
      const edited = join(operator, "tampered.signed");
      await writeFile(
        edited,
        JSON.stringify({
          ...handoff,
          target: {
            ...handoff.target,
            portal_origin: "https://altered.example.invalid",
          },
        }) + "\n",
        { mode: 0o600 },
      );
      await assert.rejects(
        initialize({ from: edited }),
        /Could not initialize/,
      );
      await chmod(received, 0o644);
      await assert.rejects(initialize(), /Could not initialize/);
      await chmod(received, 0o600);
      const linked = join(operator, "linked.signed");
      await symlink(received, linked);
      await assert.rejects(
        initialize({ from: linked }),
        /Could not initialize/,
      );
      await mkdir(localRoot, { mode: 0o700 });
      await writeFile(join(localRoot, "existing.txt"), "retained installation");
      await assert.rejects(initialize(), /Could not initialize/);
      assert.equal(
        await readFile(join(localRoot, "existing.txt"), "utf8"),
        "retained installation",
      );
      await rm(localRoot, { recursive: true });
    }

    assert.deepEqual(await initialize(), { status: "initialized" });
    const runtimeEnv = join(localRoot, "runtime.env");
    const settingsHash = async () =>
      createHash("sha256")
        .update(await readFile(runtimeEnv))
        .digest("hex");
    const before = await settingsHash();
    runtimes.push(before);
    const privateReceiptPath = join(localRoot, "runtime-handoff.json");
    const applied = JSON.parse(readPrivateFixture(privateReceiptPath));
    assert.equal(applied.installation_id, receipt.installation_id);
    assert.equal(applied.source_revision, entry.licence.release_commit);
    for (const directory of ["browser", "data", "backups"])
      assert.deepEqual(await readdir(join(localRoot, directory)), []);
    assert.deepEqual(await initialize(), { status: "already-initialized" });
    await assert.rejects(
      initialize({ address: "192.0.2.17" }),
      /Could not initialize/,
    );
    assert.equal(await settingsHash(), before);
    await unlink(join(localRoot, "runtime.env.notification.env"));
    await assert.rejects(initialize(), /Could not initialize/);
    assert.equal(await settingsHash(), before);
  }
  assert.notEqual(runtimes[0], runtimes[1]);
});
