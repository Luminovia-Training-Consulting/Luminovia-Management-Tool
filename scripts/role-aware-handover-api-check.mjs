/** Actual Auth/REST recipient compensation, immutable receipts and stale consent.
 * Runs only through the canonical disposable API harness. It never reads a
 * private operational policy or changes the test stack's captured policy.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, service, checked, sql, defer, passwordOnly }) => {
  const admin = await actor("recipient-admin", "admin"),
    regular = await actor("recipient-regular", "lecturer"),
    senior = await actor("recipient-senior", "senior_lecturer"),
    candidate = await actor("recipient-candidate", "lecturer");
  const users = [admin.id, regular.id, senior.id, candidate.id],
    org = randomUUID(),
    jobs = [],
    rolePricedJobs = new Set(),
    confirmedCosts = new Map();
  defer(async () => {
    if (jobs.length) {
      const selected = jobs.map(q).join(",");
      await sql(`begin;
create temporary table recipient_qa_runs as select r.id,r.template_id,r.organisation_id from public.course_runs r join public.jobs j on j.course_run_id=r.id where j.id in(${selected});
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
delete from public.organisations where id in(select organisation_id from recipient_qa_runs) and id<>${q(org)};
commit;`);
    }
    await checked(service.from("organisations").delete().eq("id", org));
  });
  await passwordOnly(admin.client);
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
  // Publication and acceptance are separate fixtures: a forecast's open
  // positions cannot be inferred from the number of historical assignments.
  const publish = async ({ capacity = 2, knownNet = false } = {}) => {
    const day = ++sequence * 5;
    const payload = {
      title: "Fictional HTTP personal replacement",
      delivery_type: "online",
      time_zone: "UTC",
      ...(knownNet
        ? {
            customer_name: "Fictional known-net HTTP academy",
            status: "published",
            amount: 123.45,
            total_amount: 123.45,
            currency: "AUD",
          }
        : {
            gross_amount: 777.77,
            gross_total_amount: 777.77,
            currency: "EUR",
          }),
      rate_unit: "fixed_total",
      sessions: Array.from({ length: 3 }, (_, n) => ({
        starts_at: new Date(Date.UTC(2048, 5, day + n, 8)).toISOString(),
        ends_at: new Date(Date.UTC(2048, 5, day + n, 9)).toISOString(),
      })),
      topic_ids: [],
      terms: "Fictional exact personal replacement terms",
      requires_contract: false,
    };
    const job = await checked(
      admin.client.rpc("create_capacity_job", {
        p_payload: payload,
        p_capacity: capacity,
        p_request_id: randomUUID(),
        p_organisation_id: knownNet ? null : org,
        p_platform_percent: null,
      }),
    );
    jobs.push(job);
    if (!knownNet) rolePricedJobs.add(job);
    return job;
  };
  // Track issued net snapshots, including later releases, independently of
  // forecast aggregation or the actor's subsequently changed pricing tier.
  const cents = (amount) => Math.round(Number(amount) * 100);
  const make = async (source, target) => {
    const job = await publish();
    const quote = await ownQuote(source, job);
    const receipt = await checked(
      source.client.rpc("claim_job", {
        p_job_id: job,
        p_idempotency_key: randomUUID(),
        p_terms_version: quote.terms_version,
      }),
    );
    assert.equal(receipt.status, "confirmed");
    confirmedCosts.set(receipt.claim_id, cents(quote.total_amount));
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
  const accept = (who, offer, request = randomUUID()) =>
    checked(
      who.client.rpc("respond_job_substitution", {
        p_offer_id: offer.id,
        p_action: "accept",
        p_quote_hash: offer.quote_hash,
        p_request_id: request,
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
    confirmedCosts.delete(fixture.claim);
    confirmedCosts.set(receipt.claim_id, cents(offer.quote.total_amount));
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
    const request = randomUUID(),
      receipt = await accept(target, offer, request);
    await verifyReceipt(fixture, offer, receipt);
    if (source === regular) {
      await checked(
        target.client.rpc("cancel_job_assignment", {
          p_claim_id: receipt.claim_id,
          p_reason: "Fictional later cancellation before retry",
          p_request_id: randomUUID(),
        }),
      );
      confirmedCosts.delete(receipt.claim_id);
      const scope = [fixture.claim, receipt.claim_id, fixture.job, offer.id]
        .map(q)
        .join(",");
      const snapshot = () =>
        sql(
          `select jsonb_build_object('claims',(select jsonb_agg(to_jsonb(c)order by c.id)from public.job_claims c where job_id=${q(fixture.job)}),'sessions',(select jsonb_agg(to_jsonb(s)order by s.id)from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id=${q(fixture.job)}),'notices',(select jsonb_agg(to_jsonb(n)order by n.id)from public.notifications n where resource_id in(${scope})),'events',(select jsonb_agg(to_jsonb(e)order by e.id)from public.claim_events e where e.claim_id in(${q(fixture.claim)},${q(receipt.claim_id)})))`,
        );
      const cancelled = await snapshot();
      assert.deepEqual(await accept(target, offer, request), {
        status: "cancelled",
        claim_id: receipt.claim_id,
      });
      assert.equal(await snapshot(), cancelled);
      assert.equal(
        (
          await checked(
            target.client
              .from("assignment_sessions")
              .select("id")
              .eq("claim_id", receipt.claim_id)
              .is("released_at", null),
          )
        ).length,
        0,
      );
    }
    if (source === senior) {
      const scope = [fixture.claim, receipt.claim_id, fixture.job, offer.id]
        .map(q)
        .join(",");
      const snapshot = () =>
        sql(
          `select jsonb_build_object('claims',(select jsonb_agg(to_jsonb(c)order by c.id)from public.job_claims c where job_id=${q(fixture.job)}),'sessions',(select jsonb_agg(to_jsonb(s)order by s.id)from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id=${q(fixture.job)}),'notices',(select jsonb_agg(to_jsonb(n)order by n.id)from public.notifications n where resource_id in(${scope})))`,
        );
      const before = await snapshot();
      // The same genuinely issued Auth token must obey current DB roles and
      // activation, even when it already obtained a successful receipt.
      await checked(
        admin.client.rpc("set_account_roles", {
          p_user_id: target.id,
          p_roles: ["participant"],
        }),
      );
      assert.deepEqual(await accept(target, offer, request), {
        status: "not_eligible",
      });
      assert.equal(await snapshot(), before);
      await checked(
        admin.client.rpc("set_account_roles", {
          p_user_id: target.id,
          p_roles: ["lecturer"],
        }),
      );
      await checked(
        admin.client.rpc("set_user_active", {
          p_user_id: target.id,
          p_active: false,
        }),
      );
      const inactive = await target.client.rpc("respond_job_substitution", {
        p_offer_id: offer.id,
        p_action: "accept",
        p_quote_hash: offer.quote_hash,
        p_request_id: request,
        p_accept_terms: true,
      });
      assert.equal(inactive.error?.code, "42501");
      assert.equal(await snapshot(), before);
      await checked(
        admin.client.rpc("set_user_active", {
          p_user_id: target.id,
          p_active: true,
        }),
      );
    }
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
  // Include genuine unclaimed inventory. EUR has captured role-split gross
  // but no determined future lecturer net; AUD is an independently known net
  // offer. Distinct currencies keep the two forecast cases independently testable.
  const openRole = await publish({ capacity: 3 }),
    openKnown = await publish({ knownNet: true });
  const publishedJobs = await checked(
      service.from("jobs").select("id,status,capacity").in("id", jobs),
    ),
    activeClaims = await checked(
      service
        .from("job_claims")
        .select("id,job_id,total_amount")
        .in("job_id", jobs)
        .eq("status", "confirmed"),
    );
  for (const [id, capacity] of [
    [openRole, 3],
    [openKnown, 2],
  ]) {
    assert.deepEqual(
      publishedJobs.find((job) => job.id === id),
      {
        id,
        status: "published",
        capacity,
      },
    );
    assert.equal(activeClaims.filter((claim) => claim.job_id === id).length, 0);
  }
  assert.deepEqual(
    activeClaims
      .map((claim) => [claim.id, cents(claim.total_amount)])
      .sort(([a], [b]) => a.localeCompare(b)),
    [...confirmedCosts].sort(([a], [b]) => a.localeCompare(b)),
    "Only unreleased confirmed receipt snapshots contribute accepted costs",
  );
  const unknownPositions = publishedJobs
      .filter((job) => rolePricedJobs.has(job.id) && job.status === "published")
      .reduce(
        (total, job) =>
          total +
          job.capacity -
          activeClaims.filter((claim) => claim.job_id === job.id).length,
        0,
      ),
    acceptedCents = [...confirmedCosts.values()].reduce(
      (total, amount) => total + amount,
      0,
    );
  const forecast = await checked(
    admin.client.rpc("finance_forecast", {
      p_from: "2048-06-01",
      p_until: "2048-07-01",
      p_pipeline_probability: 0.5,
    }),
  );
  assert.deepEqual(
    forecast.months.map(({ month, currency }) => ({ month, currency })),
    [
      { month: "2048-06-01", currency: "AUD" },
      { month: "2048-06-01", currency: "EUR" },
    ],
  );
  const euro = forecast.months.find((row) => row.currency === "EUR"),
    australian = forecast.months.find((row) => row.currency === "AUD");
  assert.equal(euro.pipeline_cost_unknown_positions, unknownPositions);
  assert.equal(euro.pipeline_lecturer_cost_known, null);
  assert.equal(
    euro.pipeline_gross_known,
    Math.round(77777 * unknownPositions * 0.5) / 100,
    "Current captured customer gross is weighted per remaining position",
  );
  assert.equal(euro.accepted_lecturer_cost, acceptedCents / 100);
  assert.equal(australian.pipeline_cost_unknown_positions, 0);
  assert.equal(australian.pipeline_lecturer_cost_known, 123.45);
  assert.equal(australian.accepted_lecturer_cost, 0);
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
    "PASS actual Auth/password-only authentication/REST: recipient role pricing in both directions, exact net/ledger, source privacy, stale role consent, concurrent promotion and unknown open cost; no operational policy mutation.",
  );
});
