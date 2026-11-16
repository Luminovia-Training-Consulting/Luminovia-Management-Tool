/** Real isolated PostgreSQL withdrawal decisions, privacy and complete-block release.
 * Auth helpers are emulated here; native Auth/HTTP acceptance remains separate. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const execute = promisify(execFile);

await withTestDatabase(
  "claim_withdrawal",
  async ({ sql, actor, container, database }) => {
    const [admin, manager, teacher, peer, participant, managerTeacher] =
      Array.from({ length: 6 }, randomUUID);
    await sql(`insert into auth.users(id,email) values ${[admin, manager, teacher, peer, participant, managerTeacher].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(manager)},'management'),(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(participant)},'participant'),(${q(managerTeacher)},'management'),(${q(managerTeacher)},'lecturer');`);
    await actor(
      admin,
      "select public.configure_compensation_policy(31,73,0)",
      "aal2",
    );
    const rpc = async (who, name, args = [], aal = "aal1") =>
      JSON.parse(
        await actor(who, `select public.${name}(${args.join(",")})`, aal),
      );
    let sequence = 0;
    let checks = 0;
    const check = async (name, run) => {
      await run();
      checks++;
      console.log(`PASS ${name}`);
    };
    /** Every fixture occupies a distinct hour, keeping ordinary teacher conflicts real. */
    const create = async ({ days = 3, who = teacher } = {}) => {
      const start = Date.now() + days * 86400000 + sequence++ * 7200000;
      const job = await actor(
        admin,
        `select public.create_job(${q(
          JSON.stringify({
            title: "Fictional withdrawal teaching block",
            customer_name: "Fictional withdrawal organisation",
            delivery_type: "online",
            status: "published",
            amount: 100,
            total_amount: 200,
            currency: "EUR",
            rate_unit: "per_day",
            terms: "Accepted fictional withdrawal terms",
            sessions: [0, 1].map((n) => ({
              starts_at: new Date(start + n * 1800000).toISOString(),
              ends_at: new Date(start + n * 1800000 + 900000).toISOString(),
            })),
          }),
        )}::jsonb)`,
        "aal2",
      );
      const version = await actor(
        who,
        `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'=${q(job)}`,
        who === managerTeacher ? "aal2" : "aal1",
      );
      assert.match(version, /^[1-9][0-9]*$/);
      const claim = await rpc(
        who,
        "claim_job",
        [q(job), q(randomUUID()), version],
        who === managerTeacher ? "aal2" : "aal1",
      );
      assert.equal(claim.status, "confirmed");
      return { job, claim: claim.claim_id, who };
    };
    const list = (who, job, aal = "aal1") =>
      rpc(who, "assignment_withdrawals", job ? [q(job)] : [], aal);
    const request = (
      fixture,
      reason = "Fictional scheduling conflict",
      key = randomUUID(),
    ) =>
      rpc(
        fixture.who,
        "request_assignment_withdrawal",
        [q(fixture.claim), q(reason), q(key)],
        fixture.who === managerTeacher ? "aal2" : "aal1",
      );
    const review = (
      id,
      approve,
      who = manager,
      key = randomUUID(),
      reason = "Fictional management decision",
      aal = "aal2",
    ) =>
      rpc(
        who,
        "review_assignment_withdrawal",
        [q(id), String(approve), q(reason), q(key)],
        aal,
      );
    const cancel = (fixture, who = fixture.who, aal = "aal1") =>
      actor(
        who,
        `select public.cancel_job_assignment(${q(fixture.claim)},'Fictional cancellation reason',${q(randomUUID())})`,
        aal,
      );
    const snapshot = async (fixture) =>
      JSON.parse(
        await sql(
          `select jsonb_build_object('claim',to_jsonb(c),'sessions',(select jsonb_agg(to_jsonb(s) order by s.starts_at) from public.assignment_sessions s where s.claim_id=c.id),'ledger',(select to_jsonb(l) from private.claim_revenue_ledger l where l.claim_id=c.id),'members',(select jsonb_agg(to_jsonb(m) order by m.room_id,m.user_id) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id=c.job_id),'job_status',(select status from public.jobs where id=c.job_id)) from public.job_claims c where c.id=${q(fixture.claim)}`,
        ),
      );
    const assertReleased = async (fixture, before) => {
      const after = await snapshot(fixture);
      assert.deepEqual(after.claim, { ...before.claim, status: "cancelled" });
      assert.deepEqual(after.ledger, before.ledger);
      assert.equal(after.sessions.length, 2);
      after.sessions.forEach((session, index) => {
        assert.ok(session.released_at);
        assert.deepEqual(
          { ...session, released_at: null },
          before.sessions[index],
        );
      });
      assert.equal(after.job_status, "draft");
      assert.equal(
        await sql(
          `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id=${q(fixture.job)} and m.user_id=${q(fixture.who)} and m.removed_at is null`,
        ),
        "0",
      );
    };

    await check(
      "Only own assignments or current managers expose withdrawal reasons and capabilities",
      async () => {
        const fixture = await create();
        const own = await list(teacher, fixture.job);
        assert.equal(own.claims[0].requires_approval, true);
        assert.equal(own.claims[0].can_withdraw, true);
        assert.equal(own.can_review, false);
        assert.equal(
          (await list(manager, fixture.job, "aal2")).can_review,
          true,
        );
        for (const who of [peer, participant]) {
          const hidden = await list(who, fixture.job);
          assert.deepEqual(hidden.items, []);
          assert.deepEqual(hidden.claims, []);
          assert.equal(hidden.can_review, false);
        }
        for (const table of [
          "assignment_withdrawals",
          "assignment_withdrawal_commands",
        ])
          await assert.rejects(
            actor(teacher, `select * from private.${table}`),
            /42501/,
          );
        await assert.rejects(
          actor(
            teacher,
            `select private.cancel_job_assignment_immediate(${q(fixture.claim)},'Fictional bypass attempt',${q(randomUUID())})`,
          ),
          /42501/,
        );
        for (const name of [
          "assignment_withdrawals(uuid)",
          "request_assignment_withdrawal(uuid,text,uuid)",
          "review_assignment_withdrawal(uuid,boolean,text,uuid)",
        ])
          assert.equal(
            await sql(
              `select has_function_privilege('anon',${q("public." + name)},'execute')`,
            ),
            "f",
          );
      },
    );

    await check(
      "Strict PostgreSQL diagnostics validate all new withdrawal routines and trigger",
      async () => {
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
          "private.cancel_job_assignment(uuid,text,uuid)",
          "private.assignment_withdrawals(uuid)",
          "private.request_assignment_withdrawal(uuid,text,uuid)",
          "private.review_assignment_withdrawal(uuid,boolean,text,uuid)",
          "private.job_lifecycle(uuid)",
          "private.notification_target(text,uuid)",
        ])
          assert.deepEqual(
            JSON.parse(
              await sql(
                `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb(${q(signature)}::regprocedure)t`,
              ),
            ),
            [],
            signature,
          );
        assert.deepEqual(
          JSON.parse(
            await sql(
              "select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb('private.supersede_assignment_withdrawals()'::regprocedure,'public.job_claims'::regclass)t",
            ),
          ),
          [],
        );
      },
    );

    await check(
      "Seven-day-or-more withdrawal releases the entire block and preserves accepted snapshots",
      async () => {
        const fixture = await create({ days: 10 });
        const before = await snapshot(fixture);
        assert.equal(
          (await list(teacher, fixture.job)).claims[0].requires_approval,
          false,
        );
        const key = randomUUID();
        const result = await request(fixture, "", key);
        assert.equal(result.status, "withdrawn");
        await assertReleased(fixture, before);
        assert.deepEqual(await request(fixture, "", key), result);
        await assert.rejects(
          request(fixture, "Changed retry reason", key),
          /22023/,
        );
        assert.equal(
          await sql(
            `select count(*) from public.claim_events where claim_id=${q(fixture.claim)} and event_type='cancelled'`,
          ),
          "1",
        );
        assert.equal(
          await sql(
            `select count(*) from public.notifications where resource_id=${q(fixture.claim)} and kind='claim_cancelled'`,
          ),
          "1",
        );
      },
    );

    await check(
      "The notice window uses 168 elapsed hours at the first session, across the seven-day boundary",
      async () => {
        for (const [seconds, expected] of [
          [60, "withdrawn"],
          [-60, "pending"],
        ]) {
          const fixture = await create({ days: 8 });
          await sql(`update public.assignment_sessions set starts_at=starts_at+shift.delta,ends_at=ends_at+shift.delta
        from(select clock_timestamp()+interval '168 hours'+${seconds}*interval '1 second'-min(starts_at) delta from public.assignment_sessions where claim_id=${q(fixture.claim)})shift where claim_id=${q(fixture.claim)}`);
          const current = await list(teacher, fixture.job);
          assert.equal(current.claims[0].requires_approval, seconds < 0);
          assert.equal((await request(fixture)).status, expected);
        }
      },
    );

    await check(
      "Under seven days requires a bounded reason and pending requests retain all allocations and access",
      async () => {
        const fixture = await create();
        const before = await snapshot(fixture);
        for (const reason of ["", "  ", "no", "x".repeat(1001)])
          await assert.rejects(request(fixture, reason), /22023/);
        assert.deepEqual(await snapshot(fixture), before);
        const result = await request(fixture);
        assert.equal(result.status, "pending");
        assert.deepEqual(await snapshot(fixture), before);
        assert.equal(
          await sql(
            `select count(*) from public.audit_events where details::text like '%Fictional scheduling conflict%'`,
          ),
          "0",
          "Potentially sensitive application text stays outside public audit details",
        );
        const own = await list(teacher, fixture.job);
        assert.equal(own.claims[0].can_withdraw, false);
        assert.equal(own.items[0].id, result.id);
        assert.equal(own.items[0].reason, "Fictional scheduling conflict");
        assert.equal(own.items[0].can_review, false);
        assert.equal(
          (await list(manager, fixture.job, "aal2")).items[0].can_review,
          true,
        );
        assert.equal((await list(peer)).items.length, 0);
        for (const who of [admin, manager, teacher]) {
          const inbox = await rpc(
            who,
            "notification_inbox",
            [],
            who === teacher ? "aal1" : "aal2",
          );
          assert.ok(
            inbox.items.some(
              (item) =>
                item.kind === "assignment_withdrawal_requested" &&
                item.href === `/jobs/${fixture.job}`,
            ),
          );
        }
        assert.equal(
          (await rpc(peer, "notification_inbox")).items.filter(
            (item) => item.href === `/jobs/${fixture.job}`,
          ).length,
          0,
        );
      },
    );

    await check(
      "Legacy direct cancellation and forged peer requests cannot bypass the short-notice decision",
      async () => {
        const fixture = await create();
        const before = await snapshot(fixture);
        await assert.rejects(cancel(fixture), /22023|42501/);
        await assert.rejects(request({ ...fixture, who: peer }), /42501/);
        await assert.rejects(
          request({ ...fixture, who: participant }),
          /42501/,
        );
        assert.deepEqual(await snapshot(fixture), before);
        const managerFixture = await create({ who: managerTeacher });
        await assert.rejects(
          cancel(managerFixture, managerTeacher, "aal2"),
          /22023|42501/,
        );
        const result = await request(managerFixture);
        await assert.rejects(review(result.id, true, managerTeacher), /42501/);
        assert.equal(
          (await snapshot(managerFixture)).claim.status,
          "confirmed",
        );
      },
    );

    await check(
      "Management rejection leaves the complete assignment binding and sends one durable receipt",
      async () => {
        const fixture = await create();
        const before = await snapshot(fixture);
        const result = await request(fixture);
        const key = randomUUID();
        for (const invalidReason of ["", "no", "x".repeat(1001)])
          await assert.rejects(
            review(result.id, false, manager, randomUUID(), invalidReason),
            /22023/,
          );
        const rejected = await review(result.id, false, manager, key);
        assert.equal(rejected.status, "rejected");
        assert.deepEqual(
          await review(result.id, false, manager, key),
          rejected,
        );
        await assert.rejects(review(result.id, true, manager, key), /22023/);
        assert.deepEqual(await snapshot(fixture), before);
        const own = await list(teacher, fixture.job);
        assert.equal(
          own.items[0].review_reason,
          "Fictional management decision",
        );
        assert.equal(own.items[0].status, "rejected");
        assert.equal(own.claims[0].can_withdraw, true);
        assert.equal(
          (await rpc(teacher, "notification_inbox")).items.filter(
            (item) =>
              item.href === `/jobs/${fixture.job}` &&
              item.kind === "assignment_withdrawal_rejected",
          ).length,
          1,
        );
        assert.equal(
          (await request(fixture, "Fictional new circumstances")).status,
          "pending",
        );
      },
    );

    await check(
      "Administration approval is atomic and releases every session once with immutable money and terms",
      async () => {
        const fixture = await create();
        const before = await snapshot(fixture);
        const result = await request(fixture);
        const key = randomUUID();
        const approved = await review(result.id, true, admin, key);
        assert.equal(approved.status, "approved");
        assert.deepEqual(await review(result.id, true, admin, key), approved);
        await assertReleased(fixture, before);
        assert.equal(
          (await list(teacher, fixture.job)).items[0].can_review,
          false,
        );
        assert.equal(
          (await rpc(teacher, "notification_inbox")).items.filter(
            (item) =>
              item.href === `/jobs/${fixture.job}` &&
              item.kind === "assignment_withdrawal_approved",
          ).length,
          1,
        );
        assert.equal(
          await sql(
            `select count(*) from public.claim_events where claim_id=${q(fixture.claim)} and event_type='cancelled'`,
          ),
          "1",
        );
      },
    );

    await check(
      "Request retries converge; competing approval/rejection commits exactly one decision",
      async () => {
        const fixture = await create();
        const key = randomUUID();
        const attempts = await Promise.all(
          Array.from({ length: 8 }, () =>
            request(fixture, "Fictional concurrent retry", key),
          ),
        );
        assert.equal(new Set(attempts.map((item) => item.id)).size, 1);
        assert.equal((await list(teacher, fixture.job)).items.length, 1);
        const result = attempts[0];
        const reviewed = await Promise.allSettled([
          review(result.id, true, admin),
          review(result.id, false, manager),
        ]);
        assert.equal(
          reviewed.filter((item) => item.status === "fulfilled").length,
          1,
        );
        const final = (await list(teacher, fixture.job)).items[0];
        assert.ok(["approved", "rejected"].includes(final.status));
        assert.equal(
          (await snapshot(fixture)).claim.status,
          final.status === "approved" ? "cancelled" : "confirmed",
        );
      },
    );

    await check(
      "MFA, current role and requester boundaries remain authoritative for every review",
      async () => {
        const fixture = await create();
        const result = await request(fixture);
        const before = await snapshot(fixture);
        for (const who of [teacher, peer, participant])
          await assert.rejects(review(result.id, true, who), /42501/);
        await assert.rejects(
          review(
            result.id,
            true,
            manager,
            randomUUID(),
            "Fictional decision",
            "aal1",
          ),
          /42501/,
        );
        await sql(
          `delete from public.user_roles where user_id=${q(manager)} and role='management'`,
        );
        try {
          await assert.rejects(review(result.id, true, manager), /42501/);
          assert.deepEqual(await snapshot(fixture), before);
          assert.equal(
            (await list(teacher, fixture.job)).items[0].status,
            "pending",
          );
        } finally {
          await sql(
            `insert into public.user_roles(user_id,role) values(${q(manager)},'management')`,
          );
        }
      },
    );

    /** Observe actual database waits so the revocation regression cannot pass
     * merely because the writer happened to begin after the role change. */
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
        "The actual withdrawal profile-lock barrier was not observed",
      );
    };
    const revokeWhileQueued = async (who, statement, aal) => {
      const revokeTag = `withdrawal_revoke_${randomUUID().replaceAll("-", "")}`;
      const writeTag = `withdrawal_write_${randomUUID().replaceAll("-", "")}`;
      const revoker = actor(
        admin,
        `set local application_name=${q(revokeTag)};select public.set_account_roles(${q(who)},array['participant']);select pg_sleep(2)`,
        "aal2",
      );
      let writer;
      try {
        await barrier(revokeTag, "wait_event='PgSleep'");
        writer = actor(
          who,
          `set local application_name=${q(writeTag)};${statement}`,
          aal,
        );
        const settled = Promise.allSettled([revoker, writer]);
        await barrier(writeTag, "wait_event_type='Lock'");
        const results = await settled;
        assert.equal(results[0].status, "fulfilled");
        assert.equal(results[1].status, "rejected");
        assert.match(results[1].reason.message, /42501/);
      } finally {
        await Promise.allSettled([revoker, ...(writer ? [writer] : [])]);
        await actor(
          admin,
          `select public.set_account_roles(${q(who)},array[${q(who === manager ? "management" : "lecturer")}])`,
          "aal2",
        );
      }
    };
    await check(
      "Queued lecturer withdrawal rechecks committed role revocation after the profile lock",
      async () => {
        const fixture = await create();
        const before = await snapshot(fixture);
        await revokeWhileQueued(
          teacher,
          `select public.request_assignment_withdrawal(${q(fixture.claim)},'Fictional queued request',${q(randomUUID())})`,
          "aal1",
        );
        assert.deepEqual(await snapshot(fixture), before);
        assert.deepEqual((await list(teacher, fixture.job)).items, []);
      },
    );
    await check(
      "Queued management review rechecks committed role revocation after the profile lock",
      async () => {
        const fixture = await create();
        const pending = await request(fixture);
        const before = await snapshot(fixture);
        await revokeWhileQueued(
          manager,
          `select public.review_assignment_withdrawal(${q(pending.id)},true,'Fictional queued decision',${q(randomUUID())})`,
          "aal2",
        );
        assert.deepEqual(await snapshot(fixture), before);
        assert.equal(
          (await list(teacher, fixture.job)).items[0].status,
          "pending",
        );
      },
    );

    await check(
      "Administrative cancellation closes a pending application and prevents a stale later decision",
      async () => {
        const fixture = await create();
        const pending = await request(fixture);
        const before = await snapshot(fixture);
        await cancel(fixture, admin, "aal2");
        await assertReleased(fixture, before);
        assert.equal(
          (await list(teacher, fixture.job)).items[0].status,
          "superseded",
        );
        assert.equal(
          (await list(manager, fixture.job, "aal2")).items[0].can_review,
          false,
        );
        await assert.rejects(review(pending.id, true), /40001/);
      },
    );

    await check(
      "Started work cannot create or approve a withdrawal and never partially releases a block",
      async () => {
        const fixture = await create();
        const pending = await request(fixture);
        await sql(
          `update public.assignment_sessions set starts_at=starts_at-interval '10 days',ends_at=ends_at-interval '10 days' where claim_id=${q(fixture.claim)}`,
        );
        const before = await snapshot(fixture);
        await assert.rejects(review(pending.id, true), /22023/);
        await assert.rejects(request(fixture), /22023/);
        assert.deepEqual(await snapshot(fixture), before);
      },
    );

    await check(
      "Invoiced work blocks release even after the original short-notice application was submitted",
      async () => {
        const fixture = await create();
        const pending = await request(fixture);
        const document = randomUUID(),
          version = randomUUID(),
          key = randomUUID();
        await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values(${q(document)},${q(teacher)},${q(teacher)},'personal','invoice','Fictional withdrawal invoice.pdf','application/pdf',100,'clean',${q(key)});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values(${q(version)},${q(document)},${q(teacher)},${q(key)},1,${q(`${teacher}/${document}/${version}`)},'Fictional withdrawal invoice.pdf','application/pdf',100,${q("1".repeat(64))},'clean');
      update public.documents set current_version_id=${q(version)} where id=${q(document)}`);
        await actor(
          teacher,
          `select public.submit_invoice('Fictional withdrawal invoice',array[${q(fixture.claim)}::uuid],${q(version)},current_date,current_date+7,${q(randomUUID())})`,
        );
        const before = await snapshot(fixture);
        await assert.rejects(review(pending.id, true), /22023/);
        await assert.rejects(request(fixture), /22023/);
        assert.deepEqual(await snapshot(fixture), before);
        assert.equal(
          (await list(teacher, fixture.job)).claims[0].can_withdraw,
          false,
        );
      },
    );

    console.log(`${checks} withdrawal SQL groups passed`);
  },
);
