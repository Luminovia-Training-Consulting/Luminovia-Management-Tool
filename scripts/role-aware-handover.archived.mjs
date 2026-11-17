/** Historical role-percentage fixture retained for reference only. The portal
 * now uses individually configured lecturer compensation; current behavior is
 * covered by delegated-pricing-db-tests.mjs and replacement-directed-handover-db-tests.mjs.
 * This archived probe is excluded from current acceptance discovery.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase(
  "role_handover",
  async ({ sql, actor }) => {
    const [
      admin,
      manager,
      regularA,
      regularB,
      seniorA,
      seniorB,
      outsider,
      org,
    ] = Array.from({ length: 8 }, randomUUID);
    const users = [
      admin,
      manager,
      regularA,
      regularB,
      seniorA,
      seniorB,
      outsider,
    ];
    await sql(`insert into auth.users(id,email)values${users.map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
insert into public.user_roles(user_id,role)values(${q(admin)},'admin'),(${q(manager)},'management'),(${q(regularA)},'lecturer'),(${q(regularB)},'lecturer'),(${q(seniorA)},'senior_lecturer'),(${q(seniorB)},'senior_lecturer'),(${q(outsider)},'lecturer');
insert into public.organisations(id,name)values(${q(org)},'Fictional recipient pricing academy');update public.profiles set display_name='Fictional integration actor',time_zone='UTC';`);
    const call = (who, name, args = [], aal = "aal1") =>
      actor(who, `select public.${name}(${args.join(",")})`, aal);
    const rpc = async (...args) => JSON.parse(await call(...args));
    // Explicit fictional settings; no product policy is seeded or inferred.
    await rpc(
      admin,
      "configure_compensation_policy",
      ["37", "61", "0"],
      "aal1",
    );
    let sequence = 0,
      checks = 0;
    const check = async (name, run) => {
      await run();
      checks++;
      console.log(`PASS ${name}`);
    };
    const ledger = (id) =>
      sql(
        `select row_to_json(l) from private.claim_revenue_ledger l where claim_id=${q(id)}`,
      );
    const claimFacts = (id) =>
      sql(
        `select jsonb_build_object('amount',amount,'total_amount',total_amount,'currency',currency,'terms',terms,'terms_version',terms_version)from public.job_claims where id=${q(id)}`,
      );
    // Profile/role changes are intentional inputs; business records must remain
    // byte-identical when a historical acceptance retry is no longer allowed.
    const receiptState = (fixture, offer, claim) =>
      sql(
        `select jsonb_build_object('offer',(select to_jsonb(o)from private.job_substitutions o where id=${q(offer.id)}),'claims',(select jsonb_agg(to_jsonb(c)order by c.id)from public.job_claims c where job_id=${q(fixture.job)}),'sessions',(select jsonb_agg(to_jsonb(s)order by s.id)from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id=${q(fixture.job)}),'notices',(select jsonb_agg(to_jsonb(n)order by n.id)from public.notifications n where resource_id in(${[fixture.claim, fixture.job, offer.id, claim].map(q).join(",")})))`,
      );
    const ownOffer = async (who, job) =>
      (await rpc(who, "job_offers")).find((row) => row.id === job);
    const proposal = async (fixture, target = fixture.target) => {
      const id = await call(fixture.source, "propose_job_substitution", [
        q(fixture.claim),
        q(target),
        q("Fictional complete replacement request"),
        q(randomUUID()),
      ]);
      return (await rpc(target, "job_substitutions")).find(
        (row) => row.id === id,
      );
    };
    const accept = (who, offer) =>
      rpc(who, "respond_job_substitution", [
        q(offer.id),
        q("accept"),
        q(offer.quote_hash),
        q(randomUUID()),
        "true",
      ]);
    const make = async (source = regularA, target = seniorB) => {
      const begins = Date.UTC(2048, 0, 1) + ++sequence * 5 * 86400000;
      const payload = {
        title: "Fictional recipient-specific handover",
        delivery_type: "online",
        time_zone: "UTC",
        gross_amount: 100.01,
        gross_total_amount: 100.01,
        currency: "EUR",
        rate_unit: "fixed_total",
        sessions: Array.from({ length: 3 }, (_, n) => ({
          starts_at: new Date(begins + n * 86400000).toISOString(),
          ends_at: new Date(begins + n * 86400000 + 3600000).toISOString(),
        })),
        topic_ids: [],
        terms: "Fictional personal compensation and complete teaching block",
        requires_contract: false,
      };
      const job = await call(
        admin,
        "create_capacity_job",
        [q(JSON.stringify(payload)), "2", q(randomUUID()), q(org), "null"],
        "aal1",
      );
      const quote = await ownOffer(source, job);
      const receipt = await rpc(source, "claim_job", [
        q(job),
        q(randomUUID()),
        quote.terms_version,
      ]);
      assert.equal(receipt.status, "confirmed");
      const result = { job, claim: receipt.claim_id, source, target };
      return {
        ...result,
        oldLedger: await ledger(result.claim),
        oldFacts: await claimFacts(result.claim),
      };
    };

    // Reproduce the prior pending format, then apply only this forward migration.
    const historical = await make();
    const previousOffer = await proposal(historical);
    await sql(
      await readFile(
        new URL(
          "../supabase/migrations/20261116091025_role_aware_handover_and_forecast.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    // Keep released source bytes and exercise the actual additive permission fix.
    await sql(
      await readFile(
        new URL(
          "../supabase/migrations/20261116091026_substitution_withdrawal_permission_recheck.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await sql(
      await readFile(
        new URL(
          "../supabase/migrations/20261116091029_substitution_receipt_current_status.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await sql(
      await readFile(
        new URL(
          "../supabase/migrations/20261116091030_substitution_retry_current_lecturer_authority.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await check(
      "Upgrade closes unsnapshotted pending offers without rewriting accepted facts or revenue",
      async () => {
        assert.equal(
          (await rpc(historical.target, "job_substitutions")).find(
            (row) => row.id === previousOffer.id,
          ).status,
          "superseded",
        );
        assert.equal(await claimFacts(historical.claim), historical.oldFacts);
        assert.equal(await ledger(historical.claim), historical.oldLedger);
      },
    );

    for (const [label, source, target] of [
      ["regular to senior", regularA, seniorB],
      ["senior to regular", seniorA, regularB],
      ["same tier", regularA, regularB],
    ]) {
      await check(
        `${label} consents to the recipient's exact own net, preserving old facts and conserved new revenue`,
        async () => {
          const fixture = await make(source, target),
            offer = await proposal(fixture),
            expected = await ownOffer(target, fixture.job);
          assert.equal(offer.quote.amount, expected.amount);
          assert.equal(offer.quote.total_amount, expected.total_amount);
          assert.equal(offer.quote.terms_version, expected.terms_version);
          assert.doesNotMatch(
            JSON.stringify(offer),
            /"(?:gross\w*|\w*percent\w*|policy_version|pricing_context|role_discriminator)"\s*:/,
          );
          const receipt = await accept(target, offer);
          assert.equal(receipt.status, "confirmed");
          const actual = JSON.parse(await claimFacts(receipt.claim_id));
          assert.equal(actual.amount, offer.quote.amount);
          assert.equal(actual.total_amount, offer.quote.total_amount);
          assert.equal(await claimFacts(fixture.claim), fixture.oldFacts);
          assert.equal(await ledger(fixture.claim), fixture.oldLedger);
          assert.equal(
            await sql(
              `select count(*) from public.assignment_sessions where claim_id=${q(receipt.claim_id)} and released_at is null`,
            ),
            "3",
          );
          assert.equal(
            await sql(
              `select gross_total_amount=platform_total_amount+lecturer_net_total_amount and lecturer_net_total_amount=${Number(offer.quote.total_amount)} from private.claim_revenue_ledger where claim_id=${q(receipt.claim_id)}`,
            ),
            "t",
          );
        },
      );
    }

    await check(
      "Source and operational management receive no recipient price, terms or guessable quote hash",
      async () => {
        const fixture = await make(),
          offer = await proposal(fixture);
        for (const [who, aal] of [
          [fixture.source, "aal1"],
          [manager, "aal1"],
        ]) {
          const projection = (
            await rpc(who, "job_substitutions", [q(fixture.job)], aal)
          ).find((row) => row.id === offer.id);
          assert.equal(projection.quote_hash, null);
          for (const key of [
            "amount",
            "total_amount",
            "currency",
            "rate_unit",
            "terms",
            "terms_version",
          ])
            assert.equal(projection.quote[key], null);
          assert.equal(projection.can_accept, false);
        }
        await assert.rejects(
          call(outsider, "job_substitutions", [q(fixture.job)]),
          /42501/,
        );
        await assert.rejects(
          actor(
            fixture.target,
            `select private.substitution_pricing_context(${q(fixture.claim)},${q(fixture.target)})`,
          ),
          /42501/,
        );
        await assert.rejects(
          actor(fixture.target, "select * from private.job_substitutions"),
          /42501/,
        );
        assert.equal(
          (
            await rpc(admin, "job_substitutions", [q(fixture.job)], "aal1")
          ).find((row) => row.id === offer.id).quote.total_amount,
          offer.quote.total_amount,
        );
      },
    );

    await check(
      "Role change after proposal rejects stale consent before INSERT and leaves source/calendar/ledger intact",
      async () => {
        const fixture = await make(regularA, regularB),
          offer = await proposal(fixture);
        await call(
          admin,
          "set_account_roles",
          [q(regularB), "array['senior_lecturer']"],
          "aal1",
        );
        assert.equal((await accept(regularB, offer)).status, "terms_changed");
        assert.equal(await claimFacts(fixture.claim), fixture.oldFacts);
        assert.equal(await ledger(fixture.claim), fixture.oldLedger);
        assert.equal(
          await sql(
            `select status from public.job_claims where id=${q(fixture.claim)}`,
          ),
          "confirmed",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions where claim_id=${q(fixture.claim)} and released_at is null`,
          ),
          "3",
        );
        await call(regularA, "respond_job_substitution", [
          q(offer.id),
          q("withdraw"),
          "null",
          q(randomUUID()),
          "false",
        ]);
        const fresh = await proposal(fixture);
        assert.notEqual(fresh.quote_hash, offer.quote_hash);
        assert.equal((await accept(regularB, fresh)).status, "confirmed");
        await call(
          admin,
          "set_account_roles",
          [q(regularB), "array['lecturer']"],
          "aal1",
        );
      },
    );

    await check(
      "Captured offer-policy drift invalidates consent while global future policy changes preserve the captured deal",
      async () => {
        const fixture = await make(),
          offer = await proposal(fixture);
        await rpc(
          admin,
          "configure_compensation_policy",
          ["38", "62", "1"],
          "aal1",
        );
        assert.equal((await accept(fixture.target, offer)).status, "confirmed");
        const changed = await make(),
          stale = await proposal(changed);
        await assert.rejects(
          call(
            admin,
            "set_job_commission",
            [q(changed.job), "200", "200", "null"],
            "aal1",
          ),
          /22023/,
        );
        // Superuser-only fault injection tests the independent acceptance fence.
        await sql(
          `update private.job_commission_offers set policy_version=policy_version+1 where job_id=${q(changed.job)}`,
        );
        assert.equal(
          (await accept(changed.target, stale)).status,
          "terms_changed",
        );
        assert.equal(await ledger(changed.claim), changed.oldLedger);
        assert.equal(
          await sql(
            `select status from public.job_claims where id=${q(changed.claim)}`,
          ),
          "confirmed",
        );
      },
    );

    await check(
      "A pre-proposal customer gross mismatch cannot become an authorised replacement contract",
      async () => {
        const fixture = await make();
        await sql(
          `update private.job_commission_offers set gross_amount=gross_amount+1,gross_total_amount=gross_total_amount+1 where job_id=${q(fixture.job)}`,
        );
        const offer = await proposal(fixture);
        assert.equal(
          (await accept(fixture.target, offer)).status,
          "financial_review",
        );
        assert.equal(await ledger(fixture.claim), fixture.oldLedger);
        assert.equal(
          await sql(
            `select status from public.job_claims where id=${q(fixture.claim)}`,
          ),
          "confirmed",
        );
      },
    );

    await check(
      "Concurrent promotion and acceptance serialize to either exact frozen receipt or untouched stale rejection",
      async () => {
        const fixture = await make(regularA, regularB),
          offer = await proposal(fixture);
        const [receipt] = await Promise.all([
          accept(regularB, offer),
          call(
            admin,
            "set_account_roles",
            [q(regularB), "array['senior_lecturer']"],
            "aal1",
          ),
        ]);
        assert.ok(["confirmed", "terms_changed"].includes(receipt.status));
        if (receipt.status === "confirmed")
          assert.equal(
            JSON.parse(await claimFacts(receipt.claim_id)).total_amount,
            offer.quote.total_amount,
          );
        else
          assert.equal(
            await sql(
              `select status from public.job_claims where id=${q(fixture.claim)}`,
            ),
            "confirmed",
          );
        assert.equal(await ledger(fixture.claim), fixture.oldLedger);
        await call(
          admin,
          "set_account_roles",
          [q(regularB), "array['lecturer']"],
          "aal1",
        );
      },
    );

    await check(
      "A foreign manager waiting behind committed role revocation cannot withdraw or mutate an offer",
      async () => {
        const fixture = await make(),
          offer = await proposal(fixture);
        const snapshot = () =>
          sql(
            `select jsonb_build_object('offer',(select to_jsonb(s) from private.job_substitutions s where id=${q(offer.id)}),'claim',(select to_jsonb(c) from public.job_claims c where id=${q(fixture.claim)}),'sessions',(select jsonb_agg(to_jsonb(s) order by s.id)from public.assignment_sessions s where claim_id=${q(fixture.claim)}),'closed_notices',(select count(*)from public.notifications where resource_id=${q(offer.id)} and kind='substitution_closed'),'withdraw_audit',(select count(*)from public.audit_events where resource_id=${q(offer.id)} and action='assignment.substitution_withdraw'))`,
          );
        const before = await snapshot();
        const tag = `handover_revoke_${randomUUID().replaceAll("-", "")}`,
          writeTag = `handover_wait_${randomUUID().replaceAll("-", "")}`;
        const barrier = async (name, condition) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            if (
              (await sql(
                `select exists(select 1 from pg_stat_activity where datname=current_database() and application_name=${q(name)} and ${condition})`,
              )) === "t"
            )
              return;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new Error(
            "The actual PostgreSQL role/profile lock barrier was not observed",
          );
        };
        // Actual account-role RPC holds the target profile FOR UPDATE until its
        // transaction commits; the old committed role is visible before that.
        const revoked = actor(
          admin,
          `set local application_name=${q(tag)};select public.set_account_roles(${q(manager)},array['lecturer']);select pg_sleep(3)`,
          "aal1",
        );
        let writer;
        try {
          await barrier(tag, "wait_event='PgSleep'");
          writer = actor(
            manager,
            `set local application_name=${q(writeTag)};select public.respond_job_substitution(${q(offer.id)},'withdraw',null,${q(randomUUID())},false)`,
            "aal1",
          );
          const settled = Promise.allSettled([revoked, writer]);
          await barrier(writeTag, "wait_event_type='Lock'");
          const results = await settled;
          assert.equal(results[0].status, "fulfilled");
          assert.equal(results[1].status, "rejected");
          assert.match(results[1].reason.message, /42501/);
        } finally {
          await Promise.allSettled([revoked, ...(writer ? [writer] : [])]);
        }
        assert.equal(await snapshot(), before);
        await call(
          admin,
          "set_account_roles",
          [q(manager), "array['management']"],
          "aal1",
        );
      },
    );

    await check(
      "Immutable proposer and source ownership still permit withdrawal without management capability",
      async () => {
        const fixture = await make();
        const id = await call(
          manager,
          "propose_job_substitution",
          [
            q(fixture.claim),
            q(fixture.target),
            q("Fictional owner withdrawal after delegation ends"),
            q(randomUUID()),
          ],
          "aal1",
        );
        await call(
          admin,
          "set_account_roles",
          [q(manager), "array['lecturer']"],
          "aal1",
        );
        assert.equal(
          (
            await rpc(
              manager,
              "respond_job_substitution",
              [q(id), q("withdraw"), "null", q(randomUUID()), "false"],
              "aal1",
            )
          ).status,
          "withdrawn",
        );
        await call(
          admin,
          "set_account_roles",
          [q(manager), "array['management']"],
          "aal1",
        );
        const next = await proposal(fixture);
        assert.equal(
          (
            await rpc(fixture.source, "respond_job_substitution", [
              q(next.id),
              q("withdraw"),
              "null",
              q(randomUUID()),
              "false",
            ])
          ).status,
          "withdrawn",
        );
        assert.equal(await ledger(fixture.claim), fixture.oldLedger);
        assert.equal(
          await sql(
            `select status from public.job_claims where id=${q(fixture.claim)}`,
          ),
          "confirmed",
        );
      },
    );

    await check(
      "A cancelled accepted replacement stays cancelled on exact consent retries without new allocations or notices",
      async () => {
        const fixture = await make(),
          offer = await proposal(fixture),
          key = randomUUID();
        const response = [
          q(offer.id),
          q("accept"),
          q(offer.quote_hash),
          q(key),
          "true",
        ];
        const accepted = await rpc(
          fixture.target,
          "respond_job_substitution",
          response,
        );
        assert.equal(accepted.status, "confirmed");
        await call(fixture.target, "cancel_job_assignment", [
          q(accepted.claim_id),
          q("Fictional later cancellation of accepted replacement"),
          q(randomUUID()),
        ]);
        const scope = [fixture.claim, accepted.claim_id, fixture.job, offer.id]
          .map(q)
          .join(",");
        const snapshot = () =>
          sql(
            `select jsonb_build_object('offer',(select to_jsonb(o)from private.job_substitutions o where id=${q(offer.id)}),'claims',(select jsonb_agg(to_jsonb(c)order by c.id)from public.job_claims c where job_id=${q(fixture.job)}),'sessions',(select jsonb_agg(to_jsonb(s)order by s.id)from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id=${q(fixture.job)}),'notices',(select jsonb_agg(to_jsonb(n)order by n.id)from public.notifications n where resource_id in(${scope})),'audit',(select jsonb_agg(to_jsonb(a)order by a.id)from public.audit_events a where resource_id in(${scope})))`,
          );
        const before = await snapshot();
        const replay = await rpc(
          fixture.target,
          "respond_job_substitution",
          response,
        );
        assert.deepEqual(replay, {
          status: "cancelled",
          claim_id: accepted.claim_id,
        });
        assert.equal(await snapshot(), before);
        assert.equal(
          await sql(
            `select count(*)from public.assignment_sessions where claim_id=${q(accepted.claim_id)}and released_at is null`,
          ),
          "0",
        );
        assert.equal(await ledger(fixture.claim), fixture.oldLedger);
        await assert.rejects(
          call(fixture.target, "respond_job_substitution", [
            q(offer.id),
            q("accept"),
            q("forged"),
            q(key),
            "true",
          ]),
          /22023/,
        );
        await assert.rejects(
          call(fixture.target, "respond_job_substitution", [
            q(offer.id),
            q("accept"),
            q(offer.quote_hash),
            q(key),
            "false",
          ]),
          /22023/,
        );
        assert.equal(await snapshot(), before);
      },
    );

    await check(
      "An active account losing lecturer authority cannot reconfirm an accepted receipt",
      async () => {
        const fixture = await make(),
          offer = await proposal(fixture),
          key = randomUUID();
        const response = [
          q(offer.id),
          q("accept"),
          q(offer.quote_hash),
          q(key),
          "true",
        ];
        const accepted = await rpc(
          fixture.target,
          "respond_job_substitution",
          response,
        );
        assert.equal(accepted.status, "confirmed");
        await call(
          admin,
          "set_account_roles",
          [q(fixture.target), "array['participant']"],
          "aal1",
        );
        const before = await receiptState(fixture, offer, accepted.claim_id);
        assert.deepEqual(
          await rpc(fixture.target, "respond_job_substitution", response),
          { status: "not_eligible" },
        );
        assert.equal(
          await receiptState(fixture, offer, accepted.claim_id),
          before,
        );
        await assert.rejects(
          call(fixture.target, "respond_job_substitution", [
            q(offer.id),
            q("accept"),
            q("forged"),
            q(key),
            "true",
          ]),
          /22023/,
        );
        await assert.rejects(
          call(fixture.target, "respond_job_substitution", [
            q(offer.id),
            q("accept"),
            q(offer.quote_hash),
            q(key),
            "false",
          ]),
          /22023/,
        );
        await call(
          admin,
          "set_account_roles",
          [q(fixture.target), "array['senior_lecturer']"],
          "aal1",
        );
      },
    );

    await check(
      "Suspension denies accepted receipt retries without changing the deal or calendars",
      async () => {
        const fixture = await make(),
          offer = await proposal(fixture),
          key = randomUUID();
        const response = [
          q(offer.id),
          q("accept"),
          q(offer.quote_hash),
          q(key),
          "true",
        ];
        const accepted = await rpc(
          fixture.target,
          "respond_job_substitution",
          response,
        );
        assert.equal(accepted.status, "confirmed");
        await call(
          admin,
          "set_user_active",
          [q(fixture.target), "false"],
          "aal1",
        );
        const before = await receiptState(fixture, offer, accepted.claim_id);
        await assert.rejects(
          call(fixture.target, "respond_job_substitution", response),
          /42501/,
        );
        assert.equal(
          await receiptState(fixture, offer, accepted.claim_id),
          before,
        );
        await call(
          admin,
          "set_user_active",
          [q(fixture.target), "true"],
          "aal1",
        );
      },
    );

    await check(
      "Accepted retries waiting behind role or activation revocation recheck current authority after actual profile locks",
      async () => {
        for (const kind of ["role", "activation"]) {
          const fixture = await make(),
            offer = await proposal(fixture),
            key = randomUUID();
          const response = [
            q(offer.id),
            q("accept"),
            q(offer.quote_hash),
            q(key),
            "true",
          ];
          const accepted = await rpc(
            fixture.target,
            "respond_job_substitution",
            response,
          );
          assert.equal(accepted.status, "confirmed");
          const before = await receiptState(fixture, offer, accepted.claim_id);
          const tag = `retry_revoke_${randomUUID().replaceAll("-", "")}`,
            waiting = `retry_wait_${randomUUID().replaceAll("-", "")}`;
          const mutation =
            kind === "role"
              ? `public.set_account_roles(${q(fixture.target)},array['participant'])`
              : `public.set_user_active(${q(fixture.target)},false)`;
          const revoked = actor(
            admin,
            `set local application_name=${q(tag)};select ${mutation};select pg_sleep(3)`,
            "aal1",
          );
          const barrier = async (name, condition) => {
            for (let attempt = 0; attempt < 100; attempt++) {
              if (
                (await sql(
                  `select exists(select 1 from pg_stat_activity where datname=current_database() and application_name=${q(name)} and ${condition})`,
                )) === "t"
              )
                return;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error(
              "Accepted retry did not reach the actual PostgreSQL revocation barrier",
            );
          };
          let writer;
          try {
            await barrier(tag, "wait_event='PgSleep'");
            writer = actor(
              fixture.target,
              `set local application_name=${q(waiting)};select public.respond_job_substitution(${response.join(",")})`,
            );
            const settled = Promise.allSettled([revoked, writer]);
            await barrier(waiting, "wait_event_type='Lock'");
            const results = await settled;
            assert.equal(results[0].status, "fulfilled");
            if (kind === "role") {
              assert.equal(results[1].status, "fulfilled");
              assert.deepEqual(JSON.parse(results[1].value), {
                status: "not_eligible",
              });
            } else {
              assert.equal(results[1].status, "rejected");
              assert.match(results[1].reason.message, /42501/);
            }
          } finally {
            await Promise.allSettled([revoked, ...(writer ? [writer] : [])]);
          }
          assert.equal(
            await receiptState(fixture, offer, accepted.claim_id),
            before,
          );
          if (kind === "role")
            await call(
              admin,
              "set_account_roles",
              [q(fixture.target), "array['senior_lecturer']"],
              "aal1",
            );
          else
            await call(
              admin,
              "set_user_active",
              [q(fixture.target), "true"],
              "aal1",
            );
        }
      },
    );

    await check(
      "Role-dependent open positions are unknown, never a zero-cost sentinel; accepted costs stay actual",
      async () => {
        for (const who of [admin, manager]) {
          const forecast = await rpc(
            who,
            "finance_forecast",
            [q("2048-01-01"), q("2048-04-01"), "0.5"],
            "aal1",
          );
          assert.ok(
            forecast.months.some(
              (row) => row.pipeline_cost_unknown_positions > 0,
            ),
          );
          for (const row of forecast.months.filter(
            (row) => row.pipeline_cost_unknown_positions > 0,
          ))
            assert.equal(row.pipeline_lecturer_cost_known, null);
          assert.ok(
            forecast.months.some((row) => row.accepted_lecturer_cost > 0),
          );
          assert.doesNotMatch(
            JSON.stringify(forecast),
            /"(?:\w*percent\w*|policy_version|pricing_context)"\s*:/,
          );
          if (who === manager)
            assert.ok(
              forecast.months.every((row) => row.pipeline_gross_known === null),
            );
        }
      },
    );
    console.log(
      `${checks} role-aware handover/forecast PostgreSQL groups passed.`,
    );
  },
  { migrationsThrough: "20261116091024" },
);
