/** Forecast/accepted-amendment integration uses real RPCs in owned UUID databases.
 * Base replay verifies the independent module fallback. Optional exact local
 * Formal Amendments migration fixtures additionally exercise both install orders;
 * they are never fetched, modified or substituted with a synthetic helper here.
 */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

const execute = promisify(execFile);

const bridgeFile = "20261116091032_amendment_aware_finance_forecast.sql";
const bridge = await readFile(
  new URL("../supabase/migrations/" + bridgeFile, import.meta.url),
  "utf8",
);
const fixtureDirectory = process.env.PORTAL_FORECAST_AMENDMENT_FIXTURES;
const modes = ["current_source"];
let modules = [];
// Fixtures are explicit operator-owned source files, never operational policy or
// a remote branch mutation. Print public source hashes to make evidence bounded.
if (fixtureDirectory) {
  const directory = resolve(fixtureDirectory);
  const files = await readdir(directory);
  for (const suffix of [
    "_formal_change_requests.sql",
    "_commissioned_and_customer_amendments.sql",
  ]) {
    const matches = files.filter(
      (file) => /^\d{14}_/.test(file) && file.endsWith(suffix),
    );
    assert.equal(
      matches.length,
      1,
      `One exact actual module required: ${suffix}`,
    );
    const name = matches[0],
      source = await readFile(join(directory, name), "utf8");
    modules.push(source);
    console.log(
      `SOURCE ${name} sha256=${createHash("sha256").update(source).digest("hex")}`,
    );
  }
  modes.push("amendments_first", "forecast_first");
}

for (const mode of modes) {
  await withTestDatabase(
    "amendment_forecast",
    async ({ sql, actor, database, container }) => {
      if (mode === "amendments_first") {
        for (const source of modules) await sql(source);
        await sql(bridge);
      } else if (mode === "forecast_first") {
        await sql(bridge);
        // The initial forecast below executes the absent-module branch before
        // installing amendments into this same database and function identity.
        assert.equal(
          await sql(
            "select to_regprocedure('private.effective_assignment(uuid)') is null",
          ),
          "t",
        );
      }
      let hasAmendments =
        (await sql(
          "select to_regprocedure('private.effective_assignment(uuid)') is not null",
        )) === "t";
      const [admin, manager, teacher, outsider, org] = Array.from(
        { length: 5 },
        randomUUID,
      );
      await sql(`insert into auth.users(id,email)values${[admin, manager, teacher, outsider].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
insert into public.user_roles(user_id,role)values(${q(admin)},'admin'),(${q(manager)},'management'),(${q(teacher)},'lecturer'),(${q(outsider)},'lecturer');
insert into public.organisations(id,name)values(${q(org)},'Fictional effective forecast academy');update public.profiles set display_name='Fictional forecast actor',time_zone='UTC';`);
      const call = (who, expression, aal = "aal1") =>
        actor(who, `select ${expression}`, aal);
      const json = async (...args) => JSON.parse(await call(...args));
      const forecast = (who = admin, aal = "aal1") =>
        json(
          who,
          "public.finance_forecast('2058-01-01','2058-04-01',0.5)",
          aal,
        );
      let checks = 0;
      /** Each named group fails on the actual committed SQL result. */
      const check = async (name, run) => {
        await run();
        checks++;
        console.log(`PASS ${mode}: ${name}`);
      };
      await call(
        admin,
        "public.configure_compensation_policy(37,61,0)",
        "aal1",
      );
      /** Normal online publication/claim captures the original immutable charge. */
      const make = async ({
        currency = "AUD",
        commissioned = true,
        day = 5,
      } = {}) => {
        const payload = {
          title: "Fictional forecast amendment",
          description: "Fictional teaching scope",
          delivery_type: "online",
          location: "https://example.invalid/original",
          time_zone: "UTC",
          currency,
          rate_unit: "per_day",
          terms: "Fictional immutable original agreement",
          requires_contract: false,
          sessions: [0, 1].map((offset) => ({
            starts_at: new Date(
              Date.UTC(2058, 0, day + offset, 8),
            ).toISOString(),
            ends_at: new Date(Date.UTC(2058, 0, day + offset, 9)).toISOString(),
          })),
          topic_ids: [],
          ...(commissioned
            ? { gross_amount: 100, gross_total_amount: 200 }
            : {
                amount: 100,
                total_amount: 200,
                status: "published",
                customer_name: "Fictional no-ledger customer",
              }),
        };
        const job = await call(
          admin,
          commissioned
            ? `public.create_capacity_job(${q(JSON.stringify(payload))},1,${q(randomUUID())},${q(org)},null)`
            : `public.create_job(${q(JSON.stringify(payload))})`,
          "aal1",
        );
        const quote = (await json(teacher, "public.job_offers()")).find(
          (row) => row.id === job,
        );
        assert.ok(quote);
        const claim = await json(
          teacher,
          `public.claim_job(${q(job)},${q(randomUUID())},${quote.terms_version})`,
        );
        assert.equal(claim.status, "confirmed");
        return {
          job,
          claim: claim.claim_id,
          total: Number(quote.total_amount),
        };
      };
      const original = async (fixture) =>
        sql(
          `select jsonb_build_object('claim',(select to_jsonb(c)from public.job_claims c where id=${q(fixture.claim)}),'ledger',(select to_jsonb(l)from private.claim_revenue_ledger l where claim_id=${q(fixture.claim)}))`,
        );
      const fixture = await make();
      const immutableBefore = await original(fixture);

      await check(
        "original accepted fee, currency and original customer charge remain the fallback",
        async () => {
          const result = await forecast(),
            january = result.months.find(
              (row) => row.month === "2058-01-01" && row.currency === "AUD",
            );
          assert.equal(january.accepted_lecturer_cost, 74);
          assert.equal(january.accepted_gross_known, 200);
          assert.equal(january.accepted_margin_known, 126);
          assert.equal(
            result.payment_basis,
            "lecturer_invoice_payment_records",
          );
          assert.equal(await original(fixture), immutableBefore);
        },
      );
      await check(
        "current permission finance boundary and internal helper grants prevent a net oracle",
        async () => {
          await assert.rejects(forecast(teacher), /42501/);
          const adminResult = await forecast(admin, "aal1"),
            adminRow = adminResult.months.find(
              (item) => item.currency === "AUD",
            );
          assert.equal(adminResult.gross_authorized, true);
          assert.equal(adminRow.accepted_gross_known, 200);
          assert.equal(adminRow.accepted_margin_known, 126);
          const result = await forecast(manager),
            row = result.months.find((item) => item.currency === "AUD");
          assert.equal(result.gross_authorized, false);
          assert.equal(row.accepted_lecturer_cost, 74);
          assert.equal(row.accepted_gross_known, null);
          assert.equal(row.accepted_margin_known, null);
          for (const role of ["anon", "authenticated", "service_role"])
            assert.equal(
              await sql(
                `select has_function_privilege(${q(role)},'private.forecast_assignment_total(uuid)','EXECUTE')`,
              ),
              "f",
            );
          await assert.rejects(
            call(
              outsider,
              `private.forecast_assignment_total(${q(fixture.claim)})`,
            ),
            /42501/,
          );
        },
      );
      await check(
        "strict diagnostics validate both bridge functions with optional module SQL",
        async () => {
          // Native postgres intentionally lacks superuser rights. The local
          // operator installs the diagnostic extension only in this owned UUID
          // database; business assertions continue through the tested actors.
          await execute("docker", [
            "exec",
            container,
            "psql",
            "-U",
            "supabase_admin",
            "-d",
            database,
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
            "-c",
            "create extension plpgsql_check with schema extensions",
          ]);
          for (const signature of [
            "private.forecast_assignment_total(uuid)",
            "private.finance_forecast(date,date,numeric)",
          ])
            assert.deepEqual(
              JSON.parse(
                await sql(
                  `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)from extensions.plpgsql_check_function_tb(${q(signature)}::regprocedure)t`,
                ),
              ),
              [],
              signature,
            );
        },
      );

      if (mode === "forecast_first") {
        for (const source of modules) await sql(source);
        hasAmendments = true;
      }
      if (hasAmendments) {
        const view = async (id) =>
          (await json(admin, `public.assignment_changes(${q(id)})`, "aal1"))[0];
        /** Apply real independent manager/lecturer consent with server CAS versions. */
        const amend = async (target, changes) => {
          const id = await call(
            admin,
            `public.save_assignment_change(null,${q(target.claim)},${q(JSON.stringify({ reason: "Fictional explicitly agreed forecast change", changes }))},0,${q(randomUUID())})`,
            "aal1",
          );
          const action = async (kind, who = admin, aal = "aal1") =>
            call(
              who,
              `public.assignment_change_action(${q(id)},${q(kind)},${(await view(id)).version},'',${q(randomUUID())})`,
              aal,
            );
          await action("submit");
          await action("accept");
          await action("accept", teacher, "aal1");
          assert.equal((await view(id)).status, "accepted");
          await action("apply");
          assert.equal((await view(id)).status, "applied");
        };
        await check(
          "accepted price plus schedule amendment moves cost and margin to the active month without rewriting evidence",
          async () => {
            const oldSessions = await sql(
              `select jsonb_agg(to_jsonb(s)order by id)from public.assignment_sessions s where claim_id=${q(fixture.claim)}`,
            );
            await amend(fixture, {
              amount: 41.23,
              total_amount: 82.46,
              sessions: [5, 6].map((day) => ({
                starts_at: `2058-02-${String(day).padStart(2, "0")}T08:00:00Z`,
                ends_at: `2058-02-${String(day).padStart(2, "0")}T09:00:00Z`,
              })),
            });
            const result = await forecast(),
              february = result.months.find(
                (row) => row.month === "2058-02-01" && row.currency === "AUD",
              );
            assert.ok(
              !result.months.some(
                (row) => row.month === "2058-01-01" && row.currency === "AUD",
              ),
            );
            assert.equal(february.accepted_lecturer_cost, 82.46);
            assert.equal(february.accepted_gross_known, 200);
            assert.equal(february.accepted_margin_known, 117.54);
            assert.equal(await original(fixture), immutableBefore);
            const financial = JSON.parse(
              await sql(
                `select to_jsonb(a)from private.assignment_financial_amendments a where claim_id=${q(fixture.claim)}`,
              ),
            );
            assert.equal(financial.lecturer_net_total_amount, 82.46);
            assert.equal(financial.gross_total_amount, 200);
            assert.equal(financial.platform_total_amount, 117.54);
            // Every old session survives exactly; only its release marker changes.
            assert.equal(
              await sql(
                `select jsonb_agg(to_jsonb(s)-'released_at'order by id)from public.assignment_sessions s where claim_id=${q(fixture.claim)}and released_at is not null`,
              ),
              await sql(
                `select jsonb_agg(value-'released_at'order by value->>'id')from jsonb_array_elements(${q(oldSessions)}::jsonb)`,
              ),
            );
            assert.equal(
              await sql(
                `select count(*)from public.assignment_sessions where claim_id=${q(fixture.claim)}and released_at is null`,
              ),
              "2",
            );
          },
        );
        await check(
          "the latest accepted amendment supersedes its predecessor without changing original revenue",
          async () => {
            await amend(fixture, { amount: 45.67, total_amount: 91.34 });
            const row = (await forecast()).months.find(
              (item) => item.month === "2058-02-01" && item.currency === "AUD",
            );
            assert.equal(row.accepted_lecturer_cost, 91.34);
            assert.equal(row.accepted_gross_known, 200);
            assert.equal(row.accepted_margin_known, 108.66);
            assert.equal(
              await sql(
                `select count(*)from private.assignment_amendments where claim_id=${q(fixture.claim)}`,
              ),
              "2",
            );
            assert.equal(await original(fixture), immutableBefore);
          },
        );
        await check(
          "uncommissioned effective net remains separate in its original currency with unknown gross",
          async () => {
            const plain = await make({
                currency: "EUR",
                commissioned: false,
                day: 15,
              }),
              before = await original(plain);
            await amend(plain, { amount: 135.79, total_amount: 271.58 });
            const row = (await forecast()).months.find(
              (item) => item.month === "2058-01-01" && item.currency === "EUR",
            );
            assert.equal(row.accepted_lecturer_cost, 271.58);
            assert.equal(row.unknown_gross_claims, 1);
            assert.equal(row.accepted_gross_known, 0);
            assert.equal(row.accepted_margin_known, 0);
            assert.equal(await original(plain), before);
          },
        );
      } else
        console.log(
          `INFO ${mode}: actual Formal Amendments absent; fallback verified, explicit local module fixtures enable both-order integration`,
        );
      await check(
        "a captured zero regular share confirms online and forecasts zero accepted net with unchanged gross",
        async () => {
          const before = (await forecast()).months.find(
            (row) => row.month === "2058-01-01" && row.currency === "AUD",
          );
          // This explicit fictional policy is a valid product boundary, not a
          // modified claim or hand-built financial snapshot. Capture it through
          // the actual publication and authoritative online claim transaction.
          await call(
            admin,
            "public.configure_compensation_policy(0,61,1)",
            "aal1",
          );
          const zero = await make({ day: 25 });
          assert.equal(zero.total, 0);
          const captured = await original(zero);
          assert.equal(
            await sql(
              `select total_amount from public.job_claims where id=${q(zero.claim)}`,
            ),
            "0.00",
          );
          assert.equal(
            await sql(
              `select lecturer_net_total_amount from private.claim_revenue_ledger where claim_id=${q(zero.claim)}`,
            ),
            "0.00",
          );
          const row = (await forecast()).months.find(
            (item) => item.month === "2058-01-01" && item.currency === "AUD",
          );
          assert.equal(
            row.accepted_lecturer_cost,
            before?.accepted_lecturer_cost ?? 0,
          );
          assert.equal(
            row.accepted_gross_known,
            (before?.accepted_gross_known ?? 0) + 200,
          );
          assert.equal(
            row.accepted_margin_known,
            (before?.accepted_margin_known ?? 0) + 200,
          );
          assert.equal(await original(zero), captured);
        },
      );
      await check(
        "null, negative and nonfinite optional snapshots fail closed without changing the actual installed helper",
        async () => {
          const definition = () =>
            sql(
              "select coalesce(pg_get_functiondef(to_regprocedure('private.effective_assignment(uuid)')),'ABSENT')",
            );
          const before = await definition();
          // Fault injection is confined to an uncommitted test transaction.
          // Every expected SQL error rolls back the temporary helper replacement;
          // actual module files, accepted agreements and ledgers are untouched.
          for (const value of [null, -0.01, "NaN", "Infinity", "-Infinity"])
            await assert.rejects(
              sql(
                `begin;create or replace function private.effective_assignment(p_claim uuid)returns jsonb language sql stable security definer set search_path=''as $fault$select ${q(JSON.stringify({ total_amount: value }))}::jsonb$fault$;select private.forecast_assignment_total(${q(fixture.claim)});rollback;`,
              ),
              /55000/,
            );
          assert.equal(await definition(), before);
          assert.equal(await original(fixture), immutableBefore);
        },
      );
      console.log(
        `Verified ${checks} forecast groups (${mode}); owned disposable database cleanup follows.`,
      );
    },
    mode === "current_source" ? {} : { migrationsThrough: "20261116091030" },
  );
}
