/**
 * Echte Auth-/HTTP-Prüfung für private Verfügbarkeit und ausdrücklich geteilte Zeitfenster.
 * Fiktive getrennte Identitäten prüfen bestätigte API-Ergebnisse und negative Zugriffe; keine Browser-Mocks.
 */
/** Real native Auth/MFA/REST availability; never normal or hosted project data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
await withApiFixture(async ({ service, actor, mfa, checked, sql, defer }) => {
  const teacher = await actor("availability-teacher", "lecturer"),
    peer = await actor("availability-peer", "lecturer"),
    admin = await actor("availability-admin", "admin");
  const id = randomUUID(),
    block = randomUUID(),
    jobIds = [];
  let run, template, organisation;
  defer(async () => {
    const owners = [teacher.id, peer.id, admin.id]
      .map((value) => `'${value}'`)
      .join(",");
    await sql(
      `delete from public.lecturer_availability where user_id in(${owners});delete from public.personal_events where user_id in(${owners});delete from public.notifications where user_id in(${owners});`,
    );
    if (jobIds.length) {
      const jobs = jobIds.map((value) => `'${value}'`).join(",");
      await sql(
        `delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id in(${jobs}));delete from public.chat_rooms where job_id in(${jobs});delete from public.claim_events where claim_id in(select id from public.job_claims where job_id in(${jobs}));delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id in(${jobs}));delete from public.job_claims where job_id in(${jobs});delete from public.job_sessions where job_id in(${jobs});delete from public.job_requirements where job_id in(${jobs});delete from public.jobs where id in(${jobs})`,
      );
    }
    if (run) {
      await checked(
        service.from("course_sessions").delete().eq("course_run_id", run),
      );
      await checked(service.from("course_runs").delete().eq("id", run));
    }
    if (template)
      await checked(
        service.from("course_templates").delete().eq("id", template),
      );
    if (organisation)
      await checked(
        service.from("organisations").delete().eq("id", organisation),
      );
  });
  // Eigene Notizen und Fenster bleiben zunächst privat, selbst gegenüber Administration.
  const body = {
    kind: "available",
    starts_at: "2061-05-01T08:00:00Z",
    ends_at: "2061-05-01T09:00:00Z",
    time_zone: "Europe/Berlin",
    notes: "Fictional private note NEVER IN MANAGEMENT",
    share_with_management: false,
  };
  /** Sendet den geprüften Entwurf mit dessen Versions-/Identitätsbezug an die zuständige API. */
  const save = (who, key, payload, version = 0) =>
    who.client.rpc("save_lecturer_availability", {
      p_id: key,
      p_payload: payload,
      p_version: version,
    });
  await checked(save(teacher, id, body), "Create real private availability");
  await checked(
    save(teacher, id, body),
    "Identical actual lost-response retry",
  );
  assert.equal(
    (
      await checked(
        teacher.client.from("lecturer_availability").select("id").eq("id", id),
      )
    ).length,
    1,
  );
  assert.deepEqual(
    await checked(
      peer.client.from("lecturer_availability").select("*").eq("id", id),
    ),
    [],
  );
  assert.deepEqual(
    await checked(
      admin.client.from("lecturer_availability").select("*").eq("id", id),
    ),
    [],
  );
  assert.ok((await save(admin, id, body, 1)).error);
  assert.ok(
    (
      await admin.client.rpc("shared_availability", {
        p_from: "2061-05-01",
        p_to: "2061-06-01",
      })
    ).error,
  );
  // MFA allein teilt keine Kalenderdaten: erst die ausdrückliche Freigabe öffnet die reduzierte Projektion.
  await mfa(admin.client);
  assert.deepEqual(
    await checked(
      admin.client.rpc("shared_availability", {
        p_from: "2061-05-01",
        p_to: "2061-06-01",
      }),
    ),
    [],
  );
  await checked(save(teacher, id, { ...body, share_with_management: true }, 1));
  const shared = await checked(
    admin.client.rpc("shared_availability", {
      p_from: "2061-05-01",
      p_to: "2061-06-01",
    }),
  );
  assert.equal(shared.length, 1);
  assert.equal(shared[0].user_id, teacher.id);
  assert.equal("notes" in shared[0], false);
  assert.equal(JSON.stringify(shared).includes(body.notes), false);
  await checked(save(teacher, id, body, 2));
  assert.deepEqual(
    await checked(
      admin.client.rpc("shared_availability", {
        p_from: "2061-05-01",
        p_to: "2061-06-01",
      }),
    ),
    [],
  );
  assert.equal((await save(teacher, id, body, 1)).error?.code, "40001");
  // Eine private Sperrzeit muss den echten Claim atomar ablehnen, ohne eine Teilzuweisung zu hinterlassen.
  const interval = {
    starts_at: "2061-05-02T08:00:00Z",
    ends_at: "2061-05-02T09:00:00Z",
  };
  await checked(
    save(teacher, block, { ...body, ...interval, kind: "unavailable" }),
  );
  const job = await checked(
    admin.client.rpc("create_job", {
      p_payload: {
        title: "Fictional blocked-time API course",
        customer_name: "Fictional blocked-time API client",
        delivery_type: "online",
        status: "published",
        amount: 100,
        total_amount: 100,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Preserved fictional API terms",
        requires_contract: false,
        sessions: [interval],
      },
    }),
  );
  jobIds.push(job);
  const jobRow = await checked(
    service
      .from("jobs")
      .select("course_run_id,terms_version")
      .eq("id", job)
      .single(),
  );
  run = jobRow.course_run_id;
  const runRow = await checked(
    service
      .from("course_runs")
      .select("template_id,organisation_id")
      .eq("id", run)
      .single(),
  );
  template = runRow.template_id;
  organisation = runRow.organisation_id;
  const claimArgs = {
    p_job_id: job,
    p_idempotency_key: randomUUID(),
    p_terms_version: jobRow.terms_version,
  };
  assert.equal(
    (await checked(teacher.client.rpc("claim_job", claimArgs))).status,
    "conflict",
  );
  assert.deepEqual(
    await checked(service.from("job_claims").select("id").eq("job_id", job)),
    [],
  );
  await checked(
    teacher.client.rpc("remove_lecturer_availability", {
      p_id: block,
      p_version: 1,
    }),
  );
  const accepted = await checked(teacher.client.rpc("claim_job", claimArgs));
  assert.equal(accepted.status, "confirmed");
  assert.equal(
    (
      await save(teacher, randomUUID(), {
        ...body,
        ...interval,
        kind: "unavailable",
      })
    ).error?.code,
    "23P01",
  );
  assert.equal(
    (
      await checked(
        service
          .from("assignment_sessions")
          .select("id")
          .eq("claim_id", accepted.claim_id),
      )
    ).length,
    1,
  );
  assert.ok(
    (
      await teacher.client
        .from("lecturer_availability")
        .update({ user_id: peer.id })
        .eq("id", id)
    ).error,
  );
  // Bereits ausgegebene Tokens dürfen nach tatsächlicher Kontosperrung keine Rechte behalten.
  await checked(
    service.from("profiles").update({ active: false }).eq("id", teacher.id),
  );
  assert.ok(
    (
      await teacher.client.rpc("my_availability", {
        p_from: "2061-05-01",
        p_to: "2061-06-01",
      })
    ).error,
  );
  console.log(
    "PASS: actual Auth/MFA/REST private availability, explicit redacted sharing and withdrawal, version/idempotency/foreign/direct-write boundaries, unavailable claim rollback, removal then confirmed retry, accepted-assignment protection and old-token suspension.",
  );
});
