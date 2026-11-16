/** Waitlist writes observe committed activation/role revocation after real profile
 * lock waits. UUID databases and fictional users are owned and dropped by the
 * shared fixture; no ordinary development state or real mail is accessed.
 * The explicit vulnerable control reinstalls only the original private routine
 * to prove the same suspension test rejects its pre-lock-only authorization.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("waitlist_authority", async ({ sql, actor }) => {
  if (process.env.PORTAL_WAITLIST_VULNERABLE_CONTROL === "1") {
    const source = await readFile(
      new URL(
        "../supabase/migrations/20261116091012_assignment_waitlist_and_substitution.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const routine = source.match(
      /create function private\.set_job_waitlist\(.*?end;\$\$;/s,
    );
    assert.ok(routine, "The actual original routine must remain available");
    await sql(
      routine[0].replace("create function", "create or replace function"),
    );
  }
  if (process.env.PORTAL_WAITLIST_TITLE_VULNERABLE_CONTROL === "1") {
    const source = await readFile(
      new URL(
        "../supabase/migrations/20261116091534_waitlist_current_authority_after_profile_lock.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const routine = source.match(
      /create or replace function private\.set_job_waitlist\(.*?end;\$\$;/s,
    );
    assert.ok(routine, "The actual pre-privacy routine must remain available");
    await sql(routine[0]);
  }
  if (process.env.PORTAL_WAITLIST_GETTER_VULNERABLE_CONTROL === "1") {
    const source = await readFile(
      new URL(
        "../supabase/migrations/20261116091012_assignment_waitlist_and_substitution.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const routine = source.match(
      /create function private\.job_waitlist\(.*?end;\$\$;/s,
    );
    assert.ok(routine, "The actual original getter must remain available");
    await sql(
      routine[0].replace("create function", "create or replace function"),
    );
  }
  const [admin, waiter] = Array.from({ length: 2 }, randomUUID);
  await sql(`insert into auth.users(id,email)values${[admin, waiter]
    .map((id) => `(${q(id)},${q(id + "@example.invalid")})`)
    .join(",")};
insert into public.user_roles(user_id,role)values(${q(admin)},'admin'),(${q(waiter)},'lecturer');`);
  let checks = 0;
  /** Proves a named contract only after its actual SQL assertions complete. */
  const check = async (name, run) => {
    await run();
    checks++;
    console.log(`PASS ${name}`);
  };
  /** A filled future offer is a waitlist target, never a reserved replacement. */
  const make = async () => {
    const job = randomUUID();
    await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,requires_contract)
values(${q(job)},'Fictional waitlist authority','Fictional academy','online','published',1,1,'EUR','fixed_total','Fictional complete agreement',false);
insert into public.job_sessions(job_id,starts_at,ends_at)values(${q(job)},'2055-01-01T08:00:00Z','2055-01-01T09:00:00Z');`);
    // A unique teacher per target avoids unrelated calendar collisions.
    const lecturer = randomUUID();
    await sql(
      `insert into auth.users(id,email)values(${q(lecturer)},${q(lecturer + "@example.invalid")});insert into public.user_roles(user_id,role)values(${q(lecturer)},'lecturer');`,
    );
    const receipt = JSON.parse(
      await actor(
        lecturer,
        `select public.claim_job(${q(job)},${q(randomUUID())},1)`,
      ),
    );
    assert.equal(receipt.status, "confirmed");
    return job;
  };
  /** Reads only the exact fixture interest and notice that a denied call must retain. */
  const snapshot = (job) =>
    sql(`select jsonb_build_object('waitlist',(select to_jsonb(w)from private.job_waitlist w where w.job_id=${q(job)} and w.user_id=${q(waiter)}),
'notice',(select to_jsonb(n)from public.notifications n where n.user_id=${q(waiter)} and n.resource_id=${q(job)} and n.kind='job_waitlist_available'))`);
  /** Observes real server blocking rather than relying on a timing assumption. */
  const barrier = async (tag, condition) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        (await sql(
          `select exists(select 1 from pg_stat_activity where datname=current_database() and application_name=${q(tag)} and ${condition})`,
        )) === "t"
      )
        return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(
      "The actual PostgreSQL profile-lock barrier was not observed",
    );
  };
  /** The admin holds the profile change until a waiting call is observed; both
   * settle before assertions or fixture cleanup can drop their owned database. */
  const race = async (job, join, change) => {
    const revokeTag = `waitlist_revoke_${randomUUID().replaceAll("-", "")}`;
    const writeTag = `waitlist_write_${randomUUID().replaceAll("-", "")}`;
    const revoked = actor(
      admin,
      `set local application_name=${q(revokeTag)};select ${change};select pg_sleep(2)`,
      "aal2",
    );
    let writer;
    try {
      await barrier(revokeTag, "wait_event='PgSleep'");
      writer = actor(
        waiter,
        `set local application_name=${q(writeTag)};select public.set_job_waitlist(${q(job)},${join})`,
      );
      const settled = Promise.allSettled([revoked, writer]);
      await barrier(writeTag, "wait_event_type='Lock'");
      const results = await settled;
      assert.equal(results[0].status, "fulfilled");
      return results[1];
    } finally {
      await Promise.allSettled([revoked, ...(writer ? [writer] : [])]);
    }
  };
  await check(
    "A queued leave observes committed suspension and retains its exact waitlist/notification",
    async () => {
      const job = await make();
      await actor(waiter, `select public.set_job_waitlist(${q(job)},true)`);
      await sql(
        `insert into public.notifications(user_id,kind,resource_id)values(${q(waiter)},'job_waitlist_available',${q(job)})`,
      );
      const before = await snapshot(job);
      const result = await race(
        job,
        false,
        `public.set_user_active(${q(waiter)},false)`,
      );
      assert.equal(
        result.status,
        "rejected",
        "Completed suspension must deny the waiting write",
      );
      assert.match(result.reason.message, /42501/);
      assert.equal(await snapshot(job), before);
      await actor(
        admin,
        `select public.set_user_active(${q(waiter)},true)`,
        "aal2",
      );
    },
  );
  await check(
    "A queued join also observes committed suspension without storing interest",
    async () => {
      const job = await make();
      const before = await snapshot(job);
      const result = await race(
        job,
        true,
        `public.set_user_active(${q(waiter)},false)`,
      );
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /42501/);
      assert.equal(await snapshot(job), before);
      await actor(
        admin,
        `select public.set_user_active(${q(waiter)},true)`,
        "aal2",
      );
    },
  );
  await check(
    "A queued join rechecks current lecturer roles after committed downgrade",
    async () => {
      const job = await make();
      const result = await race(
        job,
        true,
        `public.set_account_roles(${q(waiter)},array['participant'])`,
      );
      assert.equal(result.status, "rejected");
      assert.match(result.reason.message, /42501/);
      assert.equal(
        await sql(
          `select count(*)from private.job_waitlist where job_id=${q(job)} and user_id=${q(waiter)}`,
        ),
        "0",
      );
      await actor(
        admin,
        `select public.set_account_roles(${q(waiter)},array['lecturer'])`,
        "aal2",
      );
    },
  );
  await check(
    "An active former lecturer can still leave only their own previously recorded interest",
    async () => {
      const job = await make();
      await actor(waiter, `select public.set_job_waitlist(${q(job)},true)`);
      const result = await race(
        job,
        false,
        `public.set_account_roles(${q(waiter)},array['participant'])`,
      );
      assert.equal(result.status, "fulfilled");
      assert.equal(JSON.parse(result.value).joined, false);
      assert.equal(
        await sql(
          `select count(*)from private.job_waitlist where job_id=${q(job)} and user_id=${q(waiter)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*)from public.job_claims where job_id=${q(job)} and lecturer_id=${q(waiter)}`,
        ),
        "0",
      );
    },
  );
  /** Leave receipts contain only the requested identifier and own-state flags;
   * an empty title is accepted by the existing public receipt schema. */
  const leftReceipt = (job) => ({
    job_id: job,
    title: "",
    joined: false,
    can_join: false,
    available: false,
  });
  const [participant, privateLecturer] = Array.from({ length: 2 }, randomUUID);
  await sql(`insert into auth.users(id,email)values${[participant, privateLecturer].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
insert into public.user_roles(user_id,role)values(${q(participant)},'participant'),(${q(privateLecturer)},'lecturer');`);
  /** Private test jobs have no actual accepted assignments or customer records. */
  const privateJob = async (status) => {
    const job = randomUUID();
    await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,requires_contract)
values(${q(job)},'Fictional confidential private title','Fictional private academy','online',${q(status)},1,1,'EUR','fixed_total','Fictional private terms',false);`);
    return job;
  };
  await check(
    "Uninterested participant and lecturer withdrawals reveal no draft, archived or unknown job metadata",
    async () => {
      const jobs = [
        await privateJob("draft"),
        await privateJob("archived"),
        randomUUID(),
      ];
      for (const who of [participant, privateLecturer]) {
        for (const job of jobs) {
          assert.equal(
            await actor(
              who,
              `select count(*)from public.jobs where id=${q(job)}`,
            ),
            "0",
          );
          assert.equal(
            await sql(
              `select count(*)from private.job_waitlist where job_id=${q(job)} and user_id=${q(who)}`,
            ),
            "0",
          );
          assert.deepEqual(
            JSON.parse(
              await actor(
                who,
                `select public.set_job_waitlist(${q(job)},false)`,
              ),
            ),
            leftReceipt(job),
          );
          assert.deepEqual(
            JSON.parse(
              await actor(
                who,
                `select public.set_job_waitlist(${q(job)},false)`,
              ),
            ),
            leftReceipt(job),
          );
        }
      }
    },
  );
  await check(
    "Unknown identifiers clean only the caller's stale notice without exposing existence or another account",
    async () => {
      const job = randomUUID();
      await sql(
        `insert into public.notifications(user_id,kind,resource_id)values(${q(participant)},'job_waitlist_available',${q(job)}),(${q(privateLecturer)},'job_waitlist_available',${q(job)})`,
      );
      const foreign = await sql(
        `select to_jsonb(n)from public.notifications n where user_id=${q(privateLecturer)}and resource_id=${q(job)}`,
      );
      assert.deepEqual(
        JSON.parse(
          await actor(
            participant,
            `select public.set_job_waitlist(${q(job)},false)`,
          ),
        ),
        leftReceipt(job),
      );
      assert.equal(
        await sql(
          `select count(*)from public.notifications where user_id=${q(participant)}and resource_id=${q(job)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select to_jsonb(n)from public.notifications n where user_id=${q(privateLecturer)}and resource_id=${q(job)}`,
        ),
        foreign,
      );
    },
  );
  await check(
    "Null and malformed job identifiers never produce a malformed public receipt",
    async () => {
      for (const who of [participant, privateLecturer]) {
        await assert.rejects(
          actor(who, "select public.set_job_waitlist(null,false)"),
          /42501/,
        );
        await assert.rejects(
          actor(who, "select public.set_job_waitlist('malformed-uuid',false)"),
          /22P02/,
        );
      }
    },
  );
  await check(
    "Existing interest survives read revocation without exposing a newly private title and can still be withdrawn",
    async () => {
      for (const status of ["draft", "archived"]) {
        const job = await privateJob("filled");
        await sql(
          `insert into public.job_sessions(job_id,starts_at,ends_at)values(${q(job)},'2056-01-01T08:00:00Z','2056-01-01T09:00:00Z')`,
        );
        await actor(
          privateLecturer,
          `select public.set_job_waitlist(${q(job)},true)`,
        );
        await sql(
          `update public.jobs set status=${q(status)},title='Fictional newly private changed title'where id=${q(job)}`,
        );
        assert.equal(
          await actor(
            privateLecturer,
            `select count(*)from public.jobs where id=${q(job)}`,
          ),
          "0",
        );
        assert.equal(
          JSON.parse(
            await actor(
              privateLecturer,
              `select public.job_waitlist(${q(job)})`,
            ),
          ).title,
          "",
        );
        const ownList = JSON.parse(
          await actor(privateLecturer, "select public.my_job_waitlist()"),
        );
        assert.equal(ownList.find((item) => item.job_id === job).title, "");
        await actor(
          admin,
          `select public.set_account_roles(${q(privateLecturer)},array['participant'])`,
          "aal2",
        );
        await assert.rejects(
          actor(privateLecturer, `select public.job_waitlist(${q(job)})`),
          /42501/,
        );
        await assert.rejects(
          actor(privateLecturer, "select public.my_job_waitlist()"),
          /42501/,
        );
        assert.deepEqual(
          JSON.parse(
            await actor(
              privateLecturer,
              `select public.set_job_waitlist(${q(job)},false)`,
            ),
          ),
          leftReceipt(job),
        );
        assert.deepEqual(
          JSON.parse(
            await actor(
              privateLecturer,
              `select public.set_job_waitlist(${q(job)},false)`,
            ),
          ),
          leftReceipt(job),
        );
        assert.equal(
          await sql(
            `select count(*)from private.job_waitlist where job_id=${q(job)}and user_id=${q(privateLecturer)}`,
          ),
          "0",
        );
        await actor(
          admin,
          `select public.set_account_roles(${q(privateLecturer)},array['lecturer'])`,
          "aal2",
        );
      }
    },
  );
  console.log(`${checks} actual waitlist authority PostgreSQL groups passed.`);
});
