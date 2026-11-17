/**
 * Native Auth/Storage permanent-deletion acceptance in the canonical random QA
 * project. Only freshly created fictional identities/objects are touched. These
 * checks verify actual absence, writer barriers, native identity removal and
 * old-token denial; component fixtures alone cannot establish those properties.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { assertPasswordOnly } from "./testing/password-only.mjs";
if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error("Only isolated ./portal test may run deletion fixtures");
process.loadEnvFile(".env.test.local");
assert.match(
  readFileSync("supabase/config.toml", "utf8"),
  /^project_id\s*=\s*"luminovia-portal-test-[a-f0-9]+"/m,
);
const url = process.env.SUPABASE_URL;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
const origin = process.env.PORTAL_APP_ORIGIN ?? "http://127.0.0.1:5273";
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
  users = [],
  documents = [],
  objects = [],
  leases = [],
  allActors = [],
  organisations = [],
  templates = [],
  runs = [],
  jobs = [];
/** Fail the test at the actual provider error without logging credentials. */
async function checked(request, label) {
  const result = await request;
  assert.equal(
    result.error,
    null,
    `${label}: ${result.error?.code ?? "provider failure"}`,
  );
  return result.data;
}
/** Create an owned native identity; initial role inputs are fixture setup only. */
async function actor(role) {
  const email = `permanent-delete-${randomUUID()}@example.invalid`;
  const { user } = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create fictional account",
  );
  users.push(user.id);
  allActors.push(user.id);
  await checked(
    service.from("user_roles").insert({ user_id: user.id, role }),
    "Assign fictional role",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Native sign-in",
  );
  return { id: user.id, client };
}
/** Confirms password-only sessions have password-only AAL1 and no enrolled factors. */
async function passwordOnly(user) {
  await assertPasswordOnly(user.client);
}
/** Send requests with the current actor's actual native access token. */
async function request(actor, path, body) {
  const { session } = await checked(
    actor.client.auth.getSession(),
    "Read current session",
  );
  const response = await fetch(
    `${url}/functions/v1/accounts/v1/deletions/${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(30000),
    },
  );
  return { status: response.status, body: await response.json() };
}
/** Confirm the exact preview without bypassing the HTTP validation/worker. */
async function confirm(actor, kind, id) {
  const preview = await request(actor, "preview", { kind, id });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(
    preview.body.can_confirm,
    true,
    JSON.stringify(preview.body.blockers),
  );
  return await request(actor, "confirm", {
    plan_id: preview.body.plan_id,
    request_id: randomUUID(),
    confirmation: "DELETE",
  });
}
try {
  const admin = await actor("admin"),
    teacher = await actor("lecturer"),
    peer = await actor("lecturer"),
    unused = await actor("lecturer");
  assert.equal(
    (await request(admin, "preview", { kind: "account", id: unused.id }))
      .status,
    403,
    "Unverified administrator cannot delete",
  );
  await passwordOnly(admin);
  await passwordOnly(peer);
  await passwordOnly(teacher);
  await checked(
    unused.client.rpc("save_profile_details", {
      p_payload: {
        country: "Fictional",
        labels: ["Deletion fixture"],
        languages: [],
        teaching_experience: "Fictional fixture only",
      },
    }),
    "Exercise profile activity before account deletion",
  );
  assert.equal(
    (await request(peer, "preview", { kind: "account", id: unused.id })).status,
    403,
    "Ordinary account cannot delete another account",
  );
  assert.equal(
    (await request(admin, "preview", { kind: "account", id: admin.id })).status,
    403,
    "Self deletion remains protected",
  );

  // Exercise the actual files Edge lease and ClamAV path for version one, then
  // stage a second delayed writer to inspect the barrier without timing sleeps.
  const teacherSession = (
    await checked(teacher.client.auth.getSession(), "Read upload session")
  ).session;
  const fileHeaders = {
    Origin: origin,
    apikey: process.env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${teacherSession.access_token}`,
  };
  const form = new FormData();
  form.set(
    "file",
    new File(
      ["Fictional scanned deletion material."],
      "Fictional deletion.txt",
      { type: "text/plain" },
    ),
  );
  form.set("scope", "personal");
  form.set("kind", "material");
  form.set("client_id", randomUUID());
  const uploaded = await fetch(`${url}/functions/v1/files`, {
    method: "POST",
    headers: fileHeaders,
    body: form,
  });
  const uploadedBody = await uploaded.json();
  assert.equal(uploaded.status, 200, JSON.stringify(uploadedBody));
  assert.equal(uploadedBody.document.status, "clean");
  const firstVersion = await checked(
    service
      .from("document_versions")
      .select("id,object_path")
      .eq("id", uploadedBody.document.current_version_id)
      .single(),
    "Find exact scanned version",
  );
  const first = {
    document_id: uploadedBody.document.id,
    version_id: firstVersion.id,
    object_path: firstVersion.object_path,
  };
  documents.push(first.document_id);
  objects.push(first.object_path);
  const reservation = await checked(
    teacher.client.rpc("reserve_document", {
      p_name: "Fictional later deletion.txt",
      p_mime: "text/plain",
      p_size: 25,
      p_scope: "personal",
      p_kind: "material",
      p_room_id: null,
      p_job_id: null,
      p_client_id: randomUUID(),
      p_replace_id: first.document_id,
      p_owner_id: null,
    }),
    "Reserve actual second version",
  );
  assert.notEqual(reservation.version_id, first.version_id);
  const path = reservation.object_path;
  objects.push(path);
  const lease = await checked(
    service.rpc("deletion_upload_begin", {
      p_document_id: reservation.document_id,
      p_version_id: reservation.version_id,
    }),
    "Start native writer lease",
  );
  leases.push(lease);
  await checked(
    service.storage
      .from("portal-quarantine")
      .upload(path, new TextEncoder().encode("Fictional deletion bytes."), {
        contentType: "text/plain",
      }),
    "Write native quarantine object",
  );
  assert.equal(
    (
      await request(peer, "preview", {
        kind: "document",
        id: reservation.document_id,
      })
    ).status,
    403,
    "Unrelated peer cannot purge private document",
  );
  assert.equal(
    (
      await request(admin, "preview", {
        kind: "document",
        id: reservation.document_id,
      })
    ).status,
    403,
    "Administrator cannot purge another actor's private document",
  );
  const pending = await confirm(teacher, "document", reservation.document_id);
  assert.equal(pending.status, 202, JSON.stringify(pending.body));
  assert.equal(pending.body.status, "pending");
  assert.equal(
    (await service.storage.from("portal-quarantine").info(path)).error,
    null,
    "Active writer barrier prevents premature object removal",
  );
  assert.ok(
    (
      await service.rpc("deletion_upload_begin", {
        p_document_id: reservation.document_id,
        p_version_id: reservation.version_id,
      })
    ).error,
    "Deletion fence rejects new writers",
  );
  // An already-running writer cannot resurrect bytes after this lease drains.
  const promotion = await service.storage
    .from("portal-clean")
    .upload(path, new TextEncoder().encode("Fictional deletion bytes."), {
      contentType: "text/plain",
    });
  if (!promotion.error) objects.push(path);
  await checked(
    service.rpc("deletion_upload_end", { p_lease_id: lease }),
    "Release settled native writer",
  );
  leases.splice(leases.indexOf(lease), 1);
  const deleted = await request(
    teacher,
    `operations/${pending.body.operation_id}`,
    {},
  );
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.status, "completed");
  const oldDownload = await fetch(`${url}/functions/v1/files`, {
    method: "POST",
    headers: { ...fileHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "download",
      id: first.document_id,
      version_id: first.version_id,
    }),
  });
  assert.ok(
    [403, 404].includes(oldDownload.status),
    "Old exact gateway download cannot return deleted bytes",
  );
  for (const bucket of ["portal-clean", "portal-quarantine"]) {
    for (const exactPath of [first.object_path, path]) {
      assert.equal(
        (await service.storage.from(bucket).info(exactPath)).error?.code,
        "NoSuchKey",
        "Exact object is actually absent",
      );
      assert.ok(
        (
          await service.storage
            .from(bucket)
            .upload(exactPath, new TextEncoder().encode("Must never reappear"))
        ).error,
        "Old exact path is fenced after completion",
      );
    }
  }
  assert.deepEqual(
    await checked(
      service.from("documents").select("id").eq("id", reservation.document_id),
      "Check physical document removal",
    ),
    [],
  );
  assert.deepEqual(
    await checked(
      service
        .from("document_versions")
        .select("id")
        .eq("document_id", reservation.document_id),
      "Check all-version removal",
    ),
    [],
  );
  assert.equal(
    (await request(teacher, `operations/${pending.body.operation_id}`, {})).body
      .status,
    "completed",
    "Retry does not recreate removed resource",
  );
  console.log(
    "PASS Native Storage writer barrier, both buckets, physical all-version removal, retry and old-path rejection",
  );

  const oldToken = (
    await checked(unused.client.auth.getSession(), "Capture fixture token")
  ).session.access_token;
  const removedAccount = await confirm(admin, "account", unused.id);
  assert.equal(removedAccount.status, 200, JSON.stringify(removedAccount.body));
  assert.equal(removedAccount.body.status, "completed");
  assert.equal(
    (await service.auth.admin.getUserById(unused.id)).error?.code,
    "user_not_found",
  );
  assert.deepEqual(
    await checked(
      service.from("profiles").select("id").eq("id", unused.id),
      "Check profile absence",
    ),
    [],
  );
  const preservedAudit = await checked(
    service
      .from("audit_events")
      .select("actor_id")
      .eq("resource_id", unused.id)
      .eq("action", "profile.details.saved"),
    "Check reduced activity attribution",
  );
  assert.equal(preservedAudit.length, 1);
  assert.equal(preservedAudit[0].actor_id, null);
  const stale = await fetch(`${url}/functions/v1/accounts/v1/me`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${oldToken}`,
    },
  });
  assert.ok(
    [401, 403].includes(stale.status),
    "Issued token cannot regain application access after native deletion",
  );
  users.splice(users.indexOf(unused.id), 1);
  console.log(
    "PASS Native account hard deletion, actual profile/Auth absence, old-token denial and self/peer protections",
  );

  // Native company authority must reach the same worker through the caller's
  // real JWT, never through an administrative role or a submitted owner ID.
  const company = await actor("client");
  await passwordOnly(company);
  const ownOrganisation = randomUUID(),
    foreignOrganisation = randomUUID();
  const template = randomUUID(),
    ownRun = randomUUID(),
    foreignRun = randomUUID();
  const ownJob = randomUUID(),
    retainedOwnJob = randomUUID(),
    foreignJob = randomUUID();
  organisations.push(ownOrganisation, foreignOrganisation);
  templates.push(template);
  runs.push(ownRun, foreignRun);
  jobs.push(ownJob, retainedOwnJob, foreignJob);
  await checked(
    service.from("organisations").insert([
      {
        id: ownOrganisation,
        name: `Fictional deletion company ${ownOrganisation}`,
      },
      {
        id: foreignOrganisation,
        name: `Fictional other company ${foreignOrganisation}`,
      },
    ]),
    "Create owned company fixtures",
  );
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: "Fictional company deletion template" }),
    "Create owned template",
  );
  await checked(
    service.from("course_runs").insert([
      { id: ownRun, template_id: template, organisation_id: ownOrganisation },
      {
        id: foreignRun,
        template_id: template,
        organisation_id: foreignOrganisation,
      },
    ]),
    "Create authoritative organisation links",
  );
  await checked(
    service.from("jobs").insert(
      [
        { id: ownJob, course_run_id: ownRun },
        { id: retainedOwnJob, course_run_id: ownRun },
        { id: foreignJob, course_run_id: foreignRun },
      ].map((job) => ({
        ...job,
        title: `Fictional company deletion ${job.id}`,
        customer_name: "Fictional display label grants no ownership",
        delivery_type: "online",
        status: "draft",
        amount: 0,
        total_amount: 0,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Fictional test only",
        created_by: admin.id,
      })),
    ),
    "Create owned draft jobs",
  );
  await checked(
    admin.client.rpc("manage_client_organisation", {
      p_user_id: company.id,
      p_organisation_id: ownOrganisation,
      p_remove: false,
    }),
    "Grant actual company membership",
  );
  const companyTargets = await request(company, "resources?kind=job");
  assert.equal(companyTargets.status, 200);
  assert.deepEqual(
    new Set(companyTargets.body.items.map((entry) => entry.id)),
    new Set([ownJob, retainedOwnJob]),
  );
  assert.equal(
    (await request(company, "preview", { kind: "job", id: foreignJob })).status,
    403,
    "Known foreign UUID grants no deletion authority",
  );
  const reviewedCompanyPlan = await request(company, "preview", {
    kind: "job",
    id: retainedOwnJob,
  });
  assert.equal(reviewedCompanyPlan.status, 200);
  assert.equal(reviewedCompanyPlan.body.can_confirm, true);
  const companyDeleted = await confirm(company, "job", ownJob);
  assert.equal(companyDeleted.status, 200, JSON.stringify(companyDeleted.body));
  assert.equal(companyDeleted.body.status, "completed");
  assert.deepEqual(
    await checked(
      service.from("jobs").select("id").eq("id", ownJob),
      "Verify actual company job removal",
    ),
    [],
  );
  assert.equal(
    (
      await checked(
        service.from("jobs").select("id").eq("id", foreignJob),
        "Verify foreign job retained",
      )
    ).length,
    1,
  );
  await checked(
    admin.client.rpc("manage_client_organisation", {
      p_user_id: company.id,
      p_organisation_id: ownOrganisation,
      p_remove: true,
    }),
    "Revoke membership against existing company token",
  );
  assert.equal(
    (
      await request(company, "confirm", {
        plan_id: reviewedCompanyPlan.body.plan_id,
        request_id: randomUUID(),
        confirmation: "DELETE",
      })
    ).status,
    403,
    "Revocation invalidates an already reviewed plan",
  );
  assert.deepEqual(
    (await request(company, "resources?kind=job")).body.items,
    [],
  );
  assert.equal(
    (
      await checked(
        service.from("jobs").select("id").eq("id", retainedOwnJob),
        "Verify refused deletion changes nothing",
      )
    ).length,
    1,
  );
  console.log(
    "PASS Native company-only job discovery/deletion, foreign-ID denial, actual removal and membership revocation against an existing token/plan",
  );
} finally {
  // Owned UUIDs only; failure cleanup never broadens into ordinary data.
  for (const lease of leases)
    await checked(
      service.rpc("deletion_upload_end", { p_lease_id: lease }),
      "Release owned failed-fixture writer",
    );
  for (const bucket of ["portal-clean", "portal-quarantine"])
    if (objects.length)
      await checked(
        service.storage.from(bucket).remove([...new Set(objects)]),
        "Remove owned fixture objects",
      );
  if (documents.length) {
    await checked(
      service
        .from("documents")
        .update({ current_version_id: null })
        .in("id", documents),
      "Detach owned version pointers",
    );
    await checked(
      service.from("document_versions").delete().in("document_id", documents),
      "Remove owned fixture versions",
    );
    await checked(
      service.from("documents").delete().in("id", documents),
      "Remove owned fixture documents",
    );
  }
  if (users.length) {
    if (jobs.length)
      await checked(
        service.from("jobs").delete().in("id", jobs),
        "Remove exact owned job fixtures",
      );
    if (runs.length)
      await checked(
        service.from("course_runs").delete().in("id", runs),
        "Remove exact owned run fixtures",
      );
    if (templates.length)
      await checked(
        service.from("course_templates").delete().in("id", templates),
        "Remove exact owned template fixtures",
      );
    await checked(
      service
        .from("client_organisation_memberships")
        .delete()
        .in("user_id", allActors),
      "Remove owned membership fixtures",
    );
    if (organisations.length)
      await checked(
        service.from("organisations").delete().in("id", organisations),
        "Remove exact owned organisation fixtures",
      );
    await checked(
      service.from("audit_events").delete().in("actor_id", users),
      "Remove owned audit fixtures",
    );
    await checked(
      service.from("audit_events").delete().in("resource_id", allActors),
      "Remove reduced owned activity fixtures",
    );
    for (const id of users)
      await checked(
        service.auth.admin.deleteUser(id, false),
        "Remove owned fixture identity",
      );
  }
}
