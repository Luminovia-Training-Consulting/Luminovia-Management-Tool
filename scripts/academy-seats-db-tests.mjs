/** Verify signed seat occupancy and concurrent admissions on native PostgreSQL. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import {
  configureAcademyCourseAccess,
  prepareAcademyInstallation,
} from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const seatLimit = (error) =>
  /PT409:/.test(error.message) &&
  /DETAIL:.*academy_seat_limit/.test(error.message);
const gate = (name) => `set local request.path=${q("/rpc/" + name)};
  set local request.method='POST'; select public.require_portal_access()`;
const call = (name, ...args) =>
  `${gate(name)}; select public.${name}(${args.join(",")})`;
const reservation = (request, email) =>
  call(
    "reserve_academy_account",
    q(request),
    q(email),
    "'Fictional account'",
    "'lecturer'",
    "null",
    "'invite'",
  );
const activation = (id, active) =>
  call("academy_set_member_active", q(id), active, !active);

async function waitForBarrier(sql, name) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const waiting = await sql(`select exists(select 1 from pg_stat_activity
      where datname=current_database() and application_name=${q(name)}
      and wait_event='PgSleep')`);
    if (waiting === "t") return;
    await wait(25);
  }
  throw new Error("Seat holder did not reach its PostgreSQL barrier");
}

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_seats", async ({ sql, actor }) => {
    const [admin, secondAdmin, instructor, suspended, roleless] = Array.from(
      { length: 5 },
      randomUUID,
    );
    const key = generateKeyPairSync("ed25519");
    const now = Date.now();
    const date = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: randomUUID(),
      edition,
      release_commit: "ac".repeat(20),
      issued_at: date(-10),
      starts_at: date(-1),
      expires_at: date(2),
      grace_until: date(4),
      modules: ["lms"],
      limits: {
        seat_count: 1,
        storage_bytes: 20_000_000,
        api_requests_per_minute: 60,
      },
    };
    const signed = (expected = terms) => ({
      envelope: signAcademyLicence(expected, key.privateKey),
      publicKey: key.publicKey,
      expected,
      now,
    });
    const seedIdentity = (
      id,
      email = id + "@example.invalid",
      confirmed = true,
    ) =>
      sql(`insert into auth.users(id,email,email_confirmed_at,created_at)
        values (${q(id)},${q(email)},${confirmed ? "now()" : "null"},clock_timestamp())`);
    const bootstrap = () =>
      prepareAcademyInstallation(
        { ...signed(), firstAdministrator: admin },
        sql,
      );
    const usage = (maximum, occupied) =>
      sql("select seat_limit,occupied from private.academy_seat_usage()").then(
        (row) => assert.equal(row, `${maximum}|${occupied}`),
      );
    const rpc = async (who, statement) =>
      JSON.parse(await actor(who, statement));
    const reserve = (who, requestId, email) =>
      rpc(who, reservation(requestId, email));
    const setActive = (who, id, active) => rpc(who, activation(id, active));
    const finish = async (id, decision, user = null) =>
      JSON.parse(
        await sql(`begin; set local role service_role;
        ${call("finish_academy_account", q(id), user ? q(user) : "null", q(decision))}; commit;`),
      );
    // Trigger the real aged-reservation recovery without a ten-minute wall-clock delay.
    const clearAbandoned = async (id) => {
      await sql(`update private.academy_account_requests
        set created_at = clock_timestamp() - interval '11 minutes' where id=${q(id)}`);
      assert.deepEqual(await finish(id, "cleanup"), { status: "failed" });
    };
    let renewal = 0;
    const renew = (seatCount) =>
      prepareAcademyInstallation(
        signed({
          ...terms,
          issued_at: date(-10 + ++renewal),
          limits: { ...terms.limits, seat_count: seatCount },
        }),
        sql,
      );
    const overlap = async (
      first,
      secondStatement,
      expectedError = seatLimit,
      repeatable = false,
    ) => {
      const holder = "seat-holder-" + randomUUID().slice(0, 8);
      const contender = "seat-contender-" + randomUUID().slice(0, 8);
      const winner = actor(
        admin,
        `set local application_name=${q(holder)}; ${first}; reset role;
        do $barrier$ declare deadline timestamptz := clock_timestamp()+interval '10 seconds'; begin loop
          perform pg_stat_clear_snapshot();
          exit when exists(select 1 from pg_stat_activity where datname=current_database()
            and application_name=${q(contender)} and wait_event_type='Lock');
          if clock_timestamp()>deadline then raise exception 'Seat contender did not reach the lock'; end if;
          perform pg_sleep(0.03);
        end loop; end;$barrier$`,
      ).then(
        (receipt) => ({ receipt }),
        (error) => ({ error }),
      );
      await waitForBarrier(sql, holder);
      await assert.rejects(
        actor(
          secondAdmin,
          `${repeatable ? "set transaction isolation level repeatable read;" : ""}
          set local application_name=${q(contender)}; ${secondStatement}`,
        ),
        expectedError,
      );
      const result = await winner;
      if (result.error) throw result.error;
      return JSON.parse(result.receipt);
    };

    await prepareAcademyInstallation(signed(), sql);
    for (const id of [admin, secondAdmin, instructor, suspended, roleless])
      await seedIdentity(id);
    await sql(
      `insert into public.user_roles(user_id,role) values (${q(instructor)},'lecturer')`,
    );
    await usage(1, 1);
    await assert.rejects(bootstrap(), seatLimit);
    await sql(
      `update public.profiles set active=false where id=${q(instructor)}`,
    );
    assert.equal((await bootstrap()).first_administrator, admin);
    assert.equal((await bootstrap()).first_administrator, admin);
    await usage(1, 1);

    await renew(4);
    await configureAcademyCourseAccess({ ...signed(), enabled: true }, sql);
    await sql(`insert into public.user_roles(user_id,role)
      values (${q(secondAdmin)},'admin'),(${q(suspended)},'lecturer');
      update public.profiles set active=false where id=${q(suspended)}`);
    await setActive(admin, instructor, true);
    await rpc(admin, call("academy_set_management", q(instructor), true, 0));
    await usage(4, 3);
    await assert.rejects(
      actor(admin, "select * from private.academy_seat_usage()"),
      /42501/,
    );
    await assert.rejects(
      sql(
        "begin;set local role service_role;select * from private.academy_seat_usage();commit",
      ),
      /42501/,
    );

    const request = randomUUID();
    const email = "last-seat@example.invalid";
    const held = await overlap(
      reservation(request, email),
      reservation(randomUUID(), "second-admin@example.invalid"),
    );
    assert.equal(held.status, "reserved");
    await usage(4, 4);
    assert.deepEqual(await reserve(admin, request, email), {
      status: "in_progress",
      creation_id: held.creation_id,
      user_id: null,
    });
    await assert.rejects(
      reserve(admin, request, "changed@example.invalid"),
      /PT409:.*Account request changed/,
    );
    await assert.rejects(setActive(secondAdmin, suspended, true), seatLimit);
    assert.equal((await rpc(admin, activation(instructor, true))).active, true);

    const incompleteAuth = randomUUID();
    await seedIdentity(incompleteAuth, email, false);
    assert.deepEqual(
      await finish(held.creation_id, "cleanup", incompleteAuth),
      {
        status: "cleanup",
        user_id: incompleteAuth,
      },
    );
    await usage(4, 4);
    await assert.rejects(
      finish(held.creation_id, "discard", incompleteAuth),
      /42501/,
    );
    await assert.rejects(
      reserve(secondAdmin, randomUUID(), "cleanup-holds@example.invalid"),
      seatLimit,
    );
    await sql(`delete from auth.users where id=${q(incompleteAuth)}`);
    assert.deepEqual(
      await finish(held.creation_id, "discard", incompleteAuth),
      { status: "failed" },
    );
    await usage(4, 3);

    const inviteRequest = randomUUID();
    const inviteEmail = "invited-lecturer@example.invalid";
    const invited = await overlap(
      reservation(inviteRequest, inviteEmail),
      activation(suspended, true),
    );
    const inviteUser = randomUUID();
    await seedIdentity(inviteUser, inviteEmail, false);
    // Lowering the signed limit preserves existing active accounts and the already-held reservation.
    await renew(2);
    await usage(2, 4);
    assert.deepEqual(
      await finish(invited.creation_id, "complete", inviteUser),
      {
        status: "created",
        user_id: inviteUser,
      },
    );
    assert.deepEqual(await reserve(admin, inviteRequest, inviteEmail), {
      status: "created",
      creation_id: invited.creation_id,
      user_id: inviteUser,
    });
    await usage(2, 4);
    await assert.rejects(
      reserve(admin, randomUUID(), "above-limit@example.invalid"),
      seatLimit,
    );
    assert.equal((await setActive(admin, instructor, false)).active, false);
    await assert.rejects(setActive(secondAdmin, suspended, true), seatLimit);
    await usage(2, 3);

    // Historical inconsistent saga records are counted once when they already
    // name the exact active role-holder, with or without a persisted Auth ID.
    for (const identity of ["null", q(inviteUser)]) {
      await sql(`update private.academy_account_requests
        set status='cleanup', user_id=${identity} where id=${q(invited.creation_id)}`);
      await usage(2, 3);
    }
    assert.equal((await setActive(admin, inviteUser, false)).active, false);
    await usage(2, 3);
    assert.equal((await setActive(admin, inviteUser, true)).active, true);
    await usage(2, 3);
    await sql(`update private.academy_account_requests set status='created'
      where id=${q(invited.creation_id)}`);
    assert.equal(
      await sql(`select count(*) from public.profiles
      where id in (${q(admin)},${q(secondAdmin)},${q(inviteUser)}) and active`),
      "3",
    );

    await renew(4);
    const reactivated = await overlap(
      activation(suspended, true),
      reservation(randomUUID(), "reactivation-wins@example.invalid"),
    );
    assert.equal(reactivated.active, true);
    await usage(4, 4);
    await setActive(admin, suspended, false);
    const stale = await overlap(
      reservation(randomUUID(), "repeatable-holder@example.invalid"),
      activation(suspended, true),
      /40001:.*concurrent update/,
      true,
    );
    await usage(4, 4);
    await clearAbandoned(stale.creation_id);
    await usage(4, 3);
    await setActive(secondAdmin, suspended, true);
    await usage(4, 4);
    console.log(
      `PASS ${edition} signed seats, first admin, deduplicated humans, Auth compensation, cap reductions, reliable retries, concurrent creation/reactivation and repeatable-read isolation`,
    );
  });
}
