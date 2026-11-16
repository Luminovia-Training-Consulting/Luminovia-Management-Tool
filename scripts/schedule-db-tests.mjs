/**
 * PostgreSQL-Regressionsgruppen für endliche Terminintervalle und historische Migrationsgrenzen.
 * Die Testdatenbank spielt echte Migrationen ein; Rollen-/MFA-Claims prüfen den Datenvertrag unabhängig von der UI.
 */
/** Real disposable checks: a scheduling API must never create an infinite
 * booking. Migration rejection retains prior data instead of rewriting work. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";

const admin = "b5000000-0000-4000-8000-000000000001";
const teacher = "b5000000-0000-4000-8000-000000000002";
const peer = "b5000000-0000-4000-8000-000000000003";
const request = "b5000000-0000-4000-8000-000000000004";
const migration = await readFile(
  new URL(
    "../supabase/migrations/20261115180559_finite_schedule_intervals.sql",
    import.meta.url,
  ),
  "utf8",
);
const payload = {
  title: "Fictional finite scheduling audit",
  customer_name: "Fictional temporal audit",
  delivery_type: "online",
  status: "published",
  amount: 100,
  total_amount: 100,
  currency: "EUR",
  rate_unit: "fixed_total",
  terms: "Preserved fictional agreement",
  sessions: [
    { starts_at: "2037-06-01T08:00:00Z", ends_at: "2037-06-01T09:00:00Z" },
    { starts_at: "2037-06-01T09:00:00Z", ends_at: "2037-06-01T10:00:00Z" },
  ],
};
/** Legt gezielt kontrollierte historische Daten vor der jeweiligen Migrationsprüfung an. */
async function seed(sql) {
  await sql(
    `insert into auth.users(id,email) values('${admin}','time-admin@example.invalid'),('${teacher}','time-teacher@example.invalid'),('${peer}','time-peer@example.invalid');insert into public.user_roles(user_id,role) values('${admin}','admin'),('${teacher}','lecturer'),('${peer}','lecturer');`,
  );
}
let checks = 0;
/** Zählt und meldet einen Fall erst, wenn sämtliche zugehörigen Assertions erfolgreich abgeschlossen sind. */
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
};
const scopedCounts = `select jsonb_build_object('organisations',(select count(*) from public.organisations),'templates',(select count(*) from public.course_templates),'runs',(select count(*) from public.course_runs),'jobs',(select count(*) from public.jobs),'sessions',(select count(*) from public.course_sessions),'offers',(select count(*) from public.job_sessions),'audit',(select count(*) from public.audit_events))::text`;

await withTestDatabase("schedule_finite", async ({ sql, actor }) => {
  await seed(sql);
  /** Sendet den kontrollierten Terminauftrag als AAL2-Verwaltung an create_job, damit die echten Intervall-Constraints wirken. */
  const create = async (values = payload) =>
    await actor(
      admin,
      `select public.create_job(${quoteSql(JSON.stringify(values))}::jsonb)`,
      "aal2",
    );
  await check(
    "Legacy job API rejects an infinite final session and rolls back its whole organisation/course/job graph",
    async () => {
      const before = await sql(scopedCounts);
      await assert.rejects(
        create({
          ...payload,
          sessions: [
            { starts_at: "2037-06-01T08:00:00Z", ends_at: "infinity" },
          ],
        }),
        /finite_interval/,
      );
      assert.equal(await sql(scopedCounts), before);
      assert.equal(await sql("select count(*) from public.job_claims"), "0");
      assert.equal(
        await sql("select count(*) from public.assignment_sessions"),
        "0",
      );
    },
  );
  await check(
    "Own private-event inserts and updates reject nonfinite bounds without changing the saved interval",
    async () => {
      await assert.rejects(
        actor(
          peer,
          `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${peer}','Fictional infinite private block','2037-01-01','infinity')`,
        ),
        /finite_interval/,
      );
      const event = await actor(
        peer,
        `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${peer}','Fictional private interval','2037-01-01T08:00Z','2037-01-01T09:00Z') returning id`,
      );
      const before = await sql(
        `select to_jsonb(e)::text from public.personal_events e where id='${event}'`,
      );
      for (const [column, value] of [
        ["starts_at", "-infinity"],
        ["ends_at", "infinity"],
      ])
        await assert.rejects(
          actor(
            peer,
            `update public.personal_events set ${column}='${value}' where id='${event}'`,
          ),
          /finite_interval/,
        );
      assert.equal(
        await sql(
          `select to_jsonb(e)::text from public.personal_events e where id='${event}'`,
        ),
        before,
      );
    },
  );
  await check(
    "Job deadlines reject both infinities while finite and explicitly absent deadlines remain usable",
    async () => {
      for (const claim_deadline of ["infinity", "-infinity"])
        await assert.rejects(
          create({ ...payload, claim_deadline }),
          /finite_claim_deadline/,
        );
      assert.equal(await sql("select count(*) from public.jobs"), "0");
      assert.ok(
        await create({ ...payload, claim_deadline: "2037-05-01T08:00:00Z" }),
      );
      assert.ok(await create({ ...payload, claim_deadline: null }));
    },
  );
  let job, claim;
  await check(
    "Adjacent finite sessions still claim atomically and preserve accepted amount, terms and exact instants",
    async () => {
      job = await create();
      const result = JSON.parse(
        await actor(
          teacher,
          `select public.claim_job('${job}','${request}',1)`,
        ),
      );
      assert.equal(result.status, "confirmed");
      claim = result.claim_id;
      const accepted = JSON.parse(
        await sql(
          `select jsonb_build_object('amount',amount,'total',total_amount,'currency',currency,'terms',terms,'sessions',(select count(*) from public.assignment_sessions where claim_id=c.id),'finite',(select bool_and(isfinite(starts_at) and isfinite(ends_at)) from public.assignment_sessions where claim_id=c.id))::text from public.job_claims c where id='${claim}'`,
        ),
      );
      assert.deepEqual(accepted, {
        amount: 100,
        total: 100,
        currency: "EUR",
        terms: payload.terms,
        sessions: 2,
        finite: true,
      });
      const expected = JSON.parse(
        await sql(
          `select jsonb_agg(jsonb_build_array(starts_at,ends_at) order by starts_at)::text from public.job_sessions where job_id='${job}'`,
        ),
      );
      assert.deepEqual(
        JSON.parse(
          await sql(
            `select jsonb_agg(jsonb_build_array(starts_at,ends_at) order by starts_at)::text from public.assignment_sessions where claim_id='${claim}'`,
          ),
        ),
        expected,
      );
    },
  );
  await check(
    "All five persisted scheduling surfaces reject nonfinite server writes, including published global events",
    async () => {
      const run = await sql(
        `select course_run_id from public.jobs where id='${job}'`,
      );
      const surfaces = [
        ["course_sessions", "course_run_id", `'${run}'`],
        ["job_sessions", "job_id", `'${job}'`],
        ["assignment_sessions", "claim_id,lecturer_id", `'${claim}','${peer}'`],
        [
          "personal_events",
          "user_id,title",
          `'${peer}','Fictional direct event'`,
        ],
        [
          "global_events",
          "title,published",
          "'Fictional published interval',true",
        ],
      ];
      for (const [table, columns, values] of surfaces) {
        for (const [start, end] of [
          ["-infinity", "2036-01-01T10:00Z"],
          ["2038-01-01T08:00Z", "infinity"],
        ])
          await assert.rejects(
            sql(
              `insert into public.${table}(${columns},starts_at,ends_at) values(${values},'${start}','${end}')`,
            ),
            /finite_interval/,
            table,
          );
      }
      assert.equal(
        await sql(
          "select count(*) from pg_constraint where conname in ('course_sessions_finite_interval','job_sessions_finite_interval','assignment_sessions_finite_interval','personal_events_finite_interval','global_events_finite_interval','jobs_finite_claim_deadline') and convalidated",
        ),
        "6",
      );
    },
  );
});

await withTestDatabase(
  "schedule_legacy",
  async ({ sql, actor }) => {
    await seed(sql);
    const job = await actor(
      admin,
      `select public.create_job(${quoteSql(JSON.stringify(payload))}::jsonb)`,
      "aal2",
    );
    const claim = JSON.parse(
      await actor(teacher, `select public.claim_job('${job}','${request}',1)`),
    );
    await actor(
      peer,
      `insert into public.personal_events(user_id,title,starts_at,ends_at) values('${peer}','Fictional legacy invalid interval','2037-01-01T08:00Z','infinity')`,
    );
    await check(
      "Migration refuses preexisting nonfinite data atomically, preserving prior accepted work and requiring explicit review",
      async () => {
        const before = await sql(
          `select jsonb_build_object('claims',(select jsonb_agg(to_jsonb(c)) from public.job_claims c),'assignments',(select jsonb_agg(to_jsonb(a)) from public.assignment_sessions a),'private',(select jsonb_agg(to_jsonb(e)) from public.personal_events e))::text`,
        );
        await assert.rejects(sql(migration), /finite_interval/);
        assert.equal(
          await sql(
            `select jsonb_build_object('claims',(select jsonb_agg(to_jsonb(c)) from public.job_claims c),'assignments',(select jsonb_agg(to_jsonb(a)) from public.assignment_sessions a),'private',(select jsonb_agg(to_jsonb(e)) from public.personal_events e))::text`,
          ),
          before,
        );
        assert.equal(
          await sql(
            "select count(*) from pg_constraint where conname in ('course_sessions_finite_interval','job_sessions_finite_interval','assignment_sessions_finite_interval','personal_events_finite_interval','global_events_finite_interval','jobs_finite_claim_deadline')",
          ),
          "0",
        );
        assert.equal(claim.status, "confirmed");
      },
    );
  },
  { migrationsThrough: "20261115155208" },
);
console.log(
  `\n${checks} finite-schedule PostgreSQL checks passed (API rollback, private intervals, validated constraints and old-data refusal).`,
);
