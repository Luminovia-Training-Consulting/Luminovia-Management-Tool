import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";

await withApiFixture(async ({ service, actor, mfa, sql, defer, checked }) => {
  const teacher = await actor("comment-teacher", "lecturer"),
    peer = await actor("comment-peer", "lecturer"),
    admin = await actor("comment-admin", "admin"),
    client = await actor("comment-client", "client"),
    learner = await actor("comment-learner", "participant");
  const job = randomUUID(),
    template = randomUUID(),
    run = randomUUID();
  // Private audit is intentionally unexposed to REST; only this strict disposable
  // harness can clean its own rows with SQL, then remove its fictional accounts.
  defer(async () => {
    await sql(
      `delete from private.resource_comment_revisions where comment_id in(select id from private.resource_comments where job_id='${job}' or template_id='${template}');delete from private.resource_comments where job_id='${job}' or template_id='${template}';`,
    );
    await checked(
      service.from("job_sessions").delete().eq("job_id", job),
      "Clean comment job sessions",
    );
    await checked(
      service.from("jobs").delete().eq("id", job),
      "Clean comment job",
    );
    await checked(
      service.from("course_runs").delete().eq("id", run),
      "Clean comment run",
    );
    await checked(
      service.from("course_templates").delete().eq("id", template),
      "Clean comment template",
    );
  });
  await checked(
    service
      .from("course_templates")
      .insert({ id: template, title: "Fictional API discussion template" }),
  );
  await checked(
    service
      .from("course_runs")
      .insert({ id: run, template_id: template, published: true }),
  );
  await checked(
    service
      .from("jobs")
      .insert({
        id: job,
        course_run_id: run,
        title: "Fictional API discussion",
        customer_name: "Fictional academy",
        delivery_type: "online",
        time_zone: "Europe/Berlin",
        status: "published",
        amount: 100,
        total_amount: 100,
        currency: "EUR",
        rate_unit: "fixed_total",
        terms: "Immutable accepted fee terms",
      }),
  );
  for (const who of [client, learner])
    assert.equal(
      (await who.client.rpc("resource_comments", { p_kind: "job", p_id: job }))
        .error?.code,
      "42501",
    );
  const key = randomUUID(),
    body = "Actual API comment <script>literal text</script>\nNext line";
  const posted = await Promise.all(
    Array.from({ length: 10 }, () =>
      checked(
        teacher.client.rpc("add_resource_comment", {
          p_kind: "job",
          p_id: job,
          p_body: body,
          p_request_id: key,
        }),
      ),
    ),
  );
  assert.equal(new Set(posted).size, 1);
  const id = posted[0];
  const read = () =>
    checked(peer.client.rpc("resource_comments", { p_kind: "job", p_id: job }));
  assert.equal((await read())[0].body, body);
  assert.equal(
    (
      await peer.client.rpc("edit_resource_comment", {
        p_comment_id: id,
        p_body: "Forged edit",
        p_version: 1,
      })
    ).error?.code,
    "42501",
  );
  assert.equal(
    (
      await teacher.client.rpc("resource_comments", {
        p_kind: "job",
        p_id: job,
        p_limit: null,
      })
    ).error?.code,
    "22023",
  );
  const edits = await Promise.all([
    teacher.client.rpc("edit_resource_comment", {
      p_comment_id: id,
      p_body: "Updated A",
      p_version: 1,
    }),
    teacher.client.rpc("edit_resource_comment", {
      p_comment_id: id,
      p_body: "Updated B",
      p_version: 1,
    }),
  ]);
  assert.equal(edits.filter((row) => row.error === null).length, 1);
  assert.equal(edits.filter((row) => row.error?.code === "40001").length, 1);
  assert.equal(
    (
      await admin.client.rpc("moderate_resource_comment", {
        p_comment_id: id,
        p_hidden: true,
        p_reason: "Review",
        p_version: 2,
      })
    ).error?.code,
    "42501",
  );
  await mfa(admin.client);
  await checked(
    admin.client.rpc("moderate_resource_comment", {
      p_comment_id: id,
      p_hidden: true,
      p_reason: "Fictional moderation reason",
      p_version: 2,
    }),
  );
  assert.deepEqual(await read(), []);
  const own = await checked(
    teacher.client.rpc("resource_comments", { p_kind: "job", p_id: job }),
  );
  assert.equal(own[0].moderation_reason, "Fictional moderation reason");
  await checked(
    teacher.client.rpc("edit_resource_comment", {
      p_comment_id: id,
      p_body: "Revised hidden note",
      p_version: 3,
    }),
  );
  assert.deepEqual(await read(), []);
  await checked(
    admin.client.rpc("moderate_resource_comment", {
      p_comment_id: id,
      p_hidden: false,
      p_reason: "Reviewed revised note",
      p_version: 4,
    }),
  );
  assert.equal((await read())[0].body, "Revised hidden note");
  await checked(
    teacher.client.rpc("withdraw_resource_comment", {
      p_comment_id: id,
      p_version: 5,
    }),
  );
  assert.equal((await read())[0].body, "");
  assert.equal((await read())[0].withdrawn, true);
  await checked(
    service.from("profiles").update({ active: false }).eq("id", peer.id),
  );
  assert.equal(
    (await peer.client.rpc("resource_comments", { p_kind: "job", p_id: job }))
      .error?.code,
    "42501",
  );
  assert.ok(
    (
      await teacher.client
        .schema("private")
        .from("resource_comments")
        .select("*")
    ).error,
  );
  console.log(
    "PASS: actual Auth/TOTP/RPC comments, staff-only resources, ten concurrent same-key retries/one row, literal text, stale/foreign edits denied, MFA moderation/author revisions/withdrawal, bounded cursor and immediate existing-token suspension.",
  );
});
