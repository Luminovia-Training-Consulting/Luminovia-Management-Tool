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
        privateTemplate = randomUUID();
    await sql(
        `insert into auth.users(id, email)
         values (${q(author)}, 'author@example.invalid'),
                (${q(reader)}, 'reader@example.invalid'),
                (${q(manager)}, 'manager@example.invalid'),
                (${q(denied)}, 'denied@example.invalid');
     insert into public.user_roles(user_id,role) values(${q(author)},'lecturer'),(${q(reader)},'lecturer'),(${q(manager)},'admin'),(${q(denied)},'lecturer');
     insert into public.course_templates(id,title) values(${q(template)},'Fictional shared template'),(${q(privateTemplate)},'Fictional private template');
     insert into public.course_runs(id,template_id,published) values(${q(run)},${q(template)},true);`,
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
    await sql(`update public.course_runs set published=false where id=${q(run)}`);
    assert.deepEqual(await list(reader), []);
    assert.equal(await actor(reader, `select count(*) from public.wiki_pages where id=${q(page)}`), "1");
    console.log("PASS wiki template references: caller visibility, draft revision CAS, immutable published snapshot, archive and delete boundaries");
});