/** Real disposable PostgreSQL/RLS checks for profiles, enrolment and reviews.
 * The separate profiles-api-check exercises actual Auth and management permission.
 */
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { withMigrationReplayLock } from "./testing/database.mjs";

const container =
  process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
if (
  !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
    container,
  )
)
  throw new Error(
    "Only the named local portal database container is permitted.",
  );
const database = `profiles_test_${randomUUID().replaceAll("-", "")}`;
/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "",
      err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
    );
    child.stdin.end(input);
  });
}
/** Sends SQL to the owned test database and makes every psql error fail the run. */
const sql = (text, name = database) =>
  command(
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      name,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    text,
  );
/** Quotes controlled fixture SQL literals; identifiers have separate validation. */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
const actor = (id, statement, aal = "aal1") =>
  sql(
    `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({ sub: id, aal, role: "authenticated" }))};${statement};commit;`,
  );
const lecturer = randomUUID(),
  peer = randomUUID(),
  admin = randomUUID(),
  student = randomUUID(),
  stranger = randomUUID(),
  client = randomUUID();
const run = randomUUID(),
  org = randomUUID(),
  template = randomUUID();
/** Calls the business database API under the fixture's controlled identity/permission claims. */
const rpc = (who, name, args = [], aal = "aal1") =>
  actor(
    who,
    `select public.${name}(${args.map((x) => (x === null ? "null" : typeof x === "number" || typeof x === "boolean" ? String(x) : quote(x))).join(",")})`,
    aal,
  ).then((x) => {
    try {
      return JSON.parse(x);
    } catch {
      return x;
    }
  });
let checks = 0;
/** Counts and reports a group only after every related assertion has passed. */
const check = async (name, fn) => {
  await fn();
  checks++;
  console.log(`PASS ${name}`);
};
try {
  await sql(`create database ${database}`, "postgres");
  await sql(`create schema auth;create schema extensions;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
  await withMigrationReplayLock(container, async () => {
    for (const file of (
      await readdir(new URL("../supabase/migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await sql(
        await readFile(
          new URL(`../supabase/migrations/${file}`, import.meta.url),
          "utf8",
        ),
      );
  });

  await sql(`insert into auth.users(id) values ${[lecturer, peer, admin, student, stranger, client].map((id) => `('${id}')`).join(",")};
 insert into public.user_roles(user_id,role) values('${lecturer}','lecturer'),('${peer}','lecturer'),('${admin}','admin'),('${student}','participant'),('${stranger}','participant'),('${client}','client');
 update public.profiles set active=true where id='${client}';
 update public.profiles set display_name=case id when '${lecturer}' then 'Fictional Teacher' when '${student}' then 'Private Student Identity' else 'Fictional Other' end,bio_de='Öffentliche Biografie',phone='Private phone';
 insert into public.organisations(id,name) values('${org}','Fictional Academy');
 insert into public.course_templates(id,title) values('${template}','Fictional completed course');
 insert into public.course_runs(id,template_id,organisation_id,published) values('${run}','${template}','${org}',false);
 insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()-interval '2 day',now()-interval '1 day');`);
  /** Creates a controlled actual course assignment so reviews check real participation eligibility. */
  const seedAssignment = async (target, course, starts, ends) => {
    const job = randomUUID(),
      claim = randomUUID();
    await sql(
      `insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,currency,rate_unit,total_amount,terms) values('${job}','${course}','Fictional assignment','Fictional Academy','online','Europe/Berlin','filled',100,'EUR','fixed_total',100,'Fictional terms');insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',${starts},${ends});insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${claim}','${job}','${target}','${randomUUID()}',100,'EUR','fixed_total',100,'Fictional terms',1);insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values('${claim}','${target}',${starts},${ends});`,
    );
    return { job, claim };
  };
  await seedAssignment(
    lecturer,
    run,
    "now()-interval '2 day'",
    "now()-interval '1 day'",
  );
  await check(
    "Own labels/details persist with bounded normalized self-authored data; direct writes denied",
    async () => {
      await rpc(lecturer, "save_profile_details", [
        JSON.stringify({
          country: "Germany",
          languages: ["Deutsch", "English"],
          labels: ["Python", "python", "Mentoring"],
          teaching_experience: "Fictional experience",
        }) + "",
      ]);
      const own = await rpc(lecturer, "own_profile_details");
      assert.equal(own.labels.length, 2);
      assert.equal(own.country, "Germany");
      await assert.rejects(
        rpc(lecturer, "save_profile_details", [
          JSON.stringify({ labels: ["x".repeat(41)] }),
        ]),
        /Invalid labels/,
      );
      await assert.rejects(
        rpc(lecturer, "save_profile_details", [null]),
        /Invalid profile details/,
      );
      await assert.rejects(
        rpc(lecturer, "save_profile_details", [
          JSON.stringify({ country: { forged: "object" } }),
        ]),
        /Invalid profile details/,
      );
      await assert.rejects(
        rpc(lecturer, "save_profile_details", [
          JSON.stringify({ role: "admin" }),
        ]),
        /Invalid profile details/,
      );
      await assert.rejects(
        actor(
          lecturer,
          `update public.profile_details set labels=array['Admin'] where user_id='${peer}'`,
        ),
        /permission denied/,
      );
    },
  );
  await check(
    "Staff directory/profile intentionally share authored fields but exclude contact and money",
    async () => {
      const people = await rpc(peer, "people_directory", ["", "Python"]);
      assert.equal(people.length, 1);
      assert.equal(people[0].id, lecturer);
      assert.equal("phone" in people[0], false);
      assert.equal("email" in people[0], false);
      assert.equal("amount" in people[0], false);
      const profile = await rpc(peer, "person_profile", [lecturer]);
      assert.equal(profile.teaching_experience, "Fictional experience");
      assert.equal("phone" in profile, false);
      assert.deepEqual(await rpc(stranger, "people_directory"), []);
      await assert.rejects(
        rpc(stranger, "person_profile", [lecturer]),
        /access denied/,
      );
    },
  );
  await check(
    "Course history uses real accepted session instants for current/upcoming/past and contains no rates",
    async () => {
      for (const [state, start, end] of [
        ["current", "now()-interval '1 hour'", "now()+interval '1 hour'"],
        ["upcoming", "now()+interval '2 day'", "now()+interval '3 day'"],
      ]) {
        const id = randomUUID();
        await sql(
          `insert into public.course_runs(id,template_id,organisation_id) values('${id}','${template}','${org}');`,
        );
        await seedAssignment(lecturer, id, start, end);
        assert.ok(
          (await rpc(peer, "profile_courses", [lecturer])).some(
            (x) => x.course_run_id === id && x.state === state,
          ),
        );
      }
      const courses = await rpc(peer, "profile_courses", [lecturer]);
      assert.ok(
        courses.some((x) => x.course_run_id === run && x.state === "past"),
      );
      assert.ok(
        courses.every(
          (x) => !("amount" in x) && !("customer_name" in x) && !("terms" in x),
        ),
      );
    },
  );
  await check(
    "Client visibility is limited to their organisation assigned lecturers and course history",
    async () => {
      assert.equal(await actor(client, "select private.actor_active()"), "t");
      assert.deepEqual(
        await rpc(client, "people_directory", ["", "", null]),
        [],
      );
      await sql(
        `insert into public.client_organisation_memberships(user_id,organisation_id) values('${client}','${org}');`,
      );
      assert.equal(await actor(client, "select private.actor_active()"), "t");
      const people = await rpc(client, "people_directory", ["", "", null]);
      assert.deepEqual(
        people.map((x) => x.id),
        [lecturer],
      );
      assert.ok(
        (await rpc(client, "profile_courses", [lecturer])).every(
          (x) => x.title === "Fictional completed course",
        ),
      );
      await sql(
        `update public.client_organisation_memberships set removed_at=now() where user_id='${client}'`,
      );
      assert.equal(await actor(client, "select private.actor_active()"), "t");
      assert.deepEqual(
        await rpc(client, "people_directory", ["", "", null]),
        [],
      );
    },
  );
  await check(
    "Administrator functions still cannot review the administrator’s own teaching",
    async () => {
      const selfRun = randomUUID();
      await sql(
        `insert into public.course_runs(id,template_id,organisation_id) values('${selfRun}','${template}','${org}');insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${selfRun}',now()-interval '2 day',now()-interval '1 day');`,
      );
      await seedAssignment(
        admin,
        selfRun,
        "now()-interval '2 day'",
        "now()-interval '1 day'",
      );
      await rpc(
        admin,
        "manage_course_enrolment",
        [selfRun, admin, "completed"],
        "aal1",
      );
      await assert.rejects(
        rpc(admin, "submit_course_review", [
          selfRun,
          admin,
          5,
          "Self endorsement",
        ]),
        /Invalid review/,
      );
    },
  );
  await check(
    "Enrolment changes require manager permission, real participant and completed course",
    async () => {
      await assert.rejects(
        rpc(
          lecturer,
          "manage_course_enrolment",
          [run, student, "completed"],
          "aal1",
        ),
        /required/i,
      );
      await rpc(
        admin,
        "manage_course_enrolment",
        [run, student, "enrolled"],
        "aal1",
      );
      await assert.rejects(
        rpc(admin, "manage_course_enrolment", [run, peer, "enrolled"], "aal1"),
        /Invalid participant/,
      );
      await assert.rejects(
        rpc(student, "submit_course_review", [run, lecturer, 5, "Too early"]),
        /Completed enrolment/,
      );
    },
  );
  await check(
    "Enrolled participant sees only their own course and its assigned lecturer, no other people",
    async () => {
      assert.equal(
        await actor(
          student,
          `select count(*) from public.course_runs where id='${run}'`,
        ),
        "1",
      );
      assert.equal(
        await actor(
          stranger,
          `select count(*) from public.course_runs where id='${run}'`,
        ),
        "0",
      );
      assert.deepEqual(
        (await rpc(student, "people_directory")).map((x) => x.id),
        [lecturer],
      );
      assert.equal(
        (await rpc(student, "profile_courses", [lecturer])).length,
        1,
      );
      await assert.rejects(
        rpc(student, "course_enrolments", [run]),
        /required/i,
      );
      assert.equal(
        await actor(student, "select count(*) from public.course_enrolments"),
        "1",
      );
    },
  );
  await rpc(
    admin,
    "manage_course_enrolment",
    [run, student, "completed"],
    "aal1",
  );
  let review;
  await check(
    "Only completed attendance can review its actual lecturer; concurrent create has one winner",
    async () => {
      await assert.rejects(
        rpc(stranger, "submit_course_review", [run, lecturer, 5, "Forged"]),
        /Completed enrolment/,
      );
      await assert.rejects(
        rpc(student, "submit_course_review", [run, peer, 5, "Wrong lecturer"]),
        /Completed enrolment/,
      );
      await assert.rejects(
        rpc(student, "submit_course_review", [run, lecturer, 6, "Invalid"]),
        /Invalid review/,
      );
      const results = await Promise.allSettled([
        rpc(student, "submit_course_review", [
          run,
          lecturer,
          4,
          "Exact <script>text</script>",
        ]),
        rpc(student, "submit_course_review", [run, lecturer, 5, "Racing"]),
      ]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      review = results.find((x) => x.status === "fulfilled").value;
      assert.equal((await rpc(student, "reviewable_courses")).length, 1);
      assert.equal(
        await sql(
          `select count(*) from public.course_reviews where id='${review}'`,
        ),
        "1",
      );
    },
  );
  await check(
    "Reviewer identity and table rows stay private; ratings use authorised anonymous projections",
    async () => {
      const visible = await rpc(peer, "lecturer_reviews", [lecturer]);
      assert.equal(visible.length, 1);
      assert.equal(visible[0].reviewer_id, null);
      assert.equal(visible[0].reviewer_label, "participant");
      assert.equal(JSON.stringify(visible).includes("Private Student"), false);
      assert.equal(
        await actor(peer, "select count(*) from public.course_reviews"),
        "0",
      );
      assert.equal(
        await actor(lecturer, "select count(*) from public.course_reviews"),
        "0",
      );
      assert.equal(
        (await rpc(admin, "lecturer_reviews", [lecturer], "aal1"))[0]
          .reviewer_id,
        student,
      );
    },
  );
  await check(
    "Optimistic edits reject stale writes and preserve literal authored code",
    async () => {
      await rpc(student, "submit_course_review", [
        run,
        lecturer,
        5,
        "Exact <script>text</script>",
        1,
      ]);
      await assert.rejects(
        rpc(student, "submit_course_review", [run, lecturer, 1, "Stale", 1]),
        /review_version_conflict/,
      );
      assert.equal(
        (await rpc(peer, "lecturer_reviews", [lecturer]))[0].comment,
        "Exact <script>text</script>",
      );
    },
  );
  await check(
    "Moderation requires permission/reason and author edits do not unhide a moderated review",
    async () => {
      await assert.rejects(
        rpc(admin, "moderate_course_review", [review, true, ""], "aal1"),
        /reason required/,
      );
      await rpc(
        admin,
        "moderate_course_review",
        [review, true, "Fictional policy reason"],
        "aal1",
      );
      assert.deepEqual(await rpc(peer, "lecturer_reviews", [lecturer]), []);
      assert.equal(
        (await rpc(student, "lecturer_reviews", [lecturer]))[0]
          .moderation_reason,
        "Fictional policy reason",
      );
      await rpc(student, "submit_course_review", [
        run,
        lecturer,
        3,
        "Edited after moderation",
        3,
      ]);
      assert.deepEqual(await rpc(peer, "lecturer_reviews", [lecturer]), []);
      await rpc(
        admin,
        "moderate_course_review",
        [review, false, "Restored after review"],
        "aal1",
      );
      assert.equal((await rpc(peer, "lecturer_reviews", [lecturer])).length, 1);
    },
  );
  await check(
    "Membership revocation immediately removes profile/course reads and further review writes",
    async () => {
      await rpc(
        admin,
        "manage_course_enrolment",
        [run, student, "removed"],
        "aal1",
      );
      assert.deepEqual(await rpc(student, "people_directory"), []);
      assert.equal(
        await actor(
          student,
          `select count(*) from public.course_runs where id='${run}'`,
        ),
        "0",
      );
      await assert.rejects(
        rpc(student, "submit_course_review", [run, lecturer, 2, "Revoked", 5]),
        /Completed enrolment/,
      );
      assert.deepEqual(await rpc(peer, "lecturer_reviews", [lecturer]), []);
      await rpc(
        admin,
        "manage_course_enrolment",
        [run, student, "completed"],
        "aal1",
      );
    },
  );
  await check(
    "Authors can withdraw text using a versioned tombstone and recover through eligible resubmission",
    async () => {
      await rpc(student, "delete_course_review", [review, 5]);
      assert.deepEqual(await rpc(peer, "lecturer_reviews", [lecturer]), []);
      assert.equal(
        await sql(
          `select comment from public.course_reviews where id='${review}'`,
        ),
        "",
      );
      await rpc(student, "submit_course_review", [
        run,
        lecturer,
        4,
        "Restored",
        6,
      ]);
      assert.equal(
        (await rpc(peer, "lecturer_reviews", [lecturer]))[0].rating,
        4,
      );
    },
  );
  await check(
    "Suspended and anonymous actors cannot read or mutate profile/community data",
    async () => {
      await sql(
        `update public.profiles set active=false where id='${student}'`,
      );
      await assert.rejects(rpc(student, "reviewable_courses"), /Active login/);
      await assert.rejects(
        rpc(student, "save_profile_details", ["{}"]),
        /Active login/,
      );
      await assert.rejects(
        sql("set role anon;select public.people_directory()"),
        /permission denied/,
      );
      assert.equal(
        await sql(
          `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
        ),
        "0",
      );
    },
  );
  console.log(`\n${checks} profile/enrolment/review PostgreSQL checks passed.`);
} finally {
  await sql(`drop database if exists ${database} with (force)`, "postgres");
}
