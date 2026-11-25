/**
 * Exercise revision-bound wiki course-template references against disposable PostgreSQL,
 * including live template permissions, draft CAS, immutable publication and deletion scope.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("wiki_course_templates", async ({sql, actor}) => {
    const author = randomUUID(),
        reader = randomUUID(),
        manager = randomUUID(),
        denied = randomUUID(),
        template = randomUUID(),
        run = randomUUID(),
        offer = randomUUID(),
        privateTemplate = randomUUID();
    await sql(
        `insert into auth.users(id, email)
         values (${q(author)}, 'author@example.invalid'),
                (${q(reader)}, 'reader@example.invalid'),
                (${q(manager)}, 'manager@example.invalid'),
                (${q(denied)}, 'denied@example.invalid');
     insert into public.user_roles(user_id,role) values(${q(author)},'lecturer'),(${q(reader)},'lecturer'),(${q(manager)},'admin'),(${q(denied)},'lecturer');
     insert into public.course_templates(id,title) values(${q(template)},'Fictional shared template'),(${q(privateTemplate)},'Fictional private template');
     insert into public.course_runs(id,template_id,published) values(${q(run)},${q(template)},false);
     insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
       values(${q(offer)},${q(run)},'Fictional teaching offer','Fictional company','online','published',100,100,'EUR','fixed_total','Fictional terms');
     update public.jobs set capacity=2,capacity_basis='per_position' where id=${q(offer)};
     insert into public.job_claims(job_id,lecturer_id,idempotency_key,status,amount,total_amount,currency,rate_unit,terms,terms_version)
       values ${[author, reader].map((lecturer) => `(${q(offer)},${q(lecturer)},${q(randomUUID())},'confirmed',100,100,'EUR','fixed_total','Fictional terms',1)`).join(",")};`,
    );
    const category = await sql(
        "select id from public.knowledge_categories where kind='wiki' limit 1",
    );
    const content = q(
        JSON.stringify({
            type: "doc",
            content: [{type: "paragraph", content: [{type: "text", text: "Fictional lesson"}]}],
        }),
    );
    const save = async (who, id, version, status = "draft") =>
        JSON.parse(
            await actor(
                who,
                `select public.save_wiki_page(${id ? q(id) : "null"},'Fictional article','de',${q(category)},${content}::jsonb,${q(status)},${version ?? "null"})`,
            ),
        );
    const page = (await save(author, null, null)).page_id;
    const manage = (who, rev, target, remove = false) =>
        actor(
            who,
            `select public.manage_wiki_course_template(${q(page)},${rev},${q(target)},${remove})`,
        );
    const references = z.fromJSONSchema(
        portalOpenApi("https://portal.example.invalid").paths["/rest/v1/rpc/wiki_course_templates"].post
            .responses["200"].content["application/json"].schema,
    );
    const list = async (who) =>
        references.parse(JSON.parse(await actor(who, `select public.wiki_course_templates(${q(page)})`)));

    await assert.rejects(manage(author, 1, privateTemplate), /42501/);
    await manage(author, 1, template);
    assert.deepEqual(await list(author), [
        {template_id: template, title: "Fictional shared template", archived: false},
    ]);
    await assert.rejects(
        actor(denied, `select public.wiki_course_templates(${q(page)})`),
        /42501/,
    );
    await assert.rejects(
        actor(reader, `select public.manage_wiki_course_template(${q(page)},1,${q(template)},false)`),
        /42501/,
    );
    await assert.rejects(
        actor(author, `select * from private.wiki_revision_course_templates`),
        /42501/,
    );
    assert.equal(
        await sql(
            `select has_function_privilege('anon','public.wiki_course_templates(uuid)','execute')`,
        ),
        "f",
    );
    await save(manager, page, 1, "published");
    assert.deepEqual(await list(reader), [
        {template_id: template, title: "Fictional shared template", archived: false},
    ]);
    await save(author, page, 2);
    assert.deepEqual(await list(author), [
        {template_id: template, title: "Fictional shared template", archived: false},
    ]);
    await assert.rejects(manage(author, 2, template), /40001/);
    await sql(`update public.course_templates set archived_at=clock_timestamp() where id=${q(template)}`);
    assert.deepEqual(await list(manager), [
        {template_id: template, title: "Fictional shared template", archived: true},
    ]);
    await assert.rejects(manage(manager, 3, template), /42501/);
    await manage(manager, 3, template, true);
    assert.deepEqual(await list(manager), []);
    assert.deepEqual(await list(reader), [
        {template_id: template, title: "Fictional shared template", archived: true},
    ]);
    await assert.rejects(sql(`delete from public.course_templates where id=${q(template)}`), /foreign key/);
    const scope = JSON.parse(await sql(`select private.deletion_scope('wiki_page',${q(page)})`));
    assert.ok(scope.some((entry) => entry.table === "private.wiki_revision_course_templates"));
    await sql(`update public.job_claims set status='cancelled' where job_id=${q(offer)} and lecturer_id=${q(reader)}`);
    assert.deepEqual(await list(reader), []);
    assert.equal(await actor(reader, `select count(*) from public.wiki_pages where id=${q(page)}`), "1");

    // One shared wiki revision can contain isolated company references; an editor
    // with both memberships must still operate in the selected company only.
    const [companyA, companyB, companyC, templateA, templateB] = Array.from({length: 5}, randomUUID);
    await sql(`insert into public.organisations(id,name) values
      (${q(companyA)},'Fictional company A'),(${q(companyB)},'Fictional company B'),(${q(companyC)},'Fictional company C');
      insert into public.user_roles(user_id,role) values (${q(author)},'client'),(${q(reader)},'client');
      insert into public.client_organisation_memberships(user_id,organisation_id) values
        (${q(author)},${q(companyA)}),(${q(author)},${q(companyB)}),(${q(reader)},${q(companyA)});
      insert into public.course_templates(id,title,owner_organisation_id) values
        (${q(templateA)},'Fictional template A',${q(companyA)}),(${q(templateB)},'Fictional template B',${q(companyB)});`);
    const companyPage = (await save(author, null, null)).page_id;
    const link = (target, company, remove = false, revision = 1) => actor(author,
        `select public.manage_wiki_course_template(${q(companyPage)},${revision},${q(target)},${remove},${company ? q(company) : "null"})`);
    const scopedList = async (who, company) => references.parse(JSON.parse(await actor(who,
        `select public.wiki_course_templates(${q(companyPage)},${company ? q(company) : "null"})`)));
    await assert.rejects(link(templateB, companyA), /42501/);
    await assert.rejects(link(templateB, null), /42501/);
    await assert.rejects(link(templateA, companyC), /42501/);
    await link(templateA, companyA);
    await link(templateB, companyB);
    assert.deepEqual((await scopedList(author, companyA)).map(({template_id}) => template_id), [templateA]);
    assert.deepEqual((await scopedList(author, companyB)).map(({template_id}) => template_id), [templateB]);
    assert.deepEqual(await scopedList(author, null), []);
    assert.equal(await actor(author, `select id from public.wiki_course_template_choices(${q(companyPage)},${q(companyA)})`), templateA);
    await assert.rejects(link(templateB, companyA, true), /42501/);
    await save(manager, companyPage, 1, "published");
    assert.deepEqual((await scopedList(reader, companyA)).map(({template_id}) => template_id), [templateA]);
    await assert.rejects(scopedList(reader, companyB), /42501/);
    const revision = (await save(author, companyPage, 2)).version;
    assert.deepEqual((await scopedList(author, companyB)).map(({template_id}) => template_id), [templateB]);
    await sql(`update public.client_organisation_memberships set removed_at=now() where user_id=${q(author)} and organisation_id=${q(companyB)}`);
    await assert.rejects(link(templateB, companyB, true, revision), /42501/);
    await assert.rejects(scopedList(author, companyB), /42501/);
    assert.deepEqual((await scopedList(manager, null)).map(({template_id}) => template_id), [templateA, templateB]);
    console.log("PASS wiki template references: caller visibility, draft revision CAS, immutable published snapshot, archive and delete boundaries");
});