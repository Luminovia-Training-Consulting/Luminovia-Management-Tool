/** Real isolated PostgreSQL waitlist/substitution races and immutable work. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase(
  "assignment_handover",
  async ({ sql, actor }) => {
    const [teacher, replacement, peer, unqualified, admin, participant] =
      Array.from({ length: 6 }, randomUUID);
    const topic = randomUUID();
    await sql(`insert into auth.users(id,email) values ${[teacher, replacement, peer, unqualified, admin, participant].map((id) => `(${q(id)},${q(`${id}@example.invalid`)})`).join(",")};
    insert into public.user_roles(user_id,role) values${[teacher, replacement, peer, unqualified].map((id) => `(${q(id)},'lecturer')`).join(",")},(${q(admin)},'admin'),(${q(participant)},'participant');
    insert into public.topics(id,kind,label_de,label_en) values(${q(topic)},'topic','Fiktives qualifiziertes Thema','Fictional qualified topic');
    insert into public.lecturer_topics(user_id,topic_id,verified) values${[teacher, replacement, peer, admin].map((id) => `(${q(id)},${q(topic)},true)`).join(",")};
    update public.profiles set display_name=case id when ${q(replacement)} then 'Fictional Replacement' when ${q(peer)} then 'Fictional Peer' else 'Fictional Actor' end;`);
    const rpc = async (who, name, args = [], aal = "aal1") =>
      JSON.parse(
        await actor(who, `select public.${name}(${args.join(",")})`, aal),
      );
    const textRpc = (who, name, args = [], aal = "aal1") =>
      actor(who, `select public.${name}(${args.join(",")})`, aal);
    let checks = 0,
      sequence = 0;
    const check = async (name, run) => {
      await run();
      console.log(`PASS ${name}`);
      checks++;
    };
    const make = async (commission = false) => {
      const job = randomUUID();
      sequence++;
      const start = `'2044-01-01T08:00:00Z'::timestamptz+interval '${sequence * 10} days'`;
      await sql(`insert into public.jobs(id,title,customer_name,delivery_type,location,status,amount,currency,rate_unit,total_amount,terms,requires_contract)
      values(${q(job)},'Fictional immutable handover','Fictional academy','online','https://example.invalid/teaching','published',125,'EUR','per_day',625,'Accepted fictional whole-block agreement',false);
      insert into public.job_sessions(job_id,starts_at,ends_at) select ${q(job)},${start}+make_interval(days=>n),${start}+make_interval(days=>n,hours=>6) from generate_series(0,4)n;
      insert into public.job_requirements(job_id,topic_id) values(${q(job)},${q(topic)});`);
      if (commission) {
        const organisation = randomUUID();
        await sql(`insert into public.organisations(id,name) values(${q(organisation)},'Fictional handover finance client');
          insert into private.job_commission_offers(job_id,organisation_id,gross_amount,gross_total_amount,platform_percent,platform_total_amount,lecturer_net_amount,lecturer_net_total_amount,currency)
          select id,${q(organisation)},amount*2.4,total_amount*2.4,round((amount*2.4-amount)/(amount*2.4)*100,2),total_amount*2.4-total_amount,amount,total_amount,currency from public.jobs where id=${q(job)};`);
      }
      const claim = await rpc(teacher, "claim_job", [
        q(job),
        q(randomUUID()),
        "1",
      ]);
      assert.equal(claim.status, "confirmed");
      return { job, claim: claim.claim_id, start };
    };
    const propose = (
      fixture,
      target = replacement,
      who = teacher,
      key = randomUUID(),
      aal = "aal1",
    ) =>
      textRpc(
        who,
        "propose_job_substitution",
        [
          q(fixture.claim),
          q(target),
          q("Fictional replacement requested"),
          q(key),
        ],
        aal,
      );
    const offers = (who, job = null, aal = "aal1") =>
      rpc(who, "job_substitutions", [job === null ? "null" : q(job)], aal);
    const accept = async (
      id,
      who = replacement,
      { hash, consent = true, key = randomUUID() } = {},
    ) => {
      const own = (await offers(who)).find((offer) => offer.id === id);
      return rpc(who, "respond_job_substitution", [
        q(id),
        q("accept"),
        q(hash ?? own?.quote_hash ?? "forged"),
        q(key),
        consent,
      ]);
    };
    const summary = (fixture) =>
      sql(
        `select jsonb_build_object('claims',(select jsonb_agg(to_jsonb(c) order by c.id) from public.job_claims c where c.job_id=${q(fixture.job)}),'sessions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id=${q(fixture.job)}))`,
      );
    const prepareInvoice = async (fixture) => {
      const document = randomUUID(),
        version = randomUUID(),
        key = randomUUID();
      await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values(${q(document)},${q(teacher)},${q(teacher)},'personal','invoice','Fictional invoice.pdf','application/pdf',100,'clean',${q(key)});
        insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values(${q(version)},${q(document)},${q(teacher)},${q(key)},1,${q(`${teacher}/${document}/${version}`)},'Fictional invoice.pdf','application/pdf',100,${q("1".repeat(64))},'clean');
        update public.documents set current_version_id=${q(version)} where id=${q(document)};`);
      return () =>
        actor(
          teacher,
          `select public.submit_invoice(${q(`Fictional handover ${randomUUID()}`)},array[${q(fixture.claim)}::uuid],${q(version)},current_date,current_date+7,${q(randomUUID())})`,
        );
    };

    await check(
      "Waitlist joins/leaves deduplicate without allocating a single session or exposing other waiters",
      async () => {
        const f = await make();
        const before = await summary(f);
        const attempts = await Promise.all(
          Array.from({ length: 20 }, () =>
            rpc(replacement, "set_job_waitlist", [q(f.job), "true"]),
          ),
        );
        assert.ok(attempts.every((x) => x.joined));
        assert.equal(
          await sql(
            `select count(*) from private.job_waitlist where job_id=${q(f.job)}`,
          ),
          "1",
        );
        assert.equal(await summary(f), before);
        assert.equal(
          (await rpc(peer, "job_waitlist", [q(f.job)])).joined,
          false,
        );
        await assert.rejects(
          actor(admin, "select * from private.job_waitlist", "aal2"),
          /permission denied/,
        );
        await assert.rejects(
          rpc(participant, "set_job_waitlist", [q(f.job), "true"]),
          /42501/,
        );
        await rpc(replacement, "set_job_waitlist", [q(f.job), "false"]);
        assert.equal(
          (await rpc(replacement, "set_job_waitlist", [q(f.job), "false"]))
            .joined,
          false,
        );
        await assert.rejects(
          rpc(teacher, "set_job_waitlist", [q(f.job), "true"]),
          /22023/,
        );
      },
    );
    await check(
      "Reopening notifies only currently eligible subscribed waiters and never reserves the reopened place",
      async () => {
        const f = await make();
        for (const who of [replacement, unqualified, peer])
          await rpc(who, "set_job_waitlist", [q(f.job), "true"]);
        await sql(
          `update private.notification_preferences set job_updates=false where user_id=${q(peer)}`,
        );
        await textRpc(teacher, "cancel_job_assignment", [
          q(f.claim),
          q("Fictional cancellation for reopened course"),
          q(randomUUID()),
        ]);
        assert.equal(
          (await rpc(replacement, "job_waitlist", [q(f.job)])).joined,
          true,
        );
        const version = await sql(
          `select lifecycle_version from public.jobs where id=${q(f.job)}`,
        );
        await textRpc(
          admin,
          "manage_job_offer",
          [
            q(f.job),
            q("reopen"),
            version,
            q(randomUUID()),
            q('{"reason":"Fictional reopened whole block"}'),
          ],
          "aal2",
        );
        const ids = JSON.parse(
          await sql(
            `select coalesce(jsonb_agg(user_id),'[]') from public.notifications where resource_id=${q(f.job)} and kind='job_waitlist_available'`,
          ),
        );
        assert.deepEqual(ids, [replacement]);
        assert.equal(
          await sql(
            `select count(*) from public.job_claims where job_id=${q(f.job)} and status='confirmed'`,
          ),
          "0",
        );
        const winners = await Promise.all(
          [replacement, peer].map((who) =>
            rpc(who, "claim_job", [q(f.job), q(randomUUID()), "1"]),
          ),
        );
        assert.equal(winners.filter((x) => x.status === "confirmed").length, 1);
        assert.equal(winners.filter((x) => x.status === "filled").length, 1);
        await sql(
          `update private.notification_preferences set job_updates=true where user_id=${q(peer)}`,
        );
      },
    );
    await check(
      "Only source assignee or current MFA management proposes; candidate projection exposes no private calendars",
      async () => {
        const f = await make();
        const candidates = await rpc(teacher, "substitution_candidates", [
          q(f.claim),
        ]);
        assert.ok(candidates.some((x) => x.id === replacement));
        assert.ok(!candidates.some((x) => x.id === unqualified));
        assert.ok(
          candidates.every(
            (x) => Object.keys(x).sort().join(",") === "display_name,id",
          ),
        );
        for (const who of [peer, admin, participant])
          await assert.rejects(propose(f, replacement, who), /42501/);
        const id = await propose(f, replacement, admin, randomUUID(), "aal2");
        assert.equal(
          (await offers(replacement)).find((x) => x.id === id).can_accept,
          true,
        );
        assert.equal((await offers(peer)).length, 0);
        await assert.rejects(offers(peer, f.job), /42501/);
        await assert.rejects(
          actor(replacement, "select * from private.job_substitutions"),
          /permission denied/,
        );
        await assert.rejects(accept(id, admin), /42501/);
      },
    );
    await check(
      "Proposal retries are exact, immutable and do not cancel source work or expose other contracts",
      async () => {
        const f = await make();
        const key = randomUUID(),
          before = await summary(f);
        const id = await propose(f, replacement, teacher, key);
        assert.equal(await propose(f, replacement, teacher, key), id);
        await assert.rejects(propose(f, peer, teacher, key), /22023/);
        await assert.rejects(propose(f, peer), /23505/);
        assert.equal(await summary(f), before);
        const offer = (await offers(replacement)).find((x) => x.id === id);
        assert.equal(offer.quote.sessions.length, 5);
        assert.equal(offer.quote.total_amount, 625);
        assert.ok(!JSON.stringify(offer.quote).includes("contract_id"));
        assert.ok(!JSON.stringify(offer.quote).includes("platform_percent"));
        await assert.rejects(
          sql(
            `update private.job_substitutions set quote='{}' where id=${q(id)}`,
          ),
          /23514/,
        );
        await assert.rejects(
          accept(id, replacement, { consent: false }),
          /22023/,
        );
        await assert.rejects(
          accept(id, replacement, { hash: "forged" }),
          /22023/,
        );
      },
    );
    await check(
      "Acceptance transfers every session atomically, preserves the old accepted deal and revokes old chat/files",
      async () => {
        const f = await make(),
          id = await propose(f);
        const original = JSON.parse(
          await sql(
            `select to_jsonb(c)-'status' from public.job_claims c where id=${q(f.claim)}`,
          ),
        );
        const doc = randomUUID();
        await sql(
          `insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,original_name,mime_type,size_bytes,status,client_id) values(${q(doc)},${q(admin)},${q(admin)},'job_after','material',${q(f.job)},'Fictional protected handout.pdf','application/pdf',1,'clean',${q(randomUUID())})`,
        );
        assert.equal(
          await actor(teacher, `select private.can_access_document(${q(doc)})`),
          "t",
        );
        const key = randomUUID();
        const result = await accept(id, replacement, { key });
        assert.equal(result.status, "confirmed");
        assert.equal(
          (await accept(id, replacement, { key })).claim_id,
          result.claim_id,
        );
        const copied = JSON.parse(
          await sql(
            `select to_jsonb(c) from public.job_claims c where id=${q(result.claim_id)}`,
          ),
        );
        for (const field of [
          "amount",
          "currency",
          "rate_unit",
          "total_amount",
          "terms",
          "terms_version",
        ])
          assert.equal(copied[field], original[field]);
        assert.deepEqual(
          JSON.parse(
            await sql(
              `select to_jsonb(c)-'status' from public.job_claims c where id=${q(f.claim)}`,
            ),
          ),
          original,
        );
        assert.equal(
          await sql(
            `select status from public.job_claims where id=${q(f.claim)}`,
          ),
          "cancelled",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions where claim_id=${q(result.claim_id)} and released_at is null`,
          ),
          "5",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions where claim_id=${q(f.claim)} and released_at is not null`,
          ),
          "5",
        );
        assert.equal(
          await sql(
            `select count(*) from public.job_claims where job_id=${q(f.job)} and status='confirmed'`,
          ),
          "1",
        );
        assert.equal(
          await actor(teacher, `select private.can_access_document(${q(doc)})`),
          "f",
        );
        assert.equal(
          await actor(
            replacement,
            `select private.can_access_document(${q(doc)})`,
          ),
          "t",
        );
        const room = await sql(
          `select id from public.chat_rooms where job_id=${q(f.job)}`,
        );
        assert.equal(
          await actor(
            teacher,
            `select private.can_access_chat_room(${q(room)})`,
          ),
          "f",
        );
        assert.equal(
          await actor(
            replacement,
            `select private.can_access_chat_room(${q(room)})`,
          ),
          "t",
        );
        assert.equal(
          (await offers(replacement)).find((x) => x.id === id).status,
          "accepted",
        );
      },
    );
    await check(
      "Fifty simultaneous acceptance retries have one replacement claim and one complete calendar block",
      async () => {
        const f = await make(),
          id = await propose(f),
          key = randomUUID();
        const replies = await Promise.all(
          Array.from({ length: 50 }, () => accept(id, replacement, { key })),
        );
        assert.ok(replies.every((r) => r.status === "confirmed"));
        assert.equal(new Set(replies.map((r) => r.claim_id)).size, 1);
        assert.equal(
          await sql(
            `select count(*) from public.job_claims where job_id=${q(f.job)}`,
          ),
          "2",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where c.job_id=${q(f.job)} and a.released_at is null`,
          ),
          "5",
        );
      },
    );
    await check(
      "New conflicts, revoked qualifications, missing contracts and changed quotes revalidate without partial releases",
      async () => {
        for (const condition of [
          "calendar",
          "availability",
          "qualification",
          "contract",
          "quote",
        ]) {
          const f = await make(),
            id = await propose(f);
          const before = await summary(f);
          let event;
          if (condition === "calendar") {
            event = await actor(
              replacement,
              `insert into public.personal_events(user_id,title,starts_at,ends_at) values(${q(replacement)},'PRIVATE changed event',${f.start},${f.start}+interval '1 hour') returning id`,
            );
          }
          if (condition === "availability") {
            event = randomUUID();
            await sql(
              `insert into public.lecturer_availability(id,user_id,kind,starts_at,ends_at) values(${q(event)},${q(replacement)},'unavailable',${f.start},${f.start}+interval '1 hour')`,
            );
          }
          if (condition === "qualification")
            await sql(
              `update public.lecturer_topics set verified=false where user_id=${q(replacement)} and topic_id=${q(topic)}`,
            );
          if (condition === "contract")
            await sql(
              `update public.jobs set requires_contract=true where id=${q(f.job)};`,
            );
          if (condition === "quote")
            await sql(
              `update public.jobs set location='https://example.invalid/changed' where id=${q(f.job)}`,
            );
          const response = await accept(id);
          const expected =
            condition === "calendar" || condition === "availability"
              ? "conflict"
              : condition === "qualification"
                ? "not_eligible"
                : "terms_changed";
          assert.equal(response.status, expected);
          assert.equal(await summary(f), before);
          if (condition === "qualification")
            await sql(
              `update public.lecturer_topics set verified=true where user_id=${q(replacement)} and topic_id=${q(topic)}`,
            );
          if (condition === "calendar")
            await sql(
              `delete from public.personal_events where id=${q(event)}`,
            );
          if (condition === "availability")
            await sql(
              `delete from public.lecturer_availability where id=${q(event)}`,
            );
        }
      },
    );
    await check(
      "Decline/withdraw are explicit and idempotent; source cancellation supersedes a pending request",
      async () => {
        for (const action of ["decline", "withdraw"]) {
          const f = await make(),
            id = await propose(f),
            who = action === "decline" ? replacement : teacher,
            key = randomUUID();
          const args = [q(id), q(action), "null", q(key), "false"];
          assert.equal(
            (await rpc(who, "respond_job_substitution", args)).status,
            action === "decline" ? "declined" : "withdrawn",
          );
          assert.equal(
            (await rpc(who, "respond_job_substitution", args)).status,
            action === "decline" ? "declined" : "withdrawn",
          );
          assert.equal((await accept(id)).status, "unavailable");
          assert.equal(
            await sql(
              `select status from public.job_claims where id=${q(f.claim)}`,
            ),
            "confirmed",
          );
        }
        const f = await make(),
          id = await propose(f);
        await textRpc(teacher, "cancel_job_assignment", [
          q(f.claim),
          q("Fictional cancellation while offer pending"),
          q(randomUUID()),
        ]);
        assert.equal(
          (await offers(replacement)).find((x) => x.id === id).status,
          "superseded",
        );
        assert.equal((await accept(id)).status, "unavailable");
        await rpc(replacement, "set_job_waitlist", [q(f.job), "false"]);
      },
    );
    await check(
      "Replacement calendar edit versus acceptance serializes to one winner and never loses the original allocation on rejection",
      async () => {
        const f = await make(),
          id = await propose(f);
        const results = await Promise.allSettled([
          accept(id),
          actor(
            replacement,
            `insert into public.personal_events(user_id,title,starts_at,ends_at) values(${q(replacement)},'PRIVATE concurrent event',${f.start},${f.start}+interval '1 hour')`,
          ),
        ]);
        const accepted =
          results[0].status === "fulfilled" &&
          results[0].value.status === "confirmed";
        if (accepted) {
          assert.equal(results[1].status, "rejected");
          assert.match(results[1].reason.message, /23P01/);
        } else {
          assert.equal(results[0].status, "fulfilled");
          assert.equal(results[0].value.status, "conflict");
          assert.equal(results[1].status, "fulfilled");
          assert.equal(
            await sql(
              `select status from public.job_claims where id=${q(f.claim)}`,
            ),
            "confirmed",
          );
        }
      },
    );
    await check(
      "Original cancellation versus acceptance has one coherent terminal result",
      async () => {
        const f = await make(),
          id = await propose(f);
        const replies = await Promise.allSettled([
          accept(id),
          textRpc(teacher, "cancel_job_assignment", [
            q(f.claim),
            q("Fictional concurrent source cancellation"),
            q(randomUUID()),
          ]),
        ]);
        const accepted =
          replies[0].status === "fulfilled" &&
          replies[0].value.status === "confirmed";
        assert.equal(
          await sql(
            `select count(*) from public.job_claims where job_id=${q(f.job)} and status='confirmed'`,
          ),
          accepted ? "1" : "0",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where c.job_id=${q(f.job)} and a.released_at is null`,
          ),
          accepted ? "5" : "0",
        );
        if (!accepted) assert.equal(replies[1].status, "fulfilled");
      },
    );
    await check(
      "Accepted revenue snapshots are retained and copied unchanged; a changed private pricing ledger blocks transfer",
      async () => {
        const f = await make(true),
          id = await propose(f);
        const before = await sql(
          `select (to_jsonb(l)-array['claim_id','lecturer_id','accepted_at'])::text from private.claim_revenue_ledger l where claim_id=${q(f.claim)}`,
        );
        const result = await accept(id);
        assert.equal(result.status, "confirmed");
        assert.equal(
          await sql(
            `select (to_jsonb(l)-array['claim_id','lecturer_id','accepted_at'])::text from private.claim_revenue_ledger l where claim_id=${q(result.claim_id)}`,
          ),
          before,
        );
        assert.equal(
          await sql(
            `select (to_jsonb(l)-array['claim_id','lecturer_id','accepted_at'])::text from private.claim_revenue_ledger l where claim_id=${q(f.claim)}`,
          ),
          before,
        );
        const changed = await make(true),
          changedId = await propose(changed),
          unchanged = await summary(changed);
        await sql(
          `update private.job_commission_offers set gross_amount=gross_amount+1,gross_total_amount=gross_total_amount+1,platform_total_amount=platform_total_amount+1 where job_id=${q(changed.job)}`,
        );
        assert.equal((await accept(changedId)).status, "financial_review");
        assert.equal(await summary(changed), unchanged);
      },
    );
    await check(
      "Started work, existing invoices and even cancelled invoice history block handover",
      async () => {
        const started = await make();
        await sql(
          `update public.assignment_sessions set starts_at=starts_at-interval '30 years',ends_at=ends_at-interval '30 years' where claim_id=${q(started.claim)}`,
        );
        await assert.rejects(propose(started), /22023/);
        const f = await make(),
          id = await propose(f),
          submit = await prepareInvoice(f);
        const invoice = await submit();
        const before = await summary(f);
        assert.equal((await accept(id)).status, "unavailable");
        await sql(
          `update public.invoice_items set active=false where invoice_id=${q(invoice)};update public.invoices set status='cancelled' where id=${q(invoice)}`,
        );
        assert.equal((await accept(id)).status, "unavailable");
        assert.equal(await summary(f), before);
        await assert.rejects(propose(f, peer), /22023/);
      },
    );
    await check(
      "Invoice creation versus handover shares the source lecturer lock and has one coherent winner",
      async () => {
        const f = await make(),
          id = await propose(f),
          submit = await prepareInvoice(f);
        const results = await Promise.allSettled([accept(id), submit()]);
        if (
          results[0].status === "fulfilled" &&
          results[0].value.status === "confirmed"
        ) {
          assert.equal(results[1].status, "rejected");
          assert.match(results[1].reason.message, /42501/);
          assert.equal(
            await sql(
              `select count(*) from public.invoice_items where claim_id=${q(f.claim)}`,
            ),
            "0",
          );
        } else {
          assert.equal(results[1].status, "fulfilled");
          assert.equal(results[0].status, "fulfilled");
          assert.equal(results[0].value.status, "unavailable");
          assert.equal(
            await sql(
              `select status from public.job_claims where id=${q(f.claim)}`,
            ),
            "confirmed",
          );
        }
      },
    );
    await check(
      "Recipient decline versus acceptance creates either the complete replacement or no replacement",
      async () => {
        const f = await make(),
          id = await propose(f);
        const results = await Promise.all([
          accept(id),
          rpc(replacement, "respond_job_substitution", [
            q(id),
            q("decline"),
            "null",
            q(randomUUID()),
            "false",
          ]),
        ]);
        const accepted = results[0].status === "confirmed";
        assert.equal(
          await sql(
            `select count(*) from public.job_claims where job_id=${q(f.job)} and lecturer_id=${q(replacement)} and status='confirmed'`,
          ),
          accepted ? "1" : "0",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions where claim_id=${q(f.claim)} and released_at is null`,
          ),
          accepted ? "0" : "5",
        );
        if (!accepted) assert.equal(results[1].status, "declined");
      },
    );
    await check(
      "Anonymous, inactive and forged recipient access cannot read or accept substitution quotes",
      async () => {
        const f = await make(),
          id = await propose(f);
        await assert.rejects(
          rpc(peer, "respond_job_substitution", [
            q(id),
            q("accept"),
            q("forged"),
            q(randomUUID()),
            "true",
          ]),
          /42501/,
        );
        await sql(
          `update public.profiles set active=false where id=${q(replacement)}`,
        );
        await assert.rejects(offers(replacement), /42501/);
        await assert.rejects(accept(id), /42501/);
        assert.equal(
          await sql(
            "select has_function_privilege('anon','public.job_substitutions(uuid)','execute')",
          ),
          "f",
        );
      },
    );
    console.log(
      `${checks} assignment waitlist/substitution PostgreSQL groups passed.`,
    );
  },
  { migrationsThrough: "20261116031429" },
);
