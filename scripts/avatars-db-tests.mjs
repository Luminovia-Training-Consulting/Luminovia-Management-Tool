/**
 * PostgreSQL regression groups for scanned avatars and current viewing permissions.
 * Real migrations define the contract; controlled role/permission claims exercise it independently of the UI.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase, quoteSql as q } from "./testing/database.mjs";

await withTestDatabase("avatars_test", async ({ sql, actor }) => {
  const teacher = randomUUID(),
    peer = randomUUID(),
    admin = randomUUID(),
    learner = randomUUID(),
    client = randomUUID(),
    outsider = randomUUID();
  const org = randomUUID(),
    template = randomUUID(),
    run = randomUUID(),
    job = randomUUID(),
    claim = randomUUID();
  /** Calls the business database API under the fixture's controlled identity/permission claims. */
  const rpc = async (who, name, args = [], aal = "aal1") => {
    const result = await actor(
      who,
      `select public.${name}(${args.map((v) => (v === null ? "null" : q(v))).join(",")})`,
      aal,
    );
    return result ? JSON.parse(result) : null;
  };
  /** Creates a selected image version and scan state to test SQL read rules independently of the scanner. */
  const image = async (who, kind = "avatar", status = "clean") => {
    const r = JSON.parse(
      await actor(
        who,
        `select public.reserve_document('avatar.png','image/png',200,'personal',${q(kind)},null,null,'${randomUUID()}')`,
      ),
    );
    await sql(
      `update public.document_versions set status=${q(status)},sha256=repeat('a',64),scanner_version='Fictional SQL metadata fixture' where id='${r.version_id}';update public.documents set status=${q(status)} where id='${r.document_id}'`,
    );
    return r;
  };
  let count = 0;
  /** Counts and reports a case only after all of its assertions have completed successfully. */
  const check = async (name, fn) => {
    await fn();
    count++;
    console.log(`PASS ${name}`);
  };
  await sql(
    `insert into auth.users(id,email) values ${[teacher, peer, admin, learner, client, outsider].map((id) => `('${id}','${id}@example.invalid')`).join(",")};insert into public.user_roles(user_id,role) values('${teacher}','lecturer'),('${peer}','lecturer'),('${admin}','admin'),('${learner}','participant'),('${client}','client'),('${outsider}','participant');`,
  );
  await check(
    "Separate accounts begin without a selected image; selection rows are not directly writable",
    async () => {
      assert.equal(await rpc(teacher, "profile_avatar", [teacher]), null);
      await assert.rejects(
        actor(
          teacher,
          `insert into public.profile_avatars(user_id,document_version_id) values('${teacher}','${randomUUID()}')`,
        ),
        /permission denied/,
      );
    },
  );
  await check(
    "Avatar metadata rejects ordinary files, oversized PNGs and nonpersonal scopes at the database boundary",
    async () => {
      for (const [mime, size] of [
        ["application/pdf", 100],
        ["image/png", 2097153],
      ])
        await assert.rejects(
          actor(
            teacher,
            `select public.reserve_document('avatar.png',${q(mime)},${size},'personal','avatar',null,null,'${randomUUID()}')`,
          ),
          /Invalid avatar metadata/,
        );
      await assert.rejects(
        actor(
          teacher,
          `select public.reserve_document('avatar.png','image/png',200,'personal','avatar',null,null,'${randomUUID()}',null,'${peer}')`,
        ),
        /Subject upload permission/,
      );
    },
  );
  const clean = await image(teacher),
    pending = await image(teacher, "avatar", "quarantined"),
    material = await image(teacher, "material"),
    foreign = await image(peer);
  await check(
    "Only an owned, clean avatar version can be selected; peers and unrelated clean images cannot be substituted",
    async () => {
      for (const candidate of [pending, material, foreign])
        await assert.rejects(
          rpc(teacher, "set_profile_avatar", [candidate.version_id]),
          /Own clean avatar version/,
        );
      const result = await rpc(teacher, "set_profile_avatar", [
        clean.version_id,
      ]);
      assert.equal(result.version_id, clean.version_id);
      assert.deepEqual(Object.keys(result).sort(), [
        "updated_at",
        "version_id",
      ]);
    },
  );
  await check(
    "Permitted staff see only the selected reference while personal document/version metadata stays private even to admin",
    async () => {
      assert.equal(
        (await rpc(peer, "profile_avatar", [teacher])).version_id,
        clean.version_id,
      );
      assert.equal(
        (await rpc(admin, "profile_avatar", [teacher], "aal1")).version_id,
        clean.version_id,
      );
      for (const who of [peer, admin]) {
        assert.equal(
          await actor(
            who,
            `select count(*) from public.documents where id='${clean.document_id}'`,
            "aal1",
          ),
          "0",
        );
        assert.equal(
          await actor(
            who,
            `select count(*) from public.document_versions where id='${clean.version_id}'`,
            "aal1",
          ),
          "0",
        );
        assert.equal(
          await actor(
            who,
            `select count(*) from public.profile_avatars where user_id='${teacher}'`,
            "aal1",
          ),
          "0",
        );
      }
    },
  );
  await check(
    "Replacing an underlying document cannot displace the selected immutable clean version before a new selection",
    async () => {
      const replacement = JSON.parse(
        await actor(
          teacher,
          `select public.reserve_document('avatar-next.png','image/png',200,'personal','avatar',null,null,'${randomUUID()}','${clean.document_id}')`,
        ),
      );
      assert.equal(
        (await rpc(peer, "profile_avatar", [teacher])).version_id,
        clean.version_id,
      );
      await assert.rejects(
        rpc(teacher, "set_profile_avatar", [replacement.version_id]),
        /Own clean avatar version/,
      );
      assert.equal(
        (await rpc(teacher, "profile_avatar", [teacher])).version_id,
        clean.version_id,
      );
    },
  );
  await check(
    "Selection retry is idempotent; removal hides the image without deleting retained personal bytes",
    async () => {
      const before = await sql(
        `select count(*) from public.audit_events where actor_id='${teacher}' and action='profile.avatar_selected'`,
      );
      await rpc(teacher, "set_profile_avatar", [clean.version_id]);
      assert.equal(
        await sql(
          `select count(*) from public.audit_events where actor_id='${teacher}' and action='profile.avatar_selected'`,
        ),
        before,
      );
      await rpc(teacher, "set_profile_avatar", [null]);
      assert.equal(await rpc(peer, "profile_avatar", [teacher]), null);
      assert.equal(
        await actor(
          teacher,
          `select count(*) from public.document_versions where id='${clean.version_id}'`,
        ),
        "1",
      );
      await rpc(teacher, "set_profile_avatar", [clean.version_id]);
    },
  );
  await sql(
    `insert into public.organisations(id,name) values('${org}','Fictional Avatar Academy');insert into public.course_templates(id,title) values('${template}','Fictional Avatar Course');insert into public.course_runs(id,template_id,organisation_id) values('${run}','${template}','${org}');insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()-interval '2 day',now()-interval '1 day');insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,currency,rate_unit,total_amount,terms) values('${job}','${run}','Fictional Avatar Course','Fictional Avatar Academy','online','Europe/Berlin','filled',100,'EUR','fixed_total',100,'Fictional terms');insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${claim}','${job}','${teacher}','${randomUUID()}',100,'EUR','fixed_total',100,'Fictional terms',1);insert into public.client_organisation_memberships(user_id,organisation_id) values('${client}','${org}');`,
  );
  await rpc(
    admin,
    "manage_course_enrolment",
    [run, learner, "completed"],
    "aal1",
  );
  await check(
    "Clients and learners may read an actual assigned lecturer avatar, never unrelated profiles or people",
    async () => {
      for (const who of [client, learner]) {
        assert.equal(
          (await rpc(who, "profile_avatar", [teacher])).version_id,
          clean.version_id,
        );
        await assert.rejects(
          rpc(who, "profile_avatar", [peer]),
          /Profile access denied/,
        );
      }
      await assert.rejects(
        rpc(outsider, "profile_avatar", [teacher]),
        /Profile access denied/,
      );
    },
  );
  await check(
    "Current organisation/enrolment revocation immediately denies the same avatar reference",
    async () => {
      await rpc(
        admin,
        "manage_client_organisation",
        [client, org, "true"],
        "aal1",
      );
      await rpc(
        admin,
        "manage_course_enrolment",
        [run, learner, "removed"],
        "aal1",
      );
      for (const who of [client, learner])
        await assert.rejects(
          rpc(who, "profile_avatar", [teacher]),
          /Profile access denied/,
        );
    },
  );
  await check(
    "Archived selected images disappear and cannot be selected again",
    async () => {
      await actor(
        teacher,
        `select public.rename_document('${clean.document_id}','avatar.png',true)`,
      );
      assert.equal(await rpc(peer, "profile_avatar", [teacher]), null);
      await assert.rejects(
        rpc(teacher, "set_profile_avatar", [clean.version_id]),
        /Own clean avatar version/,
      );
    },
  );
  await check(
    "Suspension and anonymous calls cannot read or select avatars",
    async () => {
      await rpc(peer, "set_profile_avatar", [foreign.version_id]);
      await sql(`update public.profiles set active=false where id='${peer}'`);
      await assert.rejects(
        rpc(peer, "set_profile_avatar", [null]),
        /Active login required/,
      );
      await assert.rejects(
        rpc(teacher, "profile_avatar", [peer]),
        /Profile access denied/,
      );
      await assert.rejects(
        sql(`set role anon;select public.profile_avatar('${teacher}')`),
        /permission denied/,
      );
    },
  );
  console.log(
    `\n${count} avatar PostgreSQL checks passed (actual scanned bytes belong to the separate API/browser suites).`,
  );
});
