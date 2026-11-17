/** Real Auth/password-only authentication/HTTP withdrawal acceptance, restricted to the canonical owned QA stack. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(async ({ service, actor, passwordOnly, sql, defer, checked }) => {
  const teacher = await actor("withdrawal-teacher", "lecturer"),
    peer = await actor("withdrawal-peer", "lecturer"),
    admin = await actor("withdrawal-admin", "admin"),
    manager = await actor("withdrawal-management", "management");
  const users = [teacher, peer, admin, manager].map((item) => item.id);
  const jobs = [];
  // Delete only the explicit fictional resource IDs created by this fixture.
  // Private request ledgers reference claims/accounts and must be removed first.
  defer(async () => {
    const u = users.map((id) => `'${id}'`).join(",");
    await sql(
      `delete from public.notifications where resource_id in(select id from private.assignment_withdrawals where lecturer_id in(${u}));`,
    );
    await sql(`delete from private.assignment_withdrawal_commands where actor_id in(${u});
      delete from private.assignment_withdrawals where lecturer_id in(${u});
      delete from private.job_lifecycle_requests where actor_id in(${u});
      delete from public.notifications where user_id in(${u});`);
    if (jobs.length) {
      const j = jobs.map((id) => `'${id}'`).join(",");
      await sql(`delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id in(${j}));
        delete from public.chat_rooms where job_id in(${j});
        delete from public.claim_events where claim_id in(select id from public.job_claims where job_id in(${j}));
        delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id in(${j}));
        delete from public.job_claims where job_id in(${j});
        delete from public.job_sessions where job_id in(${j});
        delete from public.jobs where id in(${j});`);
    }
  });
  let checks = 0;
  /** Record a group only after its real HTTP assertions complete. */
  const check = async (name, run) => {
    await run();
    console.log(`PASS ${name}`);
    checks++;
  };
  /** Create one complete fictional block and claim it through the lecturer's real Auth token. */
  const assigned = async (days) => {
    const job = randomUUID();
    jobs.push(job);
    await checked(
      service.from("jobs").insert({
        id: job,
        title: "Fictional withdrawal acceptance block",
        customer_name: "Fictional test academy",
        status: "published",
        delivery_type: "online",
        time_zone: "Europe/Berlin",
        amount: 120,
        total_amount: 240,
        currency: "EUR",
        rate_unit: "per_day",
        terms: "Immutable fictional withdrawal terms",
        requires_contract: false,
      }),
      "Create scoped withdrawal offer",
    );
    const start = Date.now() + days * 86400000;
    await checked(
      service.from("job_sessions").insert(
        [0, 1].map((index) => ({
          job_id: job,
          starts_at: new Date(start + index * 86400000).toISOString(),
          ends_at: new Date(start + index * 86400000 + 3600000).toISOString(),
        })),
      ),
      "Create complete withdrawal sessions",
    );
    const claim = await checked(
      teacher.client.rpc("claim_job", {
        p_job_id: job,
        p_idempotency_key: randomUUID(),
        p_terms_version: 1,
      }),
      "Claim complete fixture block through Auth/HTTP",
    );
    assert.equal(claim.status, "confirmed");
    const snapshot = await checked(
      teacher.client
        .from("job_claims")
        .select("*")
        .eq("id", claim.claim_id)
        .single(),
    );
    return { job, claim: claim.claim_id, snapshot };
  };
  /** Read authoritative committed claim/allocation state; no browser state participates. */
  const state = async (fixture) => ({
    claim: await checked(
      teacher.client
        .from("job_claims")
        .select("*")
        .eq("id", fixture.claim)
        .single(),
    ),
    sessions: await checked(
      teacher.client
        .from("assignment_sessions")
        .select("*")
        .eq("claim_id", fixture.claim),
    ),
  });
  const direct = await assigned(30);
  const directRequest = {
    p_claim_id: direct.claim,
    p_reason: "",
    p_request_id: randomUUID(),
  };
  await check(
    "HTTP direct withdrawal is immediate, retry-safe and preserves the accepted deal",
    async () => {
      const receipt = await checked(
        teacher.client.rpc("request_assignment_withdrawal", directRequest),
      );
      assert.equal(receipt.status, "withdrawn");
      assert.deepEqual(
        await checked(
          teacher.client.rpc("request_assignment_withdrawal", directRequest),
        ),
        receipt,
      );
      const actual = await state(direct);
      assert.deepEqual(actual.claim, {
        ...direct.snapshot,
        status: "cancelled",
      });
      assert.equal(actual.sessions.length, 2);
      assert.ok(actual.sessions.every((item) => item.released_at));
      const inbox = await checked(teacher.client.rpc("notification_inbox"));
      const note = inbox.items.find(
        (item) =>
          item.kind === "assignment_withdrawal_withdrawn" &&
          item.href === `/jobs/${direct.job}`,
      );
      assert.equal(note?.href, `/jobs/${direct.job}`);
      assert.equal(
        inbox.items.filter(
          (item) =>
            item.kind === "assignment_withdrawal_withdrawn" &&
            item.href === `/jobs/${direct.job}`,
        ).length,
        1,
      );
    },
  );
  const late = await assigned(3);
  let application;
  const request = {
    p_claim_id: late.claim,
    p_reason: "Fictional reason requiring private review",
    p_request_id: randomUUID(),
  };
  await check(
    "HTTP short notice requires a reason and cannot use the legacy self-cancellation endpoint",
    async () => {
      assert.equal(
        (
          await teacher.client.rpc("request_assignment_withdrawal", {
            ...request,
            p_reason: "",
          })
        ).error?.code,
        "22023",
      );
      assert.equal(
        (
          await teacher.client.rpc("cancel_job_assignment", {
            p_claim_id: late.claim,
            p_reason: "Attempted legacy bypass",
            p_request_id: randomUUID(),
          })
        ).error?.code,
        "22023",
      );
      assert.equal(
        (await peer.client.rpc("request_assignment_withdrawal", request)).error
          ?.code,
        "42501",
      );
      application = await checked(
        teacher.client.rpc("request_assignment_withdrawal", request),
      );
      assert.equal(application.status, "pending");
      assert.deepEqual(
        await checked(
          teacher.client.rpc("request_assignment_withdrawal", request),
        ),
        application,
      );
      const actual = await state(late);
      assert.deepEqual(actual.claim, late.snapshot);
      assert.equal(actual.sessions.length, 2);
      assert.ok(actual.sessions.every((item) => item.released_at === null));
      assert.equal(
        (
          await checked(
            teacher.client.rpc("assignment_withdrawals", {
              p_job_id: late.job,
            }),
          )
        ).claims[0].can_withdraw,
        false,
      );
    },
  );
  await check(
    "HTTP private reasons stay scoped and reviewing requires current Management password-only authentication",
    async () => {
      const peerView = await checked(
        peer.client.rpc("assignment_withdrawals", { p_job_id: late.job }),
      );
      assert.deepEqual(peerView.items, []);
      const decision = {
        p_withdrawal_id: application.id,
        p_approve: true,
        p_reason: "Fictional approved review",
        p_request_id: randomUUID(),
      };
      assert.equal(
        (await teacher.client.rpc("review_assignment_withdrawal", decision))
          .error?.code,
        "42501",
      );
      assert.equal(
        (await admin.client.rpc("review_assignment_withdrawal", decision)).error
          ?.code,
        "42501",
      );
      assert.equal(
        (await manager.client.rpc("review_assignment_withdrawal", decision))
          .error?.code,
        "42501",
      );
      await passwordOnly(manager.client);
      const review = await checked(
        manager.client.rpc("assignment_withdrawals", { p_job_id: late.job }),
      );
      assert.equal(review.items[0].can_review, true);
      assert.equal(review.items[0].reason, request.p_reason);
      const inbox = await checked(manager.client.rpc("notification_inbox"));
      assert.equal(
        inbox.items.find(
          (item) =>
            item.kind === "assignment_withdrawal_requested" &&
            item.href === `/jobs/${late.job}`,
        )?.href,
        `/jobs/${late.job}`,
      );
      assert.deepEqual((await state(late)).claim, late.snapshot);
    },
  );
  await check(
    "HTTP rejection keeps every reserved session and delivers its own inbox receipt",
    async () => {
      const rejection = {
        p_withdrawal_id: application.id,
        p_approve: false,
        p_reason: "Fictional coverage unavailable; assignment retained",
        p_request_id: randomUUID(),
      };
      const receipt = await checked(
        manager.client.rpc("review_assignment_withdrawal", rejection),
      );
      assert.equal(receipt.status, "rejected");
      assert.deepEqual(
        await checked(
          manager.client.rpc("review_assignment_withdrawal", rejection),
        ),
        receipt,
      );
      const actual = await state(late);
      assert.deepEqual(actual.claim, late.snapshot);
      assert.ok(actual.sessions.every((item) => item.released_at === null));
      const own = await checked(
        teacher.client.rpc("assignment_withdrawals", { p_job_id: late.job }),
      );
      assert.equal(own.items[0].review_reason, rejection.p_reason);
      assert.equal(own.claims[0].can_withdraw, true);
      const inbox = await checked(teacher.client.rpc("notification_inbox"));
      assert.equal(
        inbox.items.find(
          (item) =>
            item.kind === "assignment_withdrawal_rejected" &&
            item.href === `/jobs/${late.job}`,
        )?.href,
        `/jobs/${late.job}`,
      );
      assert.equal(
        (
          await manager.client.rpc("review_assignment_withdrawal", {
            ...rejection,
            p_approve: true,
            p_request_id: randomUUID(),
          })
        ).error?.code,
        "40001",
      );
    },
  );
  await check(
    "HTTP a new reviewed application can release the entire unchanged deal once",
    async () => {
      const second = await checked(
        teacher.client.rpc("request_assignment_withdrawal", {
          ...request,
          p_request_id: randomUUID(),
        }),
      );
      assert.notEqual(second.id, application.id);
      await passwordOnly(admin.client);
      const approval = {
        p_withdrawal_id: second.id,
        p_approve: true,
        p_reason: "Fictional replacement coverage confirmed",
        p_request_id: randomUUID(),
      };
      const receipt = await checked(
        admin.client.rpc("review_assignment_withdrawal", approval),
      );
      assert.equal(receipt.status, "approved");
      assert.deepEqual(
        await checked(
          admin.client.rpc("review_assignment_withdrawal", approval),
        ),
        receipt,
      );
      const actual = await state(late);
      assert.deepEqual(actual.claim, { ...late.snapshot, status: "cancelled" });
      assert.ok(actual.sessions.every((item) => item.released_at));
      const inbox = await checked(teacher.client.rpc("notification_inbox"));
      assert.equal(
        inbox.items.find(
          (item) =>
            item.kind === "assignment_withdrawal_approved" &&
            item.href === `/jobs/${late.job}`,
        )?.href,
        `/jobs/${late.job}`,
      );
      const notices = await checked(
        service
          .from("notifications")
          .select("kind")
          .eq("user_id", teacher.id)
          .eq("resource_id", receipt.id),
      );
      assert.equal(
        notices.filter((item) => item.kind === "assignment_withdrawal_approved")
          .length,
        1,
      );
      const job = await checked(
        service.from("jobs").select("status").eq("id", late.job).single(),
      );
      assert.equal(job.status, "draft");
    },
  );
  console.log(`${checks} actual Auth/password-only authentication/HTTP withdrawal groups passed.`);
});
