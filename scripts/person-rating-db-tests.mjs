/** Ratings are scoped to visible active accounts and private to the two actors. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("person_rating", async ({ sql, actor }) => {
  const [lecturer, administrator, colleague, unconnected] = Array.from(
    { length: 4 },
    randomUUID,
  );
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
    values ${[lecturer, administrator, colleague, unconnected]
      .map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`)
      .join(",")};
    insert into public.user_roles(user_id,role) values
      (${q(administrator)},'admin'),(${q(lecturer)},'lecturer'),
      (${q(colleague)},'lecturer'),(${q(unconnected)},'participant');
  `);
  const rating = async (user, person) =>
    JSON.parse(
      await actor(
        user,
        `select coalesce(public.person_rating(${q(person)}), 'null'::jsonb)`,
      ),
    );
  const save = async (user, person, stars, comment) =>
    JSON.parse(
      await actor(
        user,
        `select public.save_person_rating(${q(person)},${stars},${comment === null ? "null" : q(comment)})`,
      ),
    );

  assert.deepEqual(await rating(lecturer, administrator), {
    stars: null,
    comment: "",
  });
  assert.deepEqual(await rating(unconnected, administrator), null);
  await assert.rejects(
    () => save(unconnected, administrator, 5, "Out of scope"),
    /42501/,
  );
  await assert.rejects(
    () => save(lecturer, lecturer, 5, "Self rating"),
    /42501/,
  );
  await assert.rejects(() => save(lecturer, administrator, 0, ""), /22023/);
  await assert.rejects(() => save(lecturer, administrator, 6, ""), /22023/);
  await assert.rejects(
    () => save(lecturer, administrator, 1, "x".repeat(2001)),
    /22023/,
  );
  await assert.rejects(
    () => actor(lecturer, "select * from private.person_ratings"),
    /42501/,
  );
  assert.equal(
    await sql(
      "select has_function_privilege('anon', 'public.person_rating(uuid)', 'EXECUTE')",
    ),
    "f",
  );

  assert.deepEqual(await save(lecturer, administrator, 4, "  First review  "), {
    stars: 4,
    comment: "First review",
  });
  const first = (await rating(administrator, administrator)).received[0];
  assert.deepEqual(Object.keys(first).sort(), ["comment", "id", "stars"]);
  assert.equal(first.comment, "First review");

  // Re-rating the same account edits the existing record and preserves its UUID.
  assert.deepEqual(await save(lecturer, administrator, 5, "Second review"), {
    stars: 5,
    comment: "Second review",
  });
  assert.deepEqual(await rating(lecturer, administrator), {
    stars: 5,
    comment: "Second review",
  });
  assert.deepEqual(await rating(colleague, administrator), {
    stars: null,
    comment: "",
  });
  assert.deepEqual((await rating(administrator, administrator)).received, [
    { id: first.id, stars: 5, comment: "Second review" },
  ]);
  assert.deepEqual(await save(administrator, lecturer, 3, null), {
    stars: 3,
    comment: "",
  });
  assert.deepEqual(
    (await rating(lecturer, lecturer)).received.map(({ stars, comment }) => [
      stars,
      comment,
    ]),
    [[3, ""]],
  );

  const participantGate = (path, method, profile = "public") =>
    actor(
      unconnected,
      `
      set local request.path=${q(path)};
      set local request.method=${q(method)};
      set local request.headers=${q(JSON.stringify({ "accept-profile": profile, "content-profile": profile }))};
      select public.require_portal_access();
    `,
    );
  await participantGate("/rpc/person_rating", "POST");
  await participantGate("/rpc/save_person_rating", "POST");
  await assert.rejects(
    () => participantGate("/rpc/person_rating", "GET"),
    /42501/,
  );
  await assert.rejects(
    () => participantGate("/rpc/save_person_rating", "POST", "private"),
    /42501/,
  );

  const [peer, organisation, template, run, room] = Array.from(
    { length: 5 },
    randomUUID,
  );
  const participantIds = [unconnected, peer];
  await sql(`
    insert into auth.users(id,email,email_confirmed_at) values (${q(peer)},${q(peer + "@example.invalid")},now());
    insert into public.user_roles(user_id,role) values (${q(peer)},'participant');
    insert into public.organisations(id,name) values (${q(organisation)},'Fictional Rating Company');
    insert into private.company_premium_settings(organisation_id,enabled) values (${q(organisation)},true)
      on conflict (organisation_id) do update set enabled=true;
    insert into public.course_templates(id,title) values (${q(template)},'Fictional Ratings Course');
    insert into public.course_runs(id,template_id,organisation_id,published)
      values (${q(run)},${q(template)},${q(organisation)},true);
    insert into public.chat_rooms(id,kind,course_run_id) values (${q(room)},'participant_course',${q(run)});
    ${participantIds
      .map((id) => {
        const link = randomUUID();
        return `
        insert into private.company_participant_link_requests
          (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
          select ${q(link)},${q(organisation)},${q(administrator)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
          from public.profiles where id=${q(id)};
        insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
          values (${q(organisation)},${q(id)},'active',${q(link)},${q(administrator)},now());
        insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
          values (${q(run)},${q(id)},'enrolled',${q(administrator)});
        insert into public.chat_members(room_id,user_id) values (${q(room)},${q(id)});
      `;
      })
      .join("")}
  `);
  assert.deepEqual(
    await save(unconnected, peer, 5, "Current course chat peer"),
    {
      stars: 5,
      comment: "Current course chat peer",
    },
  );
  assert.equal((await rating(peer, peer)).received.length, 1);
  await sql(`
    update public.chat_members set removed_at = now()
    where room_id = ${q(room)} and user_id = ${q(peer)}
  `);
  assert.equal(await rating(unconnected, peer), null);
  await assert.rejects(
    () => save(unconnected, peer, 5, "Former chat peer"),
    /42501/,
  );

  await sql(
    `update public.profiles set active=false where id=${q(administrator)}`,
  );
  assert.equal(await rating(lecturer, administrator), null);
  await assert.rejects(
    () => save(lecturer, administrator, 1, "Disabled account"),
    /42501/,
  );
  for (const id of [lecturer, administrator]) {
    const selector = await sql(`select private.deletion_selector(
      private.deletion_scope('account', ${q(id)}), 'private.person_ratings')`);
    assert.equal(
      await sql(
        `select count(*) from private.person_ratings x where ${selector}`,
      ),
      "2",
    );
  }
});
