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
/** Creates controlled historical records before the selected migration check. */
async function seed(sql) {
  await sql(
    `insert into auth.users(id,email) values('${admin}','time-admin@example.invalid'),('${teacher}','time-teacher@example.invalid'),('${peer}','time-peer@example.invalid');insert into public.user_roles(user_id,role) values('${admin}','admin'),('${teacher}','lecturer'),('${peer}','lecturer');`,
  );
}
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
};
const scopedCounts = `select jsonb_build_object('organisations',(select count(*) from public.organisations),'templates',(select count(*) from public.course_templates),'runs',(select count(*) from public.course_runs),'jobs',(select count(*) from public.jobs),'sessions',(select count(*) from public.course_sessions),'offers',(select count(*) from public.job_sessions),'audit',(select count(*) from public.audit_events))::text`;

await withTestDatabase("schedule_finite", async ({ sql, actor }) => {
  await seed(sql);
  /** Submits the controlled job as AAL2 management through create_job so real interval constraints apply. */
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
  await check(
    "Course-run RPC preserves six-digit DST-fold instants on metadata-only resave and rejects nonpositive microsecond intervals atomically",
    async () => {
      // Create fictional references through the same public RPC surface as the
      // application; the controlled authenticated actor still needs current AAL2.
      const organisation = await actor(
        admin,
        `select public.save_organisation(null,${quoteSql(JSON.stringify({ name: "Fictional precision academy", time_zone: "Europe/Berlin" }))}::jsonb)`,
        "aal2",
      );
      const template = await actor(
        admin,
        `select public.save_course_template(null,${quoteSql(JSON.stringify({ title: "Fictional precise course", topic_ids: [] }))}::jsonb)`,
        "aal2",
      );
      const initial = {
        template_id: template,
        organisation_id: organisation,
        time_zone: "Europe/Berlin",
        delivery_type: "online",
        venue: "Original fictional venue",
        published: true,
        archived: false,
        sessions: [
          {
            starts_at: "2030-10-27T02:30:37.123456+02:00",
            ends_at: "2030-10-27T02:30:42.654321+01:00",
          },
        ],
      };
      /** Invoke the unchanged public contract without any JavaScript date conversion. */
      const saveRun = (id, values) =>
        actor(
          admin,
          `select public.save_course_run(${id === null ? "null" : quoteSql(id)},${quoteSql(JSON.stringify(values))}::jsonb)`,
          "aal2",
        );
      const run = await saveRun(null, initial);
      /** Format stored PostgreSQL values directly so six digits are not truncated by JS. */
      const storedIntervals = async () =>
        JSON.parse(
          await actor(
            admin,
            `select jsonb_agg(jsonb_build_object(
              'starts_at',to_char(starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
              'ends_at',to_char(ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
              'berlin_start',to_char(starts_at at time zone 'Europe/Berlin','YYYY-MM-DD"T"HH24:MI'),
              'berlin_end',to_char(ends_at at time zone 'Europe/Berlin','YYYY-MM-DD"T"HH24:MI'),
              'microseconds',extract(epoch from (ends_at-starts_at))*1000000
            ) order by starts_at,ends_at)::text from public.course_sessions where course_run_id=${quoteSql(run)}`,
            "aal2",
          ),
        );
      const folded = [
        {
          starts_at: "2030-10-27T00:30:37.123456Z",
          ends_at: "2030-10-27T01:30:42.654321Z",
          berlin_start: "2030-10-27T02:30",
          berlin_end: "2030-10-27T02:30",
          microseconds: 3605530865,
        },
      ];
      assert.deepEqual(await storedIntervals(), folded);
      assert.equal(
        await saveRun(run, { ...initial, venue: "Amended fictional venue" }),
        run,
      );
      assert.deepEqual(await storedIntervals(), folded);
      assert.deepEqual(
        JSON.parse(
          await actor(
            admin,
            `select jsonb_build_object('venue',venue,'zone',time_zone,'published',published)::text from public.course_runs where id=${quoteSql(run)}`,
            "aal2",
          ),
        ),
        {
          zone: "Europe/Berlin",
          venue: "Amended fictional venue",
          published: true,
        },
      );

      const oneMicrosecond = {
        ...initial,
        venue: "One-microsecond fictional fixture",
        sessions: [
          {
            starts_at: "2030-04-01T07:00:00.000000Z",
            ends_at: "2030-04-01T07:00:00.000001Z",
          },
        ],
      };
      assert.equal(await saveRun(run, oneMicrosecond), run);
      assert.deepEqual(await storedIntervals(), [
        {
          ...oneMicrosecond.sessions[0],
          berlin_start: "2030-04-01T09:00",
          berlin_end: "2030-04-01T09:00",
          microseconds: 1,
        },
      ]);

      // A rejected update reaches the real transaction after metadata changes,
      // old-row deletion and a first valid insertion. The complete saved graph,
      // including row IDs and audit history, must nevertheless remain identical.
      const snapshot = () =>
        sql(`select jsonb_build_object(
          'run',(select to_jsonb(r) from public.course_runs r where r.id=${quoteSql(run)}),
          'sessions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.course_sessions s where s.course_run_id=${quoteSql(run)}),
          'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) from public.audit_events a where a.resource_id=${quoteSql(run)})
        )::text`);
      const before = await snapshot();
      for (const ends_at of [
        "2030-10-28T01:00:00.000001Z",
        "2030-10-28T01:00:00.000000Z",
      ]) {
        await assert.rejects(
          saveRun(run, {
            ...oneMicrosecond,
            venue: "Rejected metadata must roll back",
            published: false,
            sessions: [
              initial.sessions[0],
              {
                starts_at: "2030-10-28T01:00:00.000001Z",
                ends_at,
              },
            ],
          }),
          /Invalid or overlapping sessions/,
        );
        assert.equal(await snapshot(), before);
      }
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
  `\n${checks} finite-schedule PostgreSQL checks passed (API rollback, exact course precision, private intervals, validated constraints and old-data refusal).`,
);
