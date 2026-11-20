/** Wiki attachment version and access tests against an isolated real PostgreSQL database. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("wiki_attachments", async ({sql, actor}) => {
    const author = randomUUID(),
        peer = randomUUID(),
        admin = randomUUID(),
        learner = randomUUID(),
        contributor = randomUUID();
    await sql(
        `insert into auth.users(id,email) values(${q(author)},'author@example.invalid'),(${q(peer)},'peer@example.invalid'),(${q(admin)},'admin@example.invalid'),(${q(learner)},'learner@example.invalid'),(${q(contributor)},'contributor@example.invalid'); insert into public.user_roles(user_id,role) values(${q(author)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin'),(${q(learner)},'participant'),(${q(contributor)},'management')`,
    );
    const category = await sql(
        "select id from public.knowledge_categories where kind='wiki' limit 1",
    );
    const content = q(
        JSON.stringify({
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [{type: "text", text: "Fictional lesson"}],
                },
            ],
        }),
    );
    const save = async (who, id, version, status = "draft", aal = "aal1") =>
        JSON.parse(
            await actor(
                who,
                `select public.save_wiki_page(${id ? q(id) : "null"},'Fictional article','de',${q(category)},${content}::jsonb,${q(status)},${version ?? "null"})`,
                aal,
            ),
        );
    const page = (await save(author, null, null)).page_id;
    const makeDoc = async (who, kind = "material") => {
        const id = randomUUID(),
            v = randomUUID(),
            key = randomUUID();
        await sql(
            `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(id)},${q(who)},${q(who)},'personal',${q(kind)},'fictional.txt','text/plain',10,'clean',${q(key)});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(v)},${q(id)},${q(who)},${q(key)},1,${q("fixture/" + v)},'fictional.txt','text/plain',10,'clean',repeat('a',64));update public.documents set current_version_id=${q(v)} where id=${q(id)}`,
        );
        return {id, v};
    };
    const own = await makeDoc(author),
        foreign = await makeDoc(peer),
        contract = await makeDoc(author, "contract");
    const manage = (who, version, rev = 1, remove = false, aal = "aal1") =>
        actor(
            who,
            `select public.manage_wiki_attachment(${q(page)},${rev},${q(version)},${remove})`,
            aal,
        );
    const list = async (who, aal = "aal1") =>
        JSON.parse(
            await actor(who, `select public.wiki_attachments(${q(page)})`, aal),
        );
    await assert.rejects(list(peer), /42501/);
    await assert.rejects(manage(author, foreign.v), /42501/);
    await assert.rejects(manage(author, contract.v), /42501/);
    await assert.rejects(manage(peer, own.v), /42501/);
    await manage(author, own.v);
    let [draft] = await list(author);
    assert.equal(draft.version_id, own.v);
    assert.equal(
        await actor(
            peer,
            `select count(*) from public.documents where id=${q(own.id)}`,
        ),
        "0",
    );
    await assert.rejects(
        actor(peer, `select public.wiki_attachment_access(${q(draft.id)})`),
        /42501/,
    );
    const published = await save(admin, page, 1, "published", "aal2");
    assert.equal(published.version, 2);
    const [shared] = await list(peer);
    assert.equal(shared.version_id, own.v);
    const allowedAccess = JSON.parse(
        await actor(peer, `select public.wiki_attachment_access(${q(shared.id)})`),
    );
    assert.equal(allowedAccess.version_id, own.v);
    assert.equal(
        "object_path" in allowedAccess,
        false,
        "wiki readers never receive the underlying storage path",
    );
    await assert.rejects(
        actor(
            peer,
            `select public.wiki_attachment_storage_path(${q(shared.id)},${q(own.v)})`,
        ),
        /42501/,
    );
    assert.equal(
        await sql(
            `begin;set local role service_role;select public.wiki_attachment_storage_path(${q(shared.id)},${q(own.v)});commit`,
        ),
        `fixture/${own.v}`,
    );
    assert.equal(
        await sql(
            `begin;set local role service_role;select coalesce(public.wiki_attachment_storage_path(${q(shared.id)},${q(foreign.v)}),'denied');commit`,
        ),
        "denied",
    );
    assert.equal(
        await actor(
            peer,
            `select count(*) from public.documents where id=${q(own.id)}`,
        ),
        "0",
    );
    await assert.rejects(list(learner), /42501/);
    await assert.rejects(manage(author, own.v, 2, true), /40001/);
    const next = await save(author, page, 2);
    assert.equal(next.version, 3);
    await manage(author, own.v, 3, true);
    assert.deepEqual(await list(author), []);
    assert.equal((await list(peer))[0].version_id, own.v);
    // Simultaneous publication and attachment edits serialize on the page row:
    // the link is copied into the published revision if and only if its add won.
    const [addition, publication] = await Promise.allSettled([
        manage(author, own.v, 3),
        save(admin, page, 3, "published", "aal2"),
    ]);
    assert.equal(publication.status, "fulfilled");
    if (addition.status === "rejected")
        assert.match(String(addition.reason), /40001/);
    const afterRace = await list(peer);
    assert.equal(
        afterRace.some((item) => item.version_id === own.v),
        addition.status === "fulfilled",
    );
    await assert.rejects(
        actor(peer, `select * from private.wiki_revision_attachments`),
        /42501/,
    );
    const deletion = JSON.parse(
        await sql(`select private.deletion_scope('wiki_page',${q(page)})`),
    );
    assert.ok(
        deletion.some(
            (entry) => entry.table === "private.wiki_revision_attachments",
        ),
    );
    // A manager who contributed an attachment is not the article owner. Their
    // account must remain a protected blocker, never a cascade into that page.
    const otherPage = (await save(author, null, null)).page_id;
    const contributed = await makeDoc(contributor);
    await actor(
        contributor,
        `select public.manage_wiki_attachment(${q(otherPage)},1,${q(contributed.v)},false)`,
        "aal2",
    );
    await save(admin, otherPage, 1, "published", "aal2");
    const publishedBefore = await sql(
        `select row_to_json(p)::text from public.wiki_pages p where p.id=${q(otherPage)}`,
    );
    const attachmentsBefore = await sql(
        `select json_agg(to_jsonb(a) order by revision,id)::text from private.wiki_revision_attachments a where page_id=${q(otherPage)}`,
    );
    const plan = JSON.parse(
        await actor(
            admin,
            `select public.deletion_preview('account',${q(contributor)})`,
            "aal2",
        ),
    );
    assert.equal(plan.can_confirm, false, JSON.stringify(plan));
    assert.ok(
        plan.blockers.some(
            (item) =>
                item.kind === "private.wiki_revision_attachments" && item.count > 0,
        ),
    );
    await assert.rejects(
        actor(
            admin,
            `select public.deletion_confirm(${q(plan.plan_id)},${q(randomUUID())},'DELETE')`,
            "aal2",
        ),
        /23503/,
    );
    assert.equal(
        await sql(
            `select count(*) from private.deletion_operations where plan_id=${q(plan.plan_id)}`,
        ),
        "0",
    );
    assert.equal(
        await sql(
            `select row_to_json(p)::text from public.wiki_pages p where p.id=${q(otherPage)}`,
        ),
        publishedBefore,
    );
    assert.equal(
        await sql(
            `select json_agg(to_jsonb(a) order by revision,id)::text from private.wiki_revision_attachments a where page_id=${q(otherPage)}`,
        ),
        attachmentsBefore,
    );
    await assert.rejects(
        sql(`delete from public.profiles where id=${q(contributor)}`),
        /foreign key/,
    );
    assert.equal(
        await sql(
            `select count(*) from public.wiki_pages where id=${q(otherPage)} and published_version=2`,
        ),
        "1",
    );
    await sql(`update public.profiles set active=false where id=${q(peer)}`);
    await assert.rejects(list(peer), /42501/);
    console.log(
        "PASS wiki draft/published immutable shares, exact versions, private source ACL, role/MFA and deletion scope",
    );
});