/** Actual Auth/REST recipient compensation, immutable receipts and stale consent.
 * Runs only through the canonical disposable API harness. It never reads a
 * private operational policy or changes the test stack's captured policy.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, service, checked, sql, defer, mfa }) => {
  const admin = await actor("recipient-admin", "admin"),
    regular = await actor("recipient-regular", "lecturer"),
    senior = await actor("recipient-senior", "senior_lecturer"),
    candidate = await actor("recipient-candidate", "lecturer");
  const users = [admin.id, regular.id, senior.id, candidate.id],
    org = randomUUID(),
    jobs = [];
  defer(async () => {
    if (jobs.length) {
      const selected = jobs.map(q).join(",");
      await sql(`begin;
create temporary table recipient_qa_runs as select r.id,r.template_id from public.course_runs r join public.jobs j on j.course_run_id=r.id where j.id in(${selected});
delete from private.job_substitutions where job_id in(${selected});
delete from private.job_lifecycle_requests where actor_id in(${users.map(q).join(",")});
delete from private.claim_revenue_ledger where job_id in(${selected});
delete from private.job_commission_offers where job_id in(${selected});
delete from private.client_course_requests where requested_by=${q(admin.id)};
delete from public.notifications where user_id in(${users.map(q).join(",")});
delete from public.claim_events where claim_id in(select id from public.job_claims where job_id in(${selected}));
delete from public.chat_members where room_id in(select id from public.chat_rooms where job_id in(${selected}));
delete from public.chat_rooms where job_id in(${selected});
delete from public.assignment_sessions where claim_id in(select id from public.job_claims where job_id in(${selected}));
delete from public.job_claims where job_id in(${selected});
delete from public.job_requirements where job_id in(${selected});
delete from public.job_sessions where job_id in(${selected});
delete from public.jobs where id in(${selected});
delete from public.course_sessions where course_run_id in(select id from recipient_qa_runs);
delete from public.course_runs where id in(select id from recipient_qa_runs);
delete from public.course_template_topics where template_id in(select template_id from recipient_qa_runs);
delete from public.course_templates where id in(select template_id from recipient_qa_runs);
commit;`);
    }
    await checked(service.from("organisations").delete().eq("id", org));
  });
  await mfa(admin.client);
  assert.equal(
    (await checked(admin.client.rpc("commission_access"))).policy_configured,
    true,
    "Canonical test seed must configure its fictional policy",
  );
  await checked(
    service
      .from("organisations")
      .insert({ id: org, name: "Fictional recipient HTTP academy" }),
  );
  let sequence = 0;
  const ownQuote = async (who, job) =>
    (await checked(who.client.rpc("job_offers"))).find((row) => row.id === job);
  const make = async (source, target) => {
    const day = ++sequence * 5;
    const payload = {
      title: "Fictional HTTP personal replacement",
      delivery_type: "online",
      time_zone: "UTC",
      gross_amount: 777.77,
      gross_total_amount: 777.77,
      currency: "EUR",
      rate_unit: "fixed_total",
      sessions: Array.from({ length: 3 }, (_, n) => ({
        starts_at: `2048-06-${String(day + n).padStart(2, "0")}T08:00:00Z`,
        ends_at: `2048-06-${String(day + n).padStart(2, "0")}T09:00:00Z`,
      })),
      topic_ids: [],
      terms: "Fictional exact personal replacement terms",
      requires_contract: false,
    };
    const job = await checked(
      admin.client.rpc("create_capacity_job", {
        p_payload: payload,
        p_capacity: 2,
        p_request_id: randomUUID(),
        p_organisation_id: org,
        p_platform_percent: null,
      }),
    );
    jobs.push(job);
    const quote = await ownQuote(source, job);
    const receipt = await checked(
      source.client.rpc("claim_job", {
        p_job_id: job,
        p_idempotency_key: randomUUID(),
        p_terms_version: quote.terms_version,
      }),
    );
    assert.equal(receipt.status, "confirmed");
    const ledger = await sql(
      `select row_to_json(l)from private.claim_revenue_ledger l where claim_id=${q(receipt.claim_id)}`,
    );
    return {
      job,
      source,
      target,
      claim: receipt.claim_id,
      ledger,
      amount: quote.total_amount,
    };
  };
  const propose = async (fixture) => {
    const id = await checked(
      fixture.source.client.rpc("propose_job_substitution", {
        p_claim_id: fixture.claim,
        p_target_user_id: fixture.target.id,
        p_reason: "Fictional API replacement request",
        p_request_id: randomUUID(),
      }),
    );
    return (await checked(fixture.target.client.rpc("job_substitutions"))).find(
      (row) => row.id === id,
    );
  };
  const accept = (who, offer) =>
    checked(
      who.client.rpc("respond_job_substitution", {
        p_offer_id: offer.id,
        p_action: "accept",
        p_quote_hash: offer.quote_hash,
        p_request_id: randomUUID(),
        p_accept_terms: true,
      }),
    );
  const verifyReceipt = async (fixture, offer, receipt) => {
    assert.equal(receipt.status, "confirmed");
    const actual = await checked(
      fixture.target.client
        .from("job_claims")
        .select("amount,total_amount,currency")
        .eq("id", receipt.claim_id)
        .single(),
    );
    assert.equal(Number(actual.total_amount), Number(offer.quote.total_amount));
    assert.equal(Number(actual.amount), Number(offer.quote.amount));
    assert.equal(
      await sql(
        `select row_to_json(l)from private.claim_revenue_ledger l where claim_id=${q(fixture.claim)}`,
      ),
      fixture.ledger,
    );
    assert.equal(
      await sql(
        `select gross_total_amount=platform_total_amount+lecturer_net_total_amount and lecturer_net_total_amount=${Number(offer.quote.total_amount)} from private.claim_revenue_ledger where claim_id=${q(receipt.claim_id)}`,
      ),
      "t",
    );
    assert.equal(
      (
        await checked(
          fixture.target.client
            .from("assignment_sessions")
            .select("id")
            .eq("claim_id", receipt.claim_id)
            .is("released_at", null),
        )
      ).length,
      3,
    );
    assert.deepEqual(
      await checked(
        fixture.source.client
          .from("job_claims")
          .select("id")
          .eq("id", receipt.claim_id),
      ),
      [],
    );
  };
  for (const [source, target] of [
    [regular, senior],
    [senior, regular],
  ]) {
    const fixture = await make(source, target),
      offer = await propose(fixture),
      expected = await ownQuote(target, fixture.job);
    assert.equal(offer.quote.total_amount, expected.total_amount);
    assert.doesNotMatch(
      JSON.stringify(offer),
      /"(?:gross\w*|\w*percent\w*|pricing_context|policy_version)"\s*:/,
    );
    const sourceView = (
      await checked(
        source.client.rpc("job_substitutions", { p_job_id: fixture.job }),
      )
    ).find((row) => row.id === offer.id);
    assert.equal(sourceView.quote_hash, null);
    assert.equal(sourceView.quote.total_amount, null);
    assert.equal(sourceView.quote.terms, null);
    await verifyReceipt(fixture, offer, await accept(target, offer));
  }
  const stale = await make(regular, candidate),
    oldOffer = await propose(stale);
  await checked(
    admin.client.rpc("set_account_roles", {
      p_user_id: candidate.id,
      p_roles: ["senior_lecturer"],
    }),
  );
  assert.equal((await accept(candidate, oldOffer)).status, "terms_changed");
  assert.equal(
    await sql(
      `select status from public.job_claims where id=${q(stale.claim)}`,
    ),
    "confirmed",
  );
  await checked(
    regular.client.rpc("respond_job_substitution", {
      p_offer_id: oldOffer.id,
      p_action: "withdraw",
      p_quote_hash: null,
      p_request_id: randomUUID(),
      p_accept_terms: false,
    }),
  );
  const refreshed = await propose(stale);
  assert.notEqual(refreshed.quote_hash, oldOffer.quote_hash);
  await verifyReceipt(stale, refreshed, await accept(candidate, refreshed));

  await checked(
    admin.client.rpc("set_account_roles", {
      p_user_id: candidate.id,
      p_roles: ["lecturer"],
    }),
  );
  const race = await make(regular, candidate),
    racedOffer = await propose(race);
  const [receipt] = await Promise.all([
    accept(candidate, racedOffer),
    checked(
      admin.client.rpc("set_account_roles", {
        p_user_id: candidate.id,
        p_roles: ["senior_lecturer"],
      }),
    ),
  ]);
  assert.ok(["confirmed", "terms_changed"].includes(receipt.status));
  if (receipt.status === "confirmed")
    await verifyReceipt(race, racedOffer, receipt);
  else
    assert.equal(
      await sql(
        `select status from public.job_claims where id=${q(race.claim)}`,
      ),
      "confirmed",
    );
  const forecast = await checked(
    admin.client.rpc("finance_forecast", {
      p_from: "2048-06-01",
      p_until: "2048-07-01",
      p_pipeline_probability: 0.5,
    }),
  );
  assert.ok(
    forecast.months.some(
      (row) => row.pipeline_cost_unknown_positions >= jobs.length,
    ),
  );
  for (const row of forecast.months.filter(
    (row) => row.pipeline_cost_unknown_positions > 0,
  ))
    assert.equal(row.pipeline_lecturer_cost_known, null);
  assert.ok(forecast.months.some((row) => row.accepted_lecturer_cost > 0));
  assert.equal(
    (
      await regular.client.rpc("finance_forecast", {
        p_from: "2048-06-01",
        p_until: "2048-07-01",
      })
    ).error?.code,
    "42501",
  );
  console.log(
    "PASS actual Auth/MFA/REST: recipient role pricing in both directions, exact net/ledger, source privacy, stale role consent, concurrent promotion and unknown open cost; no operational policy mutation.",
  );
});
