/** Verify live author scopes and exact material remapping against disposable PostgreSQL. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

await withTestDatabase(
  "course_curriculum_catalogue",
  async ({ sql, actor }) => {
    const [
      manager,
      teacher,
      participant,
      org,
      otherOrg,
      template,
      destination,
      source,
      other,
      foreign,
      unpublished,
      document,
      version,
      obsoleteVersion,
      sourceShare,
      destinationShare,
      obsoleteShare,
      staffShare,
    ] = Array.from({ length: 18 }, randomUUID);
    const roles = [
      [manager, "admin"],
      [teacher, "lecturer"],
      [participant, "participant"],
    ];
    const runs = [
      [destination, org, true],
      [source, org, true],
      [other, org, true],
      [foreign, otherOrg, true],
      [unpublished, org, false],
    ];
    const teaching = [destination, source].map((run) => ({
      run,
      job: randomUUID(),
      claim: randomUUID(),
    }));
    const membership = randomUUID();
    await sql(`
    insert into auth.users(id,email,email_confirmed_at) values
      ${roles.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
    insert into public.user_roles(user_id,role) values
      ${roles.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
    insert into public.organisations(id,name) values (${q(org)},'Fictional academy'),(${q(otherOrg)},'Other fictional academy');
    insert into public.course_templates(id,title) values (${q(template)},'Fictional curriculum catalogue');
    insert into public.course_runs(id,template_id,organisation_id,published) values
      ${runs.map(([id, organisation, published]) => `(${q(id)},${q(template)},${q(organisation)},${published})`).join(",")};
    insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
      select ${q(membership)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
      from public.profiles where id=${q(participant)};
    insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
      values (${q(org)},${q(participant)},'active',${q(membership)},${q(manager)},now());
    insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
      values (${q(destination)},${q(participant)},'enrolled',${q(manager)});
    insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values
      ${teaching.map(({ run, job }) => `(${q(job)},${q(run)},'Fictional teaching','Fictional company','online','filled',100,'EUR','fixed_total',100,'Fictional terms')`).join(",")};
    insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values
      ${teaching.map(({ job, claim }) => `(${q(claim)},${q(job)},${q(teacher)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional confirmed terms',1)`).join(",")};
    insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
      values (${q(document)},${q(manager)},${q(manager)},'personal','material','Fictional.pdf','application/pdf',10,'clean',${q(randomUUID())});
    insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
      values (${q(version)},${q(document)},${q(manager)},${q(randomUUID())},2,'fictional/current.pdf','Fictional.pdf','application/pdf',10,'clean',${q("a".repeat(64))}),
             (${q(obsoleteVersion)},${q(document)},${q(manager)},${q(randomUUID())},1,'fictional/previous.pdf','Fictional.pdf','application/pdf',10,'clean',${q("b".repeat(64))});
    update public.documents set current_version_id=${q(version)} where id=${q(document)};
    insert into private.course_resources(id,run_id,version_id,audience,category,created_by)
      values (${q(sourceShare)},${q(source)},${q(version)},'participants','material',${q(manager)}),
             (${q(destinationShare)},${q(destination)},${q(version)},'all','material',${q(manager)}),
             (${q(obsoleteShare)},${q(destination)},${q(obsoleteVersion)},'participants','material',${q(manager)}),
             (${q(staffShare)},${q(destination)},${q(version)},'staff','material',${q(manager)});
  `);
    for (const company of [org, otherOrg])
      await actor(
        manager,
        `select public.set_company_premium(${q(company)},true,0,${q(randomUUID())})`,
      );

    const lesson = (title, fields = {}) => ({
      id: randomUUID(),
      title,
      objectives: "Fictional learning objective",
      duration_minutes: 25,
      body: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Fictional body" }],
          },
        ],
      },
      ...fields,
    });
    const module = (title, lessons, fields = {}) => ({
      id: randomUUID(),
      title,
      description: "",
      lessons,
      ...fields,
    });
    const shared = lesson("Eligible reusable lesson", {
      material_ids: [sourceShare],
    });
    const archivedLesson = lesson("Archived lesson", { archived: true });
    const archivedModule = module(
      "Archived module",
      [lesson("Archived module lesson")],
      { archived: true },
    );
    const sourceContent = {
      modules: [
        module("Fictional published module", [
          shared,
          archivedLesson,
          ...Array.from({ length: 21 }, (_, index) =>
            lesson(`Indexed lesson ${index + 1}`),
          ),
        ]),
        archivedModule,
      ],
    };
    const publishFixture = (run, revision, content) =>
      sql(`insert into private.course_content_revisions(course_run_id,version,content,published_by)
    values (${q(run)},${revision},${q(JSON.stringify(content))},${q(manager)})`);
    await publishFixture(source, 1, sourceContent);
    for (const [run, title] of [
      [other, "Unassigned course lesson"],
      [foreign, "Foreign course lesson"],
      [unpublished, "Unpublished course lesson"],
    ]) {
      await publishFixture(run, 1, {
        modules: [module("Fictional module", [lesson(title)])],
      });
    }
    await sql(`insert into private.course_content_drafts(course_run_id,base_version,version,content,updated_by)
    values (${q(source)},1,1,${q(JSON.stringify({ modules: [module("Private draft", [lesson("Draft-only lesson")])] }))},${q(manager)})`);

    const call = async (who, args = "") =>
      JSON.parse(
        await actor(
          who,
          `set local request.path='/rpc/course_curriculum_catalogue';
     set local request.method='GET';
     select public.require_portal_access();
     select public.course_curriculum_catalogue(${q(destination)}${args})`,
        ),
      );
    const readLesson = (who, run = source, id = shared.id, revision = 1) =>
      call(
        who,
        `, p_source_run_id=>${q(run)}, p_source_version=>${revision}, p_lesson_id=>${q(id)}`,
      );
    const first = await call(teacher);
    assert.equal(first.items.length, 20);
    assert.equal(first.next_offset, 20);
    const last = await call(teacher, ", p_offset=>20");
    assert.equal(last.items.length, 2);
    assert.equal(last.next_offset, null);
    assert.equal(
      new Set([...first.items, ...last.items].map((item) => item.lesson_id))
        .size,
      22,
    );
    assert.equal(
      (await call(manager, ", p_search=>'UNASSIGNED'")).items.length,
      1,
    );
    assert.deepEqual(await call(teacher, ", p_search=>'unassigned'"), {
      items: [],
      next_offset: null,
    });
    for (const term of [
      "foreign",
      "unpublished course lesson",
      "draft-only",
      "archived",
    ]) {
      assert.deepEqual(await call(manager, `, p_search=>${q(term)}`), {
        items: [],
        next_offset: null,
      });
    }
    assert.equal(first.items[0].source_run_id, source);
    assert.doesNotMatch(
      JSON.stringify(first),
      /Fictional body|material_ids|draft_content/,
    );
    await assert.rejects(call(participant), /42501/);
    await assert.rejects(readLesson(manager, foreign), /42501/);
    await assert.rejects(readLesson(teacher, other), /42501/);
    await assert.rejects(
      readLesson(teacher, source, archivedLesson.id),
      /42501/,
    );
    await assert.rejects(call(teacher, ", p_source_version=>1"), /22023/);

    const selected = (await readLesson(teacher)).lesson;
    assert.deepEqual(selected, { ...shared, material_ids: [destinationShare] });
    await sql(
      `update private.course_resources set removed_at=now() where id=${q(destinationShare)}`,
    );
    assert.deepEqual((await readLesson(teacher)).lesson.material_ids, []);

    const draft = (content, expected) =>
      actor(
        teacher,
        `select public.course_content_action(${q(destination)},
    'save_draft',${q(JSON.stringify({ content, published_version: 0, draft_version: expected }))})`,
      ).then(JSON.parse);
    const imported = { ...selected, id: randomUUID(), material_ids: [] };
    const destinationContent = {
      modules: [module("Fictional destination module", [imported])],
    };
    assert.deepEqual(
      (await draft(destinationContent, 0)).draft_content,
      destinationContent,
    );
    await assert.rejects(draft(destinationContent, 0), /PT409/);
    assert.deepEqual(
      JSON.parse(
        await sql(`select content from private.course_content_revisions
    where course_run_id=${q(source)} and version=1`),
      ),
      sourceContent,
    );

    await publishFixture(source, 2, {
      modules: [module("Fictional revision two", [shared])],
    });
    await assert.rejects(readLesson(teacher), /PT409/);
    assert.equal((await call(teacher)).items[0].source_version, 2);
    await sql(
      `update public.job_claims set status='cancelled' where id=${q(teaching[1].claim)}`,
    );
    assert.deepEqual((await call(teacher)).items, []);
    await assert.rejects(readLesson(teacher, source, shared.id, 2), /42501/);
    console.log(
      "Current course scopes, published lesson search, material remapping and independent optimistic drafts passed.",
    );
  },
);
