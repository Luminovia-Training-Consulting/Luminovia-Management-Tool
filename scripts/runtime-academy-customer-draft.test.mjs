import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
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
  const before = await readFile(join(root, ledger));
  assert.equal((await lstat(join(root, ledger))).mode & 0o777, 0o600);
  assert.equal(
    (await previewCustomerAcademyDraft(root, source)).status,
    "approved-draft",
  );
  assert.deepEqual(
    await approveCustomerAcademyDraft(root, source, reviewToken(preview)),
    { ...first, created: false },
  );
  assert.deepEqual(await readFile(join(root, ledger)), before);
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
