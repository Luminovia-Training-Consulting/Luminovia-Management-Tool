/** Availability's actual mutex, privacy and atomic claim boundaries. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";
await withTestDatabase(
  "availability_test",
  async ({ sql, actor }) => {
    const teacher = randomUUID(),
      peer = randomUUID(),
      admin = randomUUID(),
      participant = randomUUID();
    await sql(
      `insert into auth.users(id,email) values ${[teacher, peer, admin, participant].map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${teacher}','lecturer'),('${peer}','lecturer'),('${admin}','admin'),('${participant}','participant');update public.profiles set display_name='Fictional available teacher',phone='PRIVATE CONTACT' where id='${teacher}'`,
    );
    const rpc = async (who, name, args = [], aal = "aal1") => {
      const value = await actor(
        who,
        `select public.${name}(${args.map((value) => (value === null ? "null" : typeof value === "number" || typeof value === "boolean" ? String(value) : q(typeof value === "object" ? JSON.stringify(value) : value))).join(",")})`,
        aal,
      );
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    const window = (from, to, kind = "available", shared = false) => ({
      kind,
      starts_at: from,
      ends_at: to,
      time_zone: "Europe/Berlin",
      notes: "PRIVATE availability note",
      share_with_management: shared,
    });
    const save = (id, payload, version = 0, who = teacher) =>
      rpc(who, "save_lecturer_availability", [id, payload, version]);
    const create = async (sessions) =>
      rpc(
        admin,
        "create_job",
        [
          {
            title: "Fictional availability course",
            customer_name: "Fictional customer",
            delivery_type: "online",
            status: "published",
            amount: 100,
            total_amount: 100,
            currency: "EUR",
            rate_unit: "fixed_total",
            terms: "Preserved accepted agreement",
            requires_contract: false,
            sessions,
          },
        ],
        "aal2",
      );
    const claim = async (job) =>
      rpc(teacher, "claim_job", [
        job,
        randomUUID(),
        Number(
          await sql(`select terms_version from public.jobs where id='${job}'`),
        ),
      ]);
    let count = 0;
    const check = async (name, fn) => {
      await fn();
      count++;
      console.log(`PASS ${name}`);
    };
    const id = randomUUID(),
      first = window("2041-01-01T08:00:00Z", "2041-01-01T09:00:00Z");
    await check(
      "Own windows are private by default, exact-ID retries are idempotent and direct writes denied",
      async () => {
        for (const role of ["anon", "authenticated"])
          for (const signature of [
            "private.check_availability_window()",
            "private.check_assignment_availability()",
            "private.validate_availability_range(timestamp with time zone,timestamp with time zone,integer)",
          ])
            assert.equal(
              await sql(
                `select has_function_privilege(${q(role)},${q(signature)},'execute')`,
              ),
              "f",
              `${role} must not execute internal availability helpers`,
            );
        await assert.rejects(
          actor(
            teacher,
            "select private.validate_availability_range(now(),now()+interval '1 hour',1)",
          ),
          /permission denied/,
        );
        assert.equal(await save(id, first), id);
        assert.equal(await save(id, first), id);
        assert.equal(
          await sql(
            `select count(*) from public.lecturer_availability where id='${id}'`,
          ),
          "1",
        );
        assert.equal(
          await actor(
            peer,
            "select count(*) from public.lecturer_availability",
          ),
          "0",
        );
        assert.equal(
          await actor(
            admin,
            "select count(*) from public.lecturer_availability",
            "aal2",
          ),
          "0",
        );
        await assert.rejects(
          actor(
            teacher,
            `insert into public.lecturer_availability(id,user_id,kind,starts_at,ends_at) values('${randomUUID()}','${teacher}','available','2041-01-02','2041-01-03')`,
          ),
          /permission denied/,
        );
        await assert.rejects(
          save(id, first, 1, admin),
          /Availability access denied/,
        );
        await assert.rejects(
          save(randomUUID(), first, 0, participant),
          /Active lecturer account required/,
        );
      },
    );
    await check(
      "Explicit shared projection requires current MFA capability and never exposes notes, contacts or private events",
      async () => {
        await assert.rejects(
          rpc(admin, "shared_availability", ["2041-01-01", "2041-02-01"]),
          /availability.read_shared and MFA required/,
        );
        await assert.rejects(
          rpc(
            peer,
            "shared_availability",
            ["2041-01-01", "2041-02-01"],
            "aal2",
          ),
          /availability.read_shared and MFA required/,
        );
        assert.deepEqual(
          await rpc(
            admin,
            "shared_availability",
            ["2041-01-01", "2041-02-01"],
            "aal2",
          ),
          [],
        );
        await save(id, { ...first, share_with_management: true }, 1);
        const shared = await rpc(
          admin,
          "shared_availability",
          ["2041-01-01", "2041-02-01"],
          "aal2",
        );
        assert.equal(shared.length, 1);
        assert.equal(shared[0].user_id, teacher);
        assert.equal("notes" in shared[0], false);
        assert.equal("phone" in shared[0], false);
        assert.equal("share_with_management" in shared[0], false);
        await save(id, first, 2);
        assert.deepEqual(
          await rpc(
            admin,
            "shared_availability",
            ["2041-01-01", "2041-02-01"],
            "aal2",
          ),
          [],
        );
      },
    );
    await check(
      "Finite local-time metadata, strict payloads, bounded lists and stale updates are enforced",
      async () => {
        for (const bad of [
          { ...first, user_id: peer },
          { ...first, starts_at: "-infinity" },
          { ...first, ends_at: "infinity" },
          { ...first, ends_at: first.starts_at },
          { ...first, time_zone: "Not/AZone" },
          { ...first, starts_at: "2041-01-01T08:00:00" },
          { ...first, notes: [] },
          { ...first, share_with_management: "yes" },
        ])
          await assert.rejects(save(randomUUID(), bad));
        await assert.rejects(save(id, first, 1), /Stale availability version/);
        await assert.rejects(
          rpc(teacher, "remove_lecturer_availability", [id, 1]),
          /Stale availability version/,
        );
        assert.equal(
          (await rpc(teacher, "my_availability", ["2041-01-01", "2041-02-01"]))
            .length,
          1,
        );
        await assert.rejects(
          rpc(teacher, "my_availability", ["2041-01-01", "2043-01-01"]),
          /Invalid bounded availability range/,
        );
        await assert.rejects(
          rpc(
            admin,
            "shared_availability",
            ["2041-01-01", "2041-07-01"],
            "aal2",
          ),
          /Invalid bounded availability range/,
        );
        await assert.rejects(
          rpc(
            admin,
            "shared_availability",
            ["-infinity", "2041-02-01"],
            "aal2",
          ),
          /Invalid bounded availability range/,
        );
      },
    );
    await check(
      "An unavailable final session rolls back every earlier allocation and claim side effect",
      async () => {
        const block = randomUUID();
        await save(
          block,
          window("2041-02-02T08:15:00Z", "2041-02-02T08:45:00Z", "unavailable"),
        );
        const job = await create([
          {
            starts_at: "2041-02-01T08:00:00Z",
            ends_at: "2041-02-01T09:00:00Z",
          },
          {
            starts_at: "2041-02-02T08:00:00Z",
            ends_at: "2041-02-02T09:00:00Z",
          },
        ]);
        assert.equal((await claim(job)).status, "conflict");
        assert.equal(
          await sql(
            `select count(*) from public.job_claims where job_id='${job}'`,
          ),
          "0",
        );
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions a join public.job_claims c on c.id=a.claim_id where c.job_id='${job}'`,
          ),
          "0",
        );
        assert.equal(
          await sql(`select status from public.jobs where id='${job}'`),
          "published",
        );
      },
    );
    await check(
      "Available hints do not reserve time and half-open adjacent unavailable windows still allow claims",
      async () => {
        await save(
          randomUUID(),
          window("2041-03-01T08:00:00Z", "2041-03-01T09:00:00Z", "unavailable"),
        );
        await save(
          randomUUID(),
          window("2041-03-01T09:00:00Z", "2041-03-01T10:00:00Z", "available"),
        );
        const job = await create([
          {
            starts_at: "2041-03-01T09:00:00Z",
            ends_at: "2041-03-01T10:00:00Z",
          },
        ]);
        assert.equal((await claim(job)).status, "confirmed");
      },
    );
    await check(
      "An unavailable edit cannot cover an accepted assignment; cancellation releases time without mutating its interval",
      async () => {
        const starts = "2041-04-01T08:00:00Z",
          ends = "2041-04-01T09:00:00Z",
          job = await create([{ starts_at: starts, ends_at: ends }]);
        const accepted = await claim(job);
        assert.equal(accepted.status, "confirmed");
        await assert.rejects(
          save(randomUUID(), window(starts, ends, "unavailable")),
          /Availability conflicts with a confirmed assignment/,
        );
        const available = randomUUID();
        await save(available, window(starts, ends));
        await assert.rejects(
          save(available, window(starts, ends, "unavailable"), 1),
          /Availability conflicts with a confirmed assignment/,
        );
        await rpc(teacher, "cancel_job_assignment", [
          accepted.claim_id,
          "Fictional cancellation",
          randomUUID(),
        ]);
        await save(randomUUID(), window(starts, ends, "unavailable"));
        assert.equal(
          await sql(
            `select count(*) from public.assignment_sessions where claim_id='${accepted.claim_id}' and released_at is not null and starts_at='${starts}'::timestamptz and ends_at='${ends}'::timestamptz`,
          ),
          "1",
        );
      },
    );
    await check(
      "A simultaneous actual claim and blockout have one winner with no partially accepted graph",
      async () => {
        const starts = "2041-05-01T08:00:00Z",
          ends = "2041-05-01T09:00:00Z",
          job = await create([{ starts_at: starts, ends_at: ends }]),
          block = randomUUID();
        const [booking, blocking] = await Promise.allSettled([
          claim(job),
          save(block, window(starts, ends, "unavailable")),
        ]);
        const accepted =
            booking.status === "fulfilled" &&
            booking.value.status === "confirmed",
          blocked = blocking.status === "fulfilled";
        assert.notEqual(accepted, blocked);
        assert.equal(
          await sql(
            `select count(*) from public.job_claims where job_id='${job}' and status='confirmed'`,
          ),
          accepted ? "1" : "0",
        );
        assert.equal(
          await sql(
            `select count(*) from public.lecturer_availability where id='${block}'`,
          ),
          blocked ? "1" : "0",
        );
      },
    );
    await check(
      "Own removal is versioned and old suspended tokens and anonymous calls remain denied",
      async () => {
        await assert.rejects(
          rpc(peer, "remove_lecturer_availability", [id, 3]),
          /Availability access denied/,
        );
        await rpc(teacher, "remove_lecturer_availability", [id, 3]);
        assert.equal(
          await sql(
            `select count(*) from public.lecturer_availability where id='${id}'`,
          ),
          "0",
        );
        await sql(
          `update public.profiles set active=false where id='${teacher}'`,
        );
        await assert.rejects(
          rpc(teacher, "my_availability", ["2041-01-01", "2041-02-01"]),
          /Active login required/,
        );
        await assert.rejects(
          save(randomUUID(), first),
          /Active lecturer account required/,
        );
        assert.equal(
          await actor(
            teacher,
            "select count(*) from public.lecturer_availability",
          ),
          "0",
        );
        await assert.rejects(
          sql(
            `set role anon;select public.my_availability('2041-01-01','2041-02-01')`,
          ),
          /permission denied/,
        );
      },
    );
    console.log(`${count} availability PostgreSQL checks passed.`);
  },
  { migrationsThrough: "20261115210134" },
);
