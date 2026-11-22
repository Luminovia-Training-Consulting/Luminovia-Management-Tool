import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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
    action: "initial-trial",
    preceding_licence_sha256: null,
    agreement_reference: "TRIAL-NEUTRAL-01",
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

test("issues from a v1 approved draft, converts a managed trial, renews, and exports the exact recorded envelope", async (t) => {
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
  const trial = await stage(request, "trial.json");
  assert.deepEqual(await readFile(registry), draftBytes);
  await assert.rejects(
    command("issue-licence", trial.path, "ISSUE 0", privateKeyPath),
    /Approval does not match/,
  );
  assert.deepEqual(await readFile(registry), draftBytes);
  const trialReceipt = await issue(trial);
  assert.equal(trialReceipt.tier, "trial");
  assert.equal(trialReceipt.created, true);
  assert.equal(trialReceipt.installation_id, installation);
  assert.equal("envelope" in trialReceipt, false);

  const convert = extend(request, trialReceipt, {
    action: "convert-trial",
    limits: { ...request.limits, seat_count: 50, api_requests_per_minute: 240 },
  });
  const conversion = await issue(await stage(convert, "convert.json"));
  assert.equal(conversion.tier, "licensed");
  const output = await command("export-licence", convert.action_id);
  const signedFile = join(root, output.filename);
  const signedBytes = readPrivateFixture(signedFile);
  assert.deepEqual(await command("export-licence", convert.action_id), output);
  assert.deepEqual(readPrivateFixture(signedFile), signedBytes);
  const envelope = signedBytes.toString("utf8").trim();
  const verified = verifyAcademyLicence(
    envelope,
    keys.publicKey,
    {
      installation_id: installation,
      edition: "customer-managed",
      release_commit: convert.release_commit,
    },
    Date.parse(convert.starts_at),
  );
  assert.equal(verified.state, "active");
  assert.deepEqual(verified.terms.limits, convert.limits);

  const renewal = extend(convert, conversion, {
    release_commit: "b".repeat(40),
    issued_at: "2027-12-20T00:00:00.000Z",
    starts_at: "2027-12-21T00:00:00.000Z",
    expires_at: "2028-12-21T00:00:00.000Z",
    grace_until: "2028-12-28T00:00:00.000Z",
  });
  const renewed = await issue(await stage(renewal));
  assert.equal(renewed.tier, "licensed");
  assert.deepEqual(await issue(trial), { ...trialReceipt, created: false });
  assert.deepEqual(
    (await command("licence-history", request.draft_request_id)).map(
      (entry) => entry.action,
    ),
    ["initial-trial", "convert-trial", "renew"],
  );
  await assert.rejects(
    stage(
      extend(renewal, renewed, {
        action: "convert-trial",
        issued_at: "2028-12-20T00:00:00.000Z",
        starts_at: "2028-12-21T00:00:00.000Z",
        expires_at: "2029-12-21T00:00:00.000Z",
        grace_until: "2029-12-28T00:00:00.000Z",
      }),
    ),
    /unavailable for the current licence tier/,
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
      entry.initial_administrator.username,
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
