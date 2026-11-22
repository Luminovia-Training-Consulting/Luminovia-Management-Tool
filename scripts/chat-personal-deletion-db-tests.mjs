/** Replay the migration and exercise the real RPCs as separate room members. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("chat_personal_deletion", async ({sql, actor}) => {
    const [a, b, outsider, course] = Array.from({length: 4}, randomUUID);
    for (const user of [a, b, outsider]) {
        await sql(`insert into auth.users(id,email) values (${q(user)},${q(user + "@example.invalid")});
          insert into public.user_roles(user_id,role) values (${q(user)},'lecturer');`);
    }
    const dm = await actor(a, `select public.create_dm(${q(b)})`);
    await sql(`insert into public.chat_rooms(id,kind,title) values (${q(course)},'lecturer_course','Fictional course');
      insert into public.chat_members(room_id,user_id) values (${q(course)},${q(a)}),(${q(course)},${q(b)});`);

    const post = (who, room, body) =>
        actor(who, `select public.send_message(${q(room)},${q(body)},${q(randomUUID())},null)`);
    const clear = (who, room) =>
        actor(who, `select public.clear_personal_chat(${q(room)})`);
    const summary = async (who, room) =>
        JSON.parse(await actor(who, `select row_to_json(r) from public.chat_rooms_with_manual_unread() r where id=${q(room)}`));
    const history = (who, room, search = "") =>
        actor(who, `select count(*) from public.chat_messages_with_mentions(${q(room)},p_search=>${q(search)})`);
    const searchCount = (who, term) =>
        actor(who, `select jsonb_array_length(public.unified_search(${q(term)},'chats')->'items')`);

    await assert.rejects(clear(outsider, dm), /42501/);
    await assert.rejects(sql(`set role anon; select public.clear_personal_chat(${q(dm)})`), /42501/);
    await clear(a, dm);
    assert.equal((await summary(a, dm)).personal_deleted, true);
    assert.equal((await summary(b, dm)).personal_deleted, false);
    await post(b, dm, "Fictional previous note");
    await post(a, dm, "Fictional reply");
    assert.equal((await summary(a, dm)).personal_deleted, false);
    await actor(a, `select public.set_chat_pin(${q(dm)},true);
      select public.set_chat_personal_archive(${q(dm)},true);
      select public.mark_chat_unread(${q(dm)});`);

    await clear(a, dm);
    await clear(a, dm);
    const removed = await summary(a, dm);
    assert.equal(removed.personal_deleted, true);
    assert.equal(removed.last_message_preview, null);
    assert.equal(removed.last_message_at, null);
    assert.equal(removed.unread_count, 0);
    assert.equal(removed.manual_unread, false);
    assert.equal(await actor(a, "select cardinality(public.chat_pinned_rooms())"), "0");
    assert.equal(await actor(a, "select cardinality(public.chat_personal_archives())"), "0");
    assert.equal(await history(a, dm), "0");
    assert.equal(await history(a, dm, "Fictional"), "0");
    assert.equal(await searchCount(a, "previous note"), "0");
    assert.equal(await actor(a, `select count(*) from public.messages where room_id=${q(dm)}`), "0");
    assert.equal(await history(b, dm), "2");
    assert.equal(await searchCount(b, "previous note"), "1");
    assert.equal((await summary(b, dm)).personal_deleted, false);

    await post(b, dm, "Fictional   fresh   note");
    const reopened = await summary(a, dm);
    assert.equal(reopened.personal_deleted, false);
    assert.equal(reopened.last_message_preview, "Fictional fresh note");
    assert.equal(reopened.unread_count, 1);
    assert.equal(await history(a, dm), "1");
    assert.equal(await history(b, dm), "3");

    await post(b, course, "Fictional course note");
    await clear(a, course);
    assert.equal((await summary(a, course)).personal_deleted, true);
    assert.equal(await history(a, course), "0");
    assert.equal(await history(b, course), "1");
    assert.equal((await summary(b, course)).personal_deleted, false);
    await sql(`update public.chat_members set removed_at=clock_timestamp()
      where room_id=${q(course)} and user_id=${q(a)}`);
    await assert.rejects(clear(a, course), /42501/);
    console.log("PASS personal chat deletion, privacy, history, unread state, reopening and course membership");
});
