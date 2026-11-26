import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase("course_authoring_studio", async ({ sql, actor }) => {
  const [admin, learner, laterLearner, completedLearner, stranger] = Array.from(
    { length: 5 },
    randomUUID,
  );
  const [organisation, template, run] = Array.from({ length: 3 }, randomUUID);
  const learnerIds = [learner, laterLearner, completedLearner];
  const requests = learnerIds.map(() => randomUUID());
  await sql(`
    insert into auth.users(id,email,email_confirmed_at)
    values ${[admin, ...learnerIds, stranger]
      .map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`)
      .join(",")};
    insert into public.user_roles(user_id,role) values
      (${q(admin)},'admin'),
      ${learnerIds.map((id) => `(${q(id)},'participant')`).join(",")},
      (${q(stranger)},'participant');
    insert into public.organisations(id,name)
      values (${q(organisation)},'Fictional learning organisation');
    insert into public.course_templates(id,title)
      values (${q(template)},'Fictional authoring course');
    insert into public.course_runs(id,template_id,organisation_id,published)
      values (${q(run)},${q(template)},${q(organisation)},true);
    insert into private.company_participant_link_requests(
      id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at
    ) values ${learnerIds
      .map(
        (id, index) =>
          `(${q(requests[index])},${q(organisation)},${q(admin)},${q(randomUUID())},` +
          `(select luminovia_user_id from public.profiles where id=${q(id)}),${q(id)},'accepted',now()+interval '1 day')`,
      )
      .join(",")};
    insert into private.company_participant_memberships(
      organisation_id,user_id,status,link_request_id,invited_by,joined_at,version
    ) values ${learnerIds
      .map(
        (id, index) =>
          `(${q(organisation)},${q(id)},'active',${q(requests[index])},${q(admin)},now(),1)`,
      )
      .join(",")};
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values (${q(run)},${q(learner)},'enrolled',${q(admin)}),
             (${q(run)},${q(completedLearner)},'completed',${q(admin)});
  `);

  const toggle = async (enabled, version) =>
    JSON.parse(
      await actor(
        admin,
        `select public.set_company_premium(${q(organisation)},${enabled},${version},${q(randomUUID())})`,
      ),
    );
  const read = async (who) =>
    JSON.parse(
      await actor(who, `select public.course_content_studio(${q(run)})`),
    );
  const action = async (who, name, payload) =>
    JSON.parse(
      await actor(
        who,
        `select public.course_content_action(${q(run)},${q(name)},${q(JSON.stringify(payload))}::jsonb)`,
      ),
    );
  const content = (text) => ({
    modules: [
      {
        id: "8f9d9d23-59d7-4cb4-a996-53eb828f92c1",
        title: `Fictional ${text}`,
        description: "A versioned learning module",
        lessons: [
          {
            id: "6d1bb289-55c2-4e19-8b2a-3b0a573df4a6",
            title: "Fictional lesson",
            objectives: "Read a versioned lesson",
            duration_minutes: 20,
            body: {
              type: "doc",
              content: [
                { type: "paragraph", content: [{ type: "text", text }] },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.equal((await toggle(true, 0)).status, "updated");
  assert.equal((await read(admin)).published_version, 0);
  await assert.rejects(
    read(stranger),
    /Course unavailable|curriculum unavailable/i,
  );
  await actor(
    learner,
    `set local request.path='/rpc/course_content_studio';
     set local request.method='POST';
     select private.require_portal_access()`,
  );
  await assert.rejects(
    actor(
      learner,
      `set local request.path='/rpc/course_content_action';
       set local request.method='POST';
       select private.require_portal_access()`,
    ),
    /42501/i,
  );

  // Populate the real scanned-resource registry and reference the exact share.
  const [
    document,
    version,
    privateShare,
    publicShare,
    unrelatedShare,
    archivedLesson,
    archivedModule,
  ] = Array.from({ length: 7 }, randomUUID);
  await sql(`
    insert into public.documents(id, owner_id, uploaded_by, scope, kind, original_name, mime_type, size_bytes, status, client_id)
      values (${q(document)}, ${q(admin)}, ${q(admin)}, 'personal', 'material', 'Fictional.pdf', 'application/pdf', 10, 'clean', ${q(randomUUID())});
    insert into public.document_versions(id, document_id, uploaded_by, client_id, version, object_path, original_name, mime_type, size_bytes, status, sha256)
      values (${q(version)}, ${q(document)}, ${q(admin)}, ${q(randomUUID())}, 1, 'fictional/lesson.pdf', 'Fictional.pdf', 'application/pdf', 10, 'clean', ${q("a".repeat(64))});
    update public.documents set current_version_id=${q(version)} where id=${q(document)};
    insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
      values (${q(publicShare)},${q(run)},${q(version)},'participants','material',${q(admin)}),
             (${q(privateShare)},${q(run)},${q(version)},'staff','material',${q(admin)});
  `);
  const firstContent = content("revision one");
  const firstModule = firstContent.modules[0];
  firstModule.lessons[0].material_ids = [
    publicShare,
    privateShare,
    unrelatedShare,
  ];
  firstModule.lessons.push({
    ...firstModule.lessons[0],
    id: archivedLesson,
    archived: true,
  });
  firstContent.modules.push({
    ...firstModule,
    id: archivedModule,
    archived: true,
    lessons: [],
  });

  await assert.rejects(
    action(admin, "save_draft", {
      content: { modules: [{ ...firstModule, archived: "true" }] },
      published_version: 0,
      draft_version: 0,
    }),
    /22023/,
  );
  await assert.rejects(
    action(admin, "save_draft", {
      content: {
        modules: [
          {
            ...firstModule,
            lessons: [
              {
                ...firstModule.lessons[0],
                material_ids: [publicShare, publicShare],
              },
            ],
          },
        ],
      },
      published_version: 0,
      draft_version: 0,
    }),
    /22023/,
  );

  const firstDraft = await action(admin, "save_draft", {
    content: firstContent,
    published_version: 0,
    draft_version: 0,
  });
  assert.equal(firstDraft.draft_version, 1);
  const hidden = await read(learner);
  assert.equal(hidden.draft_content, null);
  assert.deepEqual(hidden.versions, []);
  assert.equal(hidden.published_content.modules.length, 0);
  await assert.rejects(
    action(learner, "save_draft", {
      content: content("unauthorised"),
      published_version: 0,
      draft_version: 0,
    }),
    /Assigned course author required/i,
  );
  await assert.rejects(
    action(admin, "save_draft", {
      content: content("stale editor"),
      published_version: 0,
      draft_version: 0,
    }),
    /PT409.*Course draft changed/i,
  );

  const first = await action(admin, "publish", {
    published_version: 0,
    draft_version: 1,
  });
  assert.equal(first.published_version, 1);
  assert.equal(first.published_content.modules.length, 2);
  assert.equal(first.published_content.modules[0].lessons.length, 2);
  const projected = (await read(learner)).published_content;
  assert.equal(projected.modules.length, 1);
  assert.equal(projected.modules[0].lessons.length, 1);
  assert.deepEqual(projected.modules[0].lessons[0].material_ids, [publicShare]);
  await sql(
    `update private.course_resources set removed_at=now() where id=${q(publicShare)}`,
  );
  assert.deepEqual(
    (await read(learner)).published_content.modules[0].lessons[0].material_ids,
    [],
  );

  assert.equal(
    (await read(learner)).published_content.modules[0].title,
    "Fictional revision one",
  );
  assert.equal(
    await sql(
      `select course_content_version from public.course_enrolments where course_run_id=${q(run)} and user_id=${q(learner)}`,
    ),
    "1",
  );
  await assert.rejects(
    actor(
      learner,
      `update public.course_enrolments set course_content_version=0
       where course_run_id=${q(run)} and user_id=${q(learner)}`,
    ),
    /permission denied|42501/i,
  );
  assert.equal(
    await sql(
      `select course_content_version from public.course_enrolments where course_run_id=${q(run)} and user_id=${q(completedLearner)}`,
    ),
    "",
  );

  await action(admin, "save_draft", {
    content: content("revision two"),
    published_version: 1,
    draft_version: 0,
  });
  await action(admin, "publish", { published_version: 1, draft_version: 1 });
  assert.equal((await read(learner)).published_version, 1);
  assert.equal(
    (await read(learner)).published_content.modules[0].title,
    "Fictional revision one",
  );
  await sql(`insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
    values (${q(run)},${q(laterLearner)},'enrolled',${q(admin)});`);
  assert.equal((await read(laterLearner)).published_version, 2);

  const restored = await action(admin, "restore", {
    source_version: 1,
    published_version: 2,
    draft_version: 0,
  });
  assert.equal(
    restored.draft_content.modules[0].title,
    "Fictional revision one",
  );
  await action(admin, "publish", { published_version: 2, draft_version: 1 });
  assert.equal((await read(learner)).published_version, 1);
  assert.deepEqual(
    (await read(admin)).versions.map(({ version }) => version),
    [3, 2, 1],
  );
  await action(admin, "migrate", {
    user_id: learner,
    target_version: 3,
  });
  assert.equal((await read(learner)).published_version, 3);
  assert.equal(
    await sql(`select count(*) from public.audit_events
      where actor_id=${q(admin)} and resource_id=${q(run)}
        and action=${q(`course.content.participant_migrated:${learner}:revision_3`)}`),
    "1",
  );

  const linkedContent = content("safe link");
  linkedContent.modules[0].lessons[0].body = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "Fictional reference",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.invalid/reference" },
              },
            ],
          },
        ],
      },
    ],
  };
  const linkedDraft = await action(admin, "save_draft", {
    content: linkedContent,
    published_version: 3,
    draft_version: 0,
  });
  assert.equal(linkedDraft.draft_version, 1);
  await assert.rejects(
    action(admin, "save_draft", {
      content: {
        ...content("unsafe link"),
        modules: content("unsafe link").modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => ({
            ...lesson,
            body: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: "unsafe",
                      marks: [
                        {
                          type: "link",
                          attrs: { href: "javascript:alert(1)" },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          })),
        })),
      },
      published_version: 3,
      draft_version: 1,
    }),
    /Invalid course curriculum/i,
  );
  const incompleteText = content("missing text value");
  incompleteText.modules[0].lessons[0].body = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text" }],
      },
    ],
  };
  await assert.rejects(
    action(admin, "save_draft", {
      content: incompleteText,
      published_version: 3,
      draft_version: 1,
    }),
    /Invalid course curriculum/i,
  );
  const expected = { published_version: 3, draft_version: 1 };
  assert.equal(
    (await action(admin, "request_review", expected)).review.state,
    "requested",
  );
  assert.equal((await read(learner)).review, undefined);
  await assert.rejects(action(learner, "approve_review", expected), /42501/);
  await assert.rejects(action(admin, "publish", expected), /PT409/);
  await assert.rejects(
    action(admin, "save_draft", { ...expected, content: linkedContent }),
    /PT409/,
  );
  assert.equal(
    (await action(admin, "return_review", expected)).review.state,
    "returned",
  );
  assert.equal(
    (await action(admin, "request_review", expected)).review.state,
    "requested",
  );
  assert.equal(
    (await action(admin, "approve_review", expected)).review.state,
    "approved",
  );
  await assert.rejects(
    action(admin, "schedule_publish", {
      ...expected,
      publish_at: "2022-01-01T00:00:00Z",
    }),
    /22023/,
  );
  const publishAt = new Date(Date.now() + 60000).toISOString();
  assert.equal(
    (
      await action(admin, "schedule_publish", {
        ...expected,
        publish_at: publishAt,
      })
    ).review.state,
    "scheduled",
  );
  assert.equal(
    await sql("select private.run_scheduled_course_publications()"),
    "0",
  );
  await assert.rejects(
    actor(admin, "select private.run_scheduled_course_publications()"),
    /42501/,
  );
  await sql(`update private.course_curriculum_reviews set publish_at=clock_timestamp() - interval '1 second'
    where run_id=${q(run)} and state='scheduled'`);
  assert.equal(
    await sql("select private.run_scheduled_course_publications()"),
    "1",
  );
  assert.equal(
    await sql("select private.run_scheduled_course_publications()"),
    "0",
  );
  assert.equal((await read(admin)).published_version, 4);
  assert.equal((await read(learner)).published_version, 3);

  await action(admin, "save_draft", {
    published_version: 4,
    draft_version: 0,
    content: content("revoked scheduler"),
  });
  const newDraft = { published_version: 4, draft_version: 1 };
  await action(admin, "request_review", newDraft);
  await action(admin, "approve_review", newDraft);
  await action(admin, "schedule_publish", {
    ...newDraft,
    publish_at: new Date(Date.now() + 60000).toISOString(),
  });
  await sql(`update public.profiles set active=false where id=${q(admin)};
    update private.course_curriculum_reviews set publish_at=clock_timestamp() - interval '1 second'
    where run_id=${q(run)} and state='scheduled'`);
  assert.equal(
    await sql("select private.run_scheduled_course_publications()"),
    "0",
  );
  await sql(`update public.profiles set active=true where id=${q(admin)}`);
  assert.equal((await read(admin)).review.state, "blocked");
  assert.equal((await read(admin)).published_version, 4);

  await sql(`update public.course_enrolments set status='removed'
    where course_run_id=${q(run)} and user_id=${q(learner)};`);
  await assert.rejects(read(learner), /unavailable|access denied|curriculum/i);
  console.log(
    "PASS course authoring drafts, immutable revisions, learner isolation, restore, migration and validation",
  );
});
