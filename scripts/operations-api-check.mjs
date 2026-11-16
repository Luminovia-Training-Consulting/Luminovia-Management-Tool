/**
 * Real Auth/HTTP checks for private customer data, reusable courses and actual course runs.
 * Separate fictional identities verify actual API results and denied access; responses are not browser mocks.
 */
import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
if (process.env.PORTAL_TEST_MODE !== "1")
  throw new Error(
    "Operations mutations require the explicit isolated test mode. Use ./portal test.",
  );
process.loadEnvFile(".env.test.local");
const url = process.env.SUPABASE_URL;
assert.ok(
  url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
  "Operations tests only use loopback Supabase",
);
/** Creates a separate SDK client without persistent sessions or automatic session refresh. */
const make = (key) =>
  createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY);
const users = [];
const orgs = [];
const templates = [];
const runs = [];
const jobs = [];
const clients = [];
const tag = randomUUID();
let count = 0;
/** Requires actual SDK success before returning the response data. */
async function checked(request, label) {
  const { data, error } = await request;
  assert.equal(error, null, `${label}: ${error?.message}`);
  return data;
}
/** Creates separate fictional accounts and signs them in through Auth; their IDs belong only to the fixture. */
async function fixture(role) {
  const email = `operations-${role}-${tag}@example.invalid`;
  const result = await checked(
    service.auth.admin.createUser({
      email,
      password: process.env.E2E_PASSWORD,
      email_confirm: true,
    }),
    "Create temporary operation account",
  );
  users.push(result.user.id);
  await checked(
    service.from("user_roles").insert({ user_id: result.user.id, role }),
    "Set temporary role",
  );
  const client = make(process.env.SUPABASE_ANON_KEY);
  clients.push(client);
  await checked(
    client.auth.signInWithPassword({
      email,
      password: process.env.E2E_PASSWORD,
    }),
    "Actual Auth sign-in",
  );
  return { client, id: result.user.id };
}
/** Computes the fixture's current TOTP for the real MFA challenge. */
function code(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/=+$/, "")]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g).map((byte) => Number.parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return ((digest.readUInt32BE(digest.at(-1) & 15) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
/** Runs a named assertion group; any failed assertion must stop the run. */
async function test(name, fn) {
  await fn();
  count++;
  console.log(`PASS ${name}`);
}
try {
  const admin = await fixture("admin"),
    lecturer = await fixture("lecturer"),
    participant = await fixture("participant");
  const base = {
    name: `Fictional operations ${tag}`,
    country: "DE",
    time_zone: "Europe/Berlin",
    city: "Fiktivstadt",
    industry: "Training",
    tags: ["Linux", "Python"],
    private_notes: `Private customer note ${tag}`,
    archived: false,
  };
  await test("AAL1 admin and lecturers cannot mutate customers/courses", async () => {
    assert.ok(
      (
        await admin.client.rpc("save_organisation", {
          p_id: null,
          p_payload: base,
        })
      ).error,
    );
    assert.ok(
      (
        await lecturer.client.rpc("save_course_template", {
          p_id: null,
          p_payload: { title: "Forged" },
        })
      ).error,
    );
    assert.ok(
      (
        await lecturer.client.rpc("save_organisation", {
          p_id: null,
          p_payload: base,
        })
      ).error,
    );
  });
  const factor = await checked(
    admin.client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Operations QA",
    }),
    "Enroll actual admin MFA",
  );
  await checked(
    admin.client.auth.mfa.challengeAndVerify({
      factorId: factor.id,
      code: code(factor.totp.secret),
    }),
    "Verify actual admin MFA",
  );
  let org, contact, template, run, copyRun, job, participantRoom;
  await test("MFA manager creates organisation, private notes and business contact", async () => {
    org = await checked(
      admin.client.rpc("save_organisation", { p_id: null, p_payload: base }),
      "Create organisation",
    );
    orgs.push(org);
    contact = await checked(
      admin.client.rpc("save_organisation_contact", {
        p_id: null,
        p_organisation_id: org,
        p_payload: {
          name: "Fiktive Ansprechperson",
          position: "Kursplanung",
          email: "contact@example.invalid",
          phone: "+490000000",
          notes: `Private contact ${tag}`,
        },
      }),
      "Create private contact",
    );
    const saved = await checked(
      admin.client
        .from("organisation_private_details")
        .select("private_notes")
        .eq("organisation_id", org)
        .single(),
      "Read authorised notes",
    );
    assert.equal(saved.private_notes, base.private_notes);
  });
  await test("Invalid timezone/contact cannot partially commit", async () => {
    assert.ok(
      (
        await admin.client.rpc("save_organisation", {
          p_id: null,
          p_payload: {
            ...base,
            name: `Bad timezone ${tag}`,
            time_zone: "Invalid/Zone",
          },
        })
      ).error,
    );
    assert.equal(
      (
        await checked(
          service
            .from("organisations")
            .select("id")
            .eq("name", `Bad timezone ${tag}`),
          "Check rollback",
        )
      ).length,
      0,
    );
    assert.ok(
      (
        await admin.client.rpc("save_organisation_contact", {
          p_id: null,
          p_organisation_id: org,
          p_payload: { name: "Bad", email: "javascript:invalid" },
        })
      ).error,
    );
  });
  const topic = (
    await checked(
      service.from("topics").select("id").limit(1),
      "Read fixture topic",
    )
  )[0]?.id;
  const course = {
    title: `Fictional course ${tag}`,
    description: "Reusable course description",
    syllabus: 'echo "<script>text only</script>"',
    prerequisites: "Shell basics",
    topic_ids: topic ? [topic] : [],
    archived: false,
  };
  await test("Reusable course template persists syllabus and dynamic topics", async () => {
    template = await checked(
      admin.client.rpc("save_course_template", {
        p_id: null,
        p_payload: course,
      }),
      "Create course template",
    );
    templates.push(template);
    const saved = await checked(
      admin.client
        .from("course_templates")
        .select("syllabus,course_template_topics(*)")
        .eq("id", template)
        .single(),
      "Read template",
    );
    assert.equal(saved.syllabus, course.syllabus);
    assert.equal(saved.course_template_topics.length, course.topic_ids.length);
  });
  const first = new Date(Date.now() + 80 * 86400000);
  first.setUTCHours(8, 0, 0, 0);
  const sessions = [0, 1].map((day) => ({
    starts_at: new Date(+first + day * 86400000).toISOString(),
    ends_at: new Date(+first + day * 86400000 + 5 * 3600000).toISOString(),
  }));
  const runPayload = {
    template_id: template,
    organisation_id: org,
    time_zone: "Europe/Berlin",
    delivery_type: "online",
    venue: "Private course access supplied separately",
    published: false,
    archived: false,
    sessions,
  };
  await test("Draft run, sessions and template denied to unassigned lecturer and participant", async () => {
    run = await checked(
      admin.client.rpc("save_course_run", {
        p_id: null,
        p_payload: runPayload,
      }),
      "Create actual run",
    );
    runs.push(run);
    for (const actor of [lecturer, participant]) {
      assert.equal(
        (
          await checked(
            actor.client.from("course_runs").select("id").eq("id", run),
            "Draft run RLS",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await checked(
            actor.client
              .from("course_templates")
              .select("id")
              .eq("id", template),
            "Draft template RLS",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await checked(
            actor.client
              .from("course_sessions")
              .select("id")
              .eq("course_run_id", run),
            "Draft session RLS",
          )
        ).length,
        0,
      );
    }
  });
  await test("Publication reveals course data without exposing customer contacts or notes", async () => {
    await checked(
      admin.client.rpc("set_course_visibility", {
        p_id: run,
        p_published: true,
        p_archived: false,
      }),
      "Publish course",
    );
    assert.equal(
      (
        await checked(
          lecturer.client
            .from("course_runs")
            .select("*,course_sessions(*)")
            .eq("id", run)
            .single(),
          "Lecturer published catalogue",
        )
      ).course_sessions.length,
      2,
    );
    assert.equal(
      (
        await checked(
          lecturer.client
            .from("organisations")
            .select("name")
            .eq("id", org)
            .single(),
          "Allowed customer identity",
        )
      ).name,
      base.name,
    );
    for (const actor of [lecturer, participant]) {
      assert.equal(
        (
          await checked(
            actor.client
              .from("organisation_contacts")
              .select("*")
              .eq("organisation_id", org),
            "Contact privacy",
          )
        ).length,
        0,
      );
      assert.equal(
        (
          await checked(
            actor.client
              .from("organisation_private_details")
              .select("*")
              .eq("organisation_id", org),
            "Note privacy",
          )
        ).length,
        0,
      );
    }
    assert.equal(
      (
        await checked(
          participant.client.from("course_runs").select("id").eq("id", run),
          "Unenrolled participant privacy",
        )
      ).length,
      0,
    );
  });
  await test("Safe template/run copies omit assignments, contracts and chat members", async () => {
    const copyTemplate = await checked(
      admin.client.rpc("duplicate_course_template", {
        p_id: template,
        p_title: `Safe copy ${tag}`,
      }),
      "Duplicate template",
    );
    templates.push(copyTemplate);
    assert.equal(
      (
        await checked(
          service
            .from("course_templates")
            .select("syllabus")
            .eq("id", copyTemplate)
            .single(),
          "Read template copy",
        )
      ).syllabus,
      course.syllabus,
    );
    copyRun = await checked(
      admin.client.rpc("duplicate_course_run", { p_id: run }),
      "Duplicate run",
    );
    runs.push(copyRun);
    const copied = await checked(
      service
        .from("course_runs")
        .select("published,course_sessions(*)")
        .eq("id", copyRun)
        .single(),
      "Read unpublished run copy",
    );
    assert.equal(copied.published, false);
    assert.equal(copied.course_sessions.length, 2);
    assert.equal(
      (
        await checked(
          service.from("jobs").select("id").eq("course_run_id", copyRun),
          "No copied jobs",
        )
      ).length,
      0,
    );
    assert.equal(
      (
        await checked(
          lecturer.client.from("course_runs").select("id").eq("id", copyRun),
          "Unpublished copy privacy",
        )
      ).length,
      0,
    );
  });
  await test("Overlapping sessions roll back the entire existing schedule change", async () => {
    const before = await checked(
      service
        .from("course_sessions")
        .select("id,starts_at,ends_at")
        .eq("course_run_id", copyRun)
        .order("starts_at"),
      "Read complete schedule",
    );
    assert.ok(
      (
        await admin.client.rpc("save_course_run", {
          p_id: copyRun,
          p_payload: { ...runPayload, sessions: [sessions[0], sessions[0]] },
        })
      ).error,
    );
    const after = await checked(
      service
        .from("course_sessions")
        .select("id,starts_at,ends_at")
        .eq("course_run_id", copyRun)
        .order("starts_at"),
      "Read rolled-back schedule",
    );
    assert.deepEqual(after, before);
  });
  await test("Confirmed assignment freezes linked course schedule and accepted commercial deal", async () => {
    job = randomUUID();
    jobs.push(job);
    await checked(
      service.from("jobs").insert({
        id: job,
        course_run_id: run,
        title: `Bound assignment ${tag}`,
        description: "Fictional accepted assignment",
        customer_name: base.name,
        delivery_type: "online",
        location: "Online",
        time_zone: "Europe/Berlin",
        status: "published",
        amount: 500,
        total_amount: 1000,
        currency: "EUR",
        rate_unit: "per_day",
        terms: "Fixed accepted terms",
        terms_version: 1,
        requires_contract: false,
        created_by: admin.id,
      }),
      "Create scoped job",
    );
    const courseSessions = await checked(
      service.from("course_sessions").select("*").eq("course_run_id", run),
      "Get bound sessions",
    );
    await checked(
      service.from("job_sessions").insert(
        courseSessions.map((s) => ({
          job_id: job,
          course_session_id: s.id,
          starts_at: s.starts_at,
          ends_at: s.ends_at,
        })),
      ),
      "Link job sessions",
    );
    const claim = await checked(
      lecturer.client.rpc("claim_job", {
        p_job_id: job,
        p_idempotency_key: randomUUID(),
        p_terms_version: 1,
      }),
      "Claim full block",
    );
    assert.equal(claim.status, "confirmed");
    assert.equal(
      (
        await admin.client.rpc("save_course_run", {
          p_id: run,
          p_payload: { ...runPayload, venue: "Silent retiming" },
        })
      ).error?.message,
      "course_locked",
    );
    assert.equal(
      (
        await admin.client.rpc("save_course_template", {
          p_id: template,
          p_payload: { ...course, title: "Silently altered course" },
        })
      ).error?.message,
      "course_locked",
    );
    assert.ok(
      (
        await admin.client.rpc("set_course_visibility", {
          p_id: run,
          p_published: false,
          p_archived: true,
        })
      ).error,
    );
    const saved = await checked(
      lecturer.client
        .from("job_claims")
        .select("total_amount,terms")
        .eq("id", claim.claim_id)
        .single(),
      "Check immutable accepted offer",
    );
    assert.equal(Number(saved.total_amount), 1000);
    assert.equal(saved.terms, "Fixed accepted terms");
  });
  await test("Participant course membership grants only its course and revocation removes it", async () => {
    participantRoom = await checked(
      admin.client.rpc("create_chat_group", {
        p_title: `Participant ${tag}`,
        p_member_ids: [participant.id],
        p_kind: "participant_course",
        p_job_id: job,
      }),
      "Create explicit course membership",
    );
    assert.equal(
      (
        await checked(
          participant.client.from("course_runs").select("id").eq("id", run),
          "Enrolled course",
        )
      ).length,
      1,
    );
    assert.equal(
      (
        await checked(
          participant.client.from("jobs").select("id").eq("id", job),
          "Commercial job hidden",
        )
      ).length,
      0,
    );
    await checked(
      admin.client.rpc("manage_chat_member", {
        p_room_id: participantRoom,
        p_user_id: participant.id,
        p_remove: true,
      }),
      "Revoke explicit membership",
    );
    assert.equal(
      (
        await checked(
          participant.client.from("course_runs").select("id").eq("id", run),
          "Revoked course",
        )
      ).length,
      0,
    );
  });
  await test("Contact updates/archive and organisation archive are recoverable and audited", async () => {
    await checked(
      admin.client.rpc("save_organisation_contact", {
        p_id: contact,
        p_organisation_id: org,
        p_payload: {
          name: "Updated contact",
          position: "Planning",
          email: "updated@example.invalid",
          phone: "",
          notes: "Updated private note",
          archived: true,
        },
      }),
      "Archive contact",
    );
    assert.ok(
      (
        await checked(
          admin.client
            .from("organisation_contacts")
            .select("archived_at")
            .eq("id", contact)
            .single(),
          "Read archive",
        )
      ).archived_at,
    );
    await checked(
      admin.client.rpc("save_organisation", {
        p_id: org,
        p_payload: { ...base, archived: true },
      }),
      "Archive directory entity",
    );
    await checked(
      admin.client.rpc("save_organisation", {
        p_id: org,
        p_payload: { ...base, archived: false },
      }),
      "Restore directory entity",
    );
    assert.equal(
      (
        await checked(
          admin.client
            .from("organisations")
            .select("archived_at")
            .eq("id", org)
            .single(),
          "Read restored",
        )
      ).archived_at,
      null,
    );
    const audit = await checked(
      service
        .from("audit_events")
        .select("action,details")
        .eq("actor_id", admin.id),
      "Read operation audit",
    );
    assert.ok(audit.length >= 9);
    assert.ok(
      !JSON.stringify(audit).includes(base.private_notes),
      "Audit metadata does not duplicate private note text",
    );
  });
  console.log(
    `PASS: ${count} real operations API cases; actual MFA, private customer/contact boundaries, reusable content, safe copies, publication/enrolment/revocation and immutable accepted course blocks.`,
  );
} finally {
  if (jobs.length) {
    const claims = await checked(
      service.from("job_claims").select("id").in("job_id", jobs),
      "Find temporary claims",
    );
    const ids = claims.map((c) => c.id);
    if (ids.length) {
      await checked(
        service.from("assignment_sessions").delete().in("claim_id", ids),
        "Delete only QA allocations",
      );
      await checked(
        service.from("claim_events").delete().in("claim_id", ids),
        "Delete only QA claim events",
      );
      await checked(
        service.from("notifications").delete().in("resource_id", ids),
        "Delete only QA notifications",
      );
      await checked(
        service.from("job_claims").delete().in("id", ids),
        "Delete only QA claims",
      );
    }
    const rooms = await checked(
      service.from("chat_rooms").select("id").in("job_id", jobs),
      "Find temporary course rooms",
    );
    if (rooms.length) {
      await checked(
        service
          .from("chat_members")
          .delete()
          .in(
            "room_id",
            rooms.map((r) => r.id),
          ),
        "Delete QA memberships",
      );
      await checked(
        service
          .from("chat_rooms")
          .delete()
          .in(
            "id",
            rooms.map((r) => r.id),
          ),
        "Delete QA rooms",
      );
    }
    await checked(
      service.from("job_sessions").delete().in("job_id", jobs),
      "Delete QA job sessions",
    );
    await checked(
      service.from("jobs").delete().in("id", jobs),
      "Delete QA jobs",
    );
  }
  if (runs.length) {
    const extraRooms = await checked(
      service.from("chat_rooms").select("id").in("course_run_id", runs),
      "Find scoped participant rooms",
    );
    if (extraRooms.length) {
      await checked(
        service
          .from("chat_members")
          .delete()
          .in(
            "room_id",
            extraRooms.map((r) => r.id),
          ),
        "Delete only scoped participant memberships",
      );
      await checked(
        service
          .from("chat_rooms")
          .delete()
          .in(
            "id",
            extraRooms.map((r) => r.id),
          ),
        "Delete scoped participant rooms",
      );
    }
    await checked(
      service.from("course_sessions").delete().in("course_run_id", runs),
      "Delete QA course sessions",
    );
    await checked(
      service.from("course_runs").delete().in("id", runs),
      "Delete QA course runs",
    );
  }
  if (templates.length)
    await checked(
      service.from("course_templates").delete().in("id", templates),
      "Delete QA templates",
    );
  if (orgs.length)
    await checked(
      service.from("organisations").delete().in("id", orgs),
      "Delete QA organisations",
    );
  if (users.length) {
    await checked(
      service.from("audit_events").delete().in("actor_id", users),
      "Delete only temporary actor audit",
    );
    for (const id of users)
      await checked(
        service.auth.admin.deleteUser(id),
        "Delete temporary operation account",
      );
  }
  for (const client of clients) await client.removeAllChannels();
}
