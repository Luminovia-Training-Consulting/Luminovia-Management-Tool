/** Verify publication-version, recipient, revision and inbox boundaries on migrated PostgreSQL. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("calendar_invitation", async ({sql, actor}) => {
    const [admin, lecturer, other, participant, event] = Array.from({length: 5}, randomUUID);
    await sql(`insert into auth.users(id,email) values
        ${[admin, lecturer, other, participant].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
      insert into public.user_roles(user_id,role)
        values (${q(admin)},'admin'),(${q(lecturer)},'lecturer'),(${q(other)},'client'),(${q(participant)},'participant');
      insert into public.global_events(id,title,starts_at,ends_at,published)
        values (${q(event)},'Fictional invited session','2060-04-01T08:00:00Z','2060-04-01T09:00:00Z',true);`);

    const list = (id, version) => call(id, version ? `calendar_invitations(${q(event)},${version})` : "calendar_invitations()");
    const code = (id) => sql(`select luminovia_user_id from public.profiles where id = ${q(id)}`);
    async function call(id, expression) {
        return JSON.parse(await actor(id, `select to_jsonb(public.${expression})`));
    }
    const recipient = await code(lecturer);
    const excluded = await code(participant);
    const set = (id, version, userCode, invited, revision) =>
        call(id, `set_calendar_invitation(${q(event)},${version},${q(userCode)},${invited},${revision})`);
    const reply = (id, version, revision, response) =>
        call(id, `reply_calendar_invitation(${q(event)},${version},${revision},${q(response)})`);
    const notifications = async (id) =>
        (await call(id, "notification_inbox()")).items
            .filter(({kind}) => kind === "calendar_invitation");

    await assert.rejects(set(lecturer, 1, recipient, true, 0), /42501/);
    await assert.rejects(list(other, 1), /42501/);
    await assert.rejects(set(admin, 1, excluded, true, 0), /22023/);
    assert.equal(await set(admin, 1, recipient.toLowerCase(), true, 0), true);
    assert.equal(await set(admin, 1, recipient, true, 0), true);
    assert.equal((await list(lecturer)).items[0].response, "pending");
    assert.deepEqual(await list(other), {items: [], next_cursor: null});
    assert.equal((await notifications(lecturer))[0].href, "/calendar#calendar-invitations");
    assert.deepEqual(await notifications(other), []);

    await assert.rejects(reply(other, 1, 1, "accepted"), /42501/);
    assert.equal(await reply(lecturer, 1, 1, "tentative"), true);
    assert.equal(await reply(lecturer, 1, 1, "tentative"), true);
    await assert.rejects(reply(lecturer, 1, 1, "declined"), /40001/);
    assert.equal((await list(admin, 1))[0].response, "tentative");

    assert.equal(await set(admin, 1, recipient, false, 2), true);
    assert.deepEqual(await list(lecturer), {items: [], next_cursor: null});
    assert.deepEqual(await notifications(lecturer), []);
    await assert.rejects(reply(lecturer, 1, 3, "accepted"), /42501/);
    assert.equal(await set(admin, 1, recipient, true, 3), true);
    assert.equal((await list(lecturer)).items[0].response, "pending");
    assert.equal(await reply(lecturer, 1, 4, "accepted"), true);

    await sql(`update public.global_events set version = 2 where id = ${q(event)}`);
    await assert.rejects(set(admin, 1, recipient, true, 5), /40001/);
    assert.deepEqual(await list(lecturer), {items: [], next_cursor: null});
    assert.deepEqual(await notifications(lecturer), []);
    assert.deepEqual(await list(admin, 2), []);
    assert.equal(await set(admin, 2, recipient, true, 0), true);

    await sql(`update public.global_events set published = false where id = ${q(event)}`);
    await assert.rejects(reply(lecturer, 2, 1, "accepted"), /42501/);
    assert.deepEqual(await notifications(lecturer), []);

    await sql(`with inserted as (
      insert into public.global_events(title, starts_at, ends_at, published)
      select 'Fictional paged invitation', '2061-04-01T08:00:00Z'::timestamptz,
        '2061-04-01T09:00:00Z'::timestamptz, true from generate_series(1, 51)
      returning id, version
    )
    insert into private.global_event_invitations(event_id,event_version,recipient_id)
    select id,version,${q(lecturer)} from inserted`);
    const first = await list(lecturer);
    assert.equal(first.items.length, 50);
    const next = await call(lecturer, `calendar_invitations(
      p_after_at => ${q(first.next_cursor.at)}, p_after_id => ${q(first.next_cursor.id)})`);
    assert.equal(next.items.length, 1);
    assert.equal(next.next_cursor, null);
    assert(!first.items.some((row) => row.event_id === next.items[0].event_id));
    console.log("PASS Calendar invitations and replies stay bound to the current published version and recipient.");
});
