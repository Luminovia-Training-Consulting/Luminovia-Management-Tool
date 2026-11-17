/** Real PostgreSQL metadata selection, retained-role denial and reduced DTO boundaries. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTestDatabase } from "./testing/database.mjs";
import { seedCalendarMetadata } from "./testing/calendar-metadata-fixture.mjs";
await withTestDatabase(
  "assignment_calendar_metadata",
  async ({ sql, actor }) => {
    const teacher = randomUUID(),
      peer = randomUUID(),
      admin = randomUUID();
    await sql(
      `insert into auth.users(id) values('${teacher}'),('${peer}'),('${admin}');insert into public.user_roles(user_id,role) values('${teacher}','lecturer'),('${peer}','lecturer'),('${admin}','admin');`,
    );
    const f = await seedCalendarMetadata(sql, teacher, peer);
    const read = (who) =>
      actor(
        who,
        `select public.assignment_calendar_metadata(array['${f.linked}','${f.manual}','${f.foreign}','${randomUUID()}']::uuid[])`,
      ).then(JSON.parse);
    const rows = await read(teacher);
    assert.equal(rows.length, 2);
    const linked = rows.find((x) => x.id === f.linked);
    assert.equal(linked.organisation_id, f.organisation);
    assert.equal(linked.organisation_name, "Fictional calendar company");
    assert.deepEqual(
      new Set(linked.topics.map((x) => x.id)),
      new Set([f.requiredTopic, f.templateTopic]),
    );
    assert.deepEqual(Object.keys(linked).sort(), [
      "id",
      "organisation_id",
      "organisation_name",
      "title",
      "topics",
    ]);
    assert.deepEqual(Object.keys(linked.topics[0]).sort(), [
      "id",
      "label_de",
      "label_en",
    ]);
    assert.equal(rows.find((x) => x.id === f.manual).organisation_id, null);
    assert.equal(
      rows.find((x) => x.id === f.manual).organisation_name,
      "Fictional manual customer",
    );
    assert.deepEqual(
      (await read(peer)).map((x) => x.id),
      [f.foreign],
    );
    assert.deepEqual(await read(admin), []);
    assert.deepEqual(
      JSON.parse(
        await actor(
          teacher,
          `select public.assignment_job_titles(array['${f.linked}']::uuid[])`,
        ),
      ),
      [{ id: f.linked, title: "Own linked assignment" }],
    );
    console.log(
      "PASS own confirmed metadata, manual customer fallback, deduplicated requirement/template topics and unchanged title DTO",
    );
    await sql(
      `update public.job_claims set status='cancelled' where lecturer_id='${teacher}'`,
    );
    assert.deepEqual(await read(teacher), []);
    await sql(`delete from public.user_roles where user_id='${peer}'`);
    await assert.rejects(read(peer), /Account inactive/);
    await assert.rejects(
      actor(admin, "select public.assignment_calendar_metadata(null)"),
      /Invalid assignment identities/,
    );
    assert.equal(
      await sql(
        `select has_function_privilege('anon','public.assignment_calendar_metadata(uuid[])','EXECUTE')`,
      ),
      "f",
    );
    console.log(
      "PASS cancelled assignments, retained-role revocation, bounded inputs and anonymous denial",
    );
  },
);
