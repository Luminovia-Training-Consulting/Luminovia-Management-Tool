/** Real Auth/REST: non-reserving waitlist and consented full-block substitution. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, service, checked, sql, defer, mfa }) => {
  const original = await actor("handover-original", "lecturer"),
    replacement = await actor("handover-replacement", "lecturer"),
    peer = await actor("handover-peer", "lecturer"),
    participant = await actor("handover-private-peer", "participant"),
    admin = await actor("handover-admin", "admin");
  const users = [
      original.id,
      replacement.id,
      peer.id,
      participant.id,
      admin.id,
    ],
    job = randomUUID(),
    privateJob = randomUUID(),
    topic = randomUUID();
  defer(async () => {
    await sql(`delete from private.job_substitutions where job_id=${q(job)};
    delete from private.job_lifecycle_requests where actor_id in(${users.map(q).join(",")});
    delete from public.notifications where user_id in(${users.map(q).join(",")});
    delete from public.claim_events where claim_id in(select id from public.job_claims where job_id=${q(job)});
    delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id=${q(job)});
    delete from public.chat_rooms where job_id=${q(job)};
    delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id=${q(job)});
    delete from private.claim_revenue_ledger where job_id=${q(job)};
    delete from public.job_claims where job_id=${q(job)};
    delete from public.job_requirements where job_id=${q(job)};
    delete from public.job_sessions where job_id=${q(job)};
    delete from public.jobs where id in(${q(job)},${q(privateJob)});
    delete from public.lecturer_topics where topic_id=${q(topic)};
    delete from public.topics where id=${q(topic)};`);
  });
  // A harmless repeated leave must not become a service-definer job-title or
  // existence oracle. Prove both actual JWT roles have no underlying RLS row
  // and receive exactly the same minimal receipt for private and unknown IDs.
  await checked(
    service.from("jobs").insert({
      id: privateJob,
      title:
        "Fictional confidential draft; never return through waitlist leave",
      customer_name: "Fictional private academy",
      delivery_type: "online",
      status: "draft",
      amount: 1,
      total_amount: 1,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Fictional private draft agreement",
      requires_contract: false,
    }),
  );
  for (const viewer of [peer, participant]) {
    assert.deepEqual(
      await checked(
        viewer.client.from("jobs").select("id,title").eq("id", privateJob),
      ),
      [],
    );
    for (const id of [privateJob, randomUUID()]) {
      assert.deepEqual(
        await checked(
          viewer.client.rpc("set_job_waitlist", {
            p_job_id: id,
            p_join: false,
          }),
        ),
        {
          job_id: id,
          title: "",
          joined: false,
          can_join: false,
          available: false,
        },
      );
    }
  }
  await checked(
    service.from("topics").insert({
      id: topic,
      kind: "topic",
      label_de: "Fiktives API-Vertretungsthema",
      label_en: "Fictional API substitution topic",
    }),
  );
  await checked(
    service.from("lecturer_topics").insert(
      [original.id, replacement.id, peer.id].map((user_id) => ({
        user_id,
        topic_id: topic,
        verified: true,
      })),
    ),
  );
  await checked(
    service.from("jobs").insert({
      id: job,
      title: "Fictional API whole-block substitution",
      customer_name: "Fictional API customer",
      delivery_type: "online",
      location: "https://example.invalid/course",
      status: "published",
      amount: 101,
      total_amount: 505,
      currency: "EUR",
      rate_unit: "per_day",
      terms: "Immutable fictional API assignment terms",
      requires_contract: false,
    }),
  );
  await checked(
    service.from("job_sessions").insert(
      Array.from({ length: 5 }, (_, n) => ({
        job_id: job,
        starts_at: `2048-05-${String(n + 1).padStart(2, "0")}T08:00:00Z`,
        ends_at: `2048-05-${String(n + 1).padStart(2, "0")}T14:00:00Z`,
      })),
    ),
  );
  await checked(
    service.from("job_requirements").insert({ job_id: job, topic_id: topic }),
  );
  const source = await checked(
    original.client.rpc("claim_job", {
      p_job_id: job,
      p_idempotency_key: randomUUID(),
      p_terms_version: 1,
    }),
  );
  assert.equal(source.status, "confirmed");
  const joins = await Promise.all(
    Array.from({ length: 10 }, () =>
      replacement.client.rpc("set_job_waitlist", {
        p_job_id: job,
        p_join: true,
      }),
    ),
  );
  assert.ok(joins.every((r) => !r.error && r.data.joined));
  assert.equal(
    await sql(
      `select count(*) from private.job_waitlist where job_id=${q(job)}`,
    ),
    "1",
  );
  assert.equal(
    await sql(
      `select count(*) from public.assignment_sessions where lecturer_id=${q(replacement.id)}`,
    ),
    "0",
  );
  const candidates = await checked(
    original.client.rpc("substitution_candidates", {
      p_claim_id: source.claim_id,
    }),
  );
  assert.ok(candidates.some((person) => person.id === replacement.id));
  assert.ok(
    candidates.every(
      (person) => Object.keys(person).sort().join(",") === "display_name,id",
    ),
  );
  assert.equal(
    (
      await peer.client.rpc("substitution_candidates", {
        p_claim_id: source.claim_id,
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await admin.client.rpc("substitution_candidates", {
        p_claim_id: source.claim_id,
      })
    ).error?.code,
    "42501",
  );
  await mfa(admin.client);
  assert.ok(
    Array.isArray(
      await checked(
        admin.client.rpc("substitution_candidates", {
          p_claim_id: source.claim_id,
        }),
      ),
    ),
  );
  const args = {
    p_claim_id: source.claim_id,
    p_target_user_id: replacement.id,
    p_reason: "Fictional API substitute requested",
    p_request_id: randomUUID(),
  };
  const offerId = await checked(
    original.client.rpc("propose_job_substitution", args),
  );
  assert.equal(
    await checked(original.client.rpc("propose_job_substitution", args)),
    offerId,
  );
  const offer = (
    await checked(replacement.client.rpc("job_substitutions"))
  ).find((value) => value.id === offerId);
  assert.ok(offer);
  assert.equal(offer.quote.sessions.length, 5);
  assert.equal(offer.quote.total_amount, 505);
  assert.ok(!("contract_id" in offer.quote));
  assert.deepEqual(await checked(peer.client.rpc("job_substitutions")), []);
  const response = {
    p_offer_id: offerId,
    p_action: "accept",
    p_quote_hash: offer.quote_hash,
    p_request_id: randomUUID(),
    p_accept_terms: true,
  };
  assert.equal(
    (await peer.client.rpc("respond_job_substitution", response)).error?.code,
    "42501",
  );
  assert.equal(
    (await admin.client.rpc("respond_job_substitution", response)).error?.code,
    "42501",
  );
  assert.equal(
    (
      await replacement.client.rpc("respond_job_substitution", {
        ...response,
        p_accept_terms: false,
      })
    ).error?.code,
    "22023",
  );
  assert.equal(
    (
      await replacement.client.rpc("respond_job_substitution", {
        ...response,
        p_quote_hash: "forged",
      })
    ).error?.code,
    "22023",
  );
  await checked(
    service
      .from("lecturer_topics")
      .update({ verified: false })
      .eq("user_id", replacement.id)
      .eq("topic_id", topic),
  );
  assert.equal(
    (
      await checked(
        replacement.client.rpc("respond_job_substitution", response),
      )
    ).status,
    "not_eligible",
  );
  assert.equal(
    await sql(
      `select count(*) from public.assignment_sessions where claim_id=${q(source.claim_id)} and released_at is null`,
    ),
    "5",
  );
  await checked(
    service
      .from("lecturer_topics")
      .update({ verified: true })
      .eq("user_id", replacement.id)
      .eq("topic_id", topic),
  );
  const replies = await Promise.all(
    Array.from({ length: 10 }, () =>
      checked(replacement.client.rpc("respond_job_substitution", response)),
    ),
  );
  assert.ok(replies.every((value) => value.status === "confirmed"));
  assert.equal(new Set(replies.map((value) => value.claim_id)).size, 1);
  const claim = replies[0].claim_id;
  const old = await checked(
    original.client
      .from("job_claims")
      .select("status,amount,total_amount,terms")
      .eq("id", source.claim_id)
      .single(),
  );
  assert.deepEqual(old, {
    status: "cancelled",
    amount: 101,
    total_amount: 505,
    terms: "Immutable fictional API assignment terms",
  });
  assert.equal(
    (
      await checked(
        replacement.client
          .from("assignment_sessions")
          .select("id")
          .eq("claim_id", claim)
          .is("released_at", null),
      )
    ).length,
    5,
  );
  assert.equal(
    await sql(
      `select count(*) from private.job_waitlist where job_id=${q(job)} and user_id=${q(replacement.id)}`,
    ),
    "0",
  );
  const room = await sql(
    `select id from public.chat_rooms where job_id=${q(job)}`,
  );
  assert.equal(
    (
      await checked(
        original.client.from("chat_rooms").select("id").eq("id", room),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await checked(
        replacement.client.from("chat_rooms").select("id").eq("id", room),
      )
    ).length,
    1,
  );
  const notice = (
    await checked(replacement.client.rpc("notification_inbox"))
  ).items.find((value) => value.kind === "substitution_closed");
  assert.equal(notice.href, `/jobs?substitution=${offerId}`);
  await checked(
    service.from("profiles").update({ active: false }).eq("id", replacement.id),
  );
  assert.equal(
    (await replacement.client.rpc("job_substitutions")).error?.code,
    "42501",
  );
  console.log(
    "PASS actual Auth/REST waitlist private/unknown minimal receipts, dedup/no allocation, current candidate/MFA/privacy scope, immutable concrete proposal, exact recipient consent, revalidated qualifications, concurrent whole-block transfer, retained net deal, old chat revocation and inactive-token denial.",
  );
});
