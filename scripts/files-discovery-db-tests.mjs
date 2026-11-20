/** Real PostgreSQL metadata/search/CAS/privacy proofs; native REST cap separately. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("files_discovery", async ({sql, actor}) => {
    const teacher = randomUUID(),
        peer = randomUUID(),
        admin = randomUUID();
    await sql(
        `insert into auth.users(id,email) values(${q(teacher)},'files-discovery-teacher@example.invalid'),(${q(peer)},'files-discovery-peer@example.invalid'),(${q(admin)},'files-discovery-admin@example.invalid');insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(admin)},'admin')`,
    );
    let checks = 0;
    const check = async (name, run) => {
        await run();
        checks++;
        console.log("PASS " + name);
    };
    const read = async (who = teacher, args = "") =>
        JSON.parse(await actor(who, `select public.document_discovery(${args})`));
    const save = async (who, id, version, tags = [], folder = "") =>
        JSON.parse(
            await actor(
                who,
                `select public.save_document_organisation(${q(id)},${q(JSON.stringify({tags, folder}))}::jsonb,${version})`,
            ),
        );
    const oldest = randomUUID(),
        foreign = randomUUID();
    await sql(
        `insert into public.documents(owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id,created_at) select ${q(teacher)},${q(teacher)},'personal','material','Recent-'||n||'.txt','text/plain',100,gen_random_uuid(),now()-n*interval '1 second' from generate_series(1,1004)n;insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id,created_at) values(${q(oldest)},${q(teacher)},${q(teacher)},'personal','material','Old-needle-%_handout.txt','text/plain',100,gen_random_uuid(),now()-interval '1 day'),(${q(foreign)},${q(peer)},${q(peer)},'personal','material','PRIVATE foreign material.txt','text/plain',100,gen_random_uuid(),now())`,
    );
    await check(
        "Legacy capped response demonstrably omits an old file; literal server search finds it beyond 1000 rows",
        async () => {
            const legacy = JSON.parse(
                await actor(
                    teacher,
                    "select jsonb_agg(id) from (select id from public.documents where deleted_at is null order by created_at desc limit 1000)x",
                ),
            );
            assert.equal(legacy.length, 1000);
            assert.ok(!legacy.includes(oldest));
            assert.equal(
                (await read(teacher, "'Old-needle-%_'")).items[0].id,
                oldest,
            );
            assert.equal((await read(teacher, "'%_'")).items.length, 1);
            assert.equal((await read(teacher, "'does not exist'")).items.length, 0);
            assert.equal(
                (await read(teacher, `'Old-needle','','',${q(peer)}`)).items.length,
                0,
            );
            assert.equal(
                (await read(teacher, "'Old-needle','','',null,'certificate'")).items
                    .length,
                0,
            );
            assert.equal((await read(peer, "'Old-needle'")).items.length, 0);
            assert.equal((await read(admin, "'Old-needle'")).items.length, 0);
        },
    );
    await check(
        "Bounded tuple pages cover all authorized records without duplicate IDs or foreign metadata",
        async () => {
            let page = await read(teacher, "'','','',null,'',null,null,null,100"),
                seen = [];
            while (true) {
                seen.push(...page.items.map((item) => item.id));
                if (!page.has_more) break;
                page = await read(
                    teacher,
                    `'','','',null,'',null,${q(page.next_cursor.at)},${q(page.next_cursor.id)},100`,
                );
            }
            assert.equal(seen.length, 1005);
            assert.equal(new Set(seen).size, 1005);
            assert.ok(!seen.includes(foreign));
            assert.equal(page.next_cursor, null);
            const same = Array.from({length: 45}, randomUUID),
                at = "2044-01-01T00:00:00Z";
            await Promise.all(
                [same.slice(0, 22), same.slice(22)].map((part) =>
                    sql(
                        `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,client_id,created_at) values ${part.map((id) => `(${q(id)},${q(teacher)},${q(teacher)},'personal','material','Same timestamp.txt','text/plain',100,gen_random_uuid(),${q(at)})`).join(",")}`,
                    ),
                ),
            );
            page = await read(
                teacher,
                "'Same timestamp','','',null,'',null,null,null,20",
            );
            seen = [];
            while (true) {
                seen.push(...page.items.map((item) => item.id));
                if (!page.has_more) break;
                page = await read(
                    teacher,
                    `'Same timestamp','','',null,'',null,${q(page.next_cursor.at)},${q(page.next_cursor.id)},20`,
                );
            }
            assert.deepEqual(seen, [...same].sort().reverse());
        },
    );
    await check(
        "Filters and cursors are validated; no client may call anonymously or mutate the organisation table",
        async () => {
            for (const args of [
                "null",
                "'x','','',null,'forged'",
                "'','','',null,'',null,null,null,0",
                "'','','',null,'',null,null,null,101",
                `'','','',null,'',null,null,${q(oldest)}`,
                `'','','',null,'',null,'infinity',${q(oldest)}`,
                q("x".repeat(161)),
            ])
                await assert.rejects(read(teacher, args), /22023/);
            for (const signature of [
                "public.document_discovery(text,text,text,uuid,text,uuid,timestamp with time zone,uuid,integer)",
                "private.document_discovery(text,text,text,uuid,text,uuid,timestamp with time zone,uuid,integer)",
                "public.save_document_organisation(uuid,jsonb,integer)",
                "private.save_document_organisation(uuid,jsonb,integer)",
            ])
                assert.equal(
                    await sql(
                        `select has_function_privilege('anon',${q(signature)},'execute')`,
                    ),
                    "f",
                );
            await assert.rejects(
                actor(teacher, "select * from private.document_organisation"),
                /permission denied/,
            );
            await assert.rejects(
                save(admin, oldest, 0, ["Forged"], "Forged"),
                /42501/,
            );
        },
    );
    await check(
        "Own tags and virtual folders persist, filter the complete catalogue and never alter document bytes or scope",
        async () => {
            const before = await sql(
                `select to_jsonb(d) from public.documents d where id=${q(oldest)}`,
            );
            assert.deepEqual(
                await save(
                    teacher,
                    oldest,
                    0,
                    [" Linux ", "linux", "%_"],
                    " Preparation ",
                ),
                {tags: ["%_", "linux"], folder: "Preparation", version: 1},
            );
            const row = (await read(teacher, "'','linux','preparation'")).items[0];
            assert.equal(row.id, oldest);
            assert.equal(row.personal_version, 1);
            assert.deepEqual(row.personal_tags, ["%_", "linux"]);
            assert.equal(row.personal_folder, "Preparation");
            assert.equal((await read(teacher, "'','%_'")).items[0].id, oldest);
            assert.equal(
                (await read(peer, "'','linux','Preparation'")).items.length,
                0,
            );
            assert.equal(
                (await read(admin, "'','linux','Preparation'")).items.length,
                0,
            );
            assert.equal(
                await sql(
                    `select to_jsonb(d) from public.documents d where id=${q(oldest)}`,
                ),
                before,
            );
        },
    );
    await check(
        "CAS concurrent writers have exactly one winner and stale drafts cannot overwrite the private row",
        async () => {
            const results = await Promise.allSettled([
                save(teacher, oldest, 1, ["Winner A"], "A"),
                save(teacher, oldest, 1, ["Winner B"], "B"),
            ]);
            assert.equal(
                results.filter((item) => item.status === "fulfilled").length,
                1,
            );
            assert.match(
                results.find((item) => item.status === "rejected").reason.message,
                /40001/,
            );
            await assert.rejects(
                save(teacher, oldest, 1, ["Stale"], "Stale"),
                /40001/,
            );
            for (const payload of [
                {tags: ["x"], folder: "x", user_id: peer},
                {tags: ["x".repeat(61)], folder: ""},
                {tags: [], folder: "x".repeat(81)},
                {tags: [], folder: "bad\nfolder"},
                {tags: "forged", folder: ""},
            ])
                await assert.rejects(
                    actor(
                        teacher,
                        `select public.save_document_organisation(${q(oldest)},${q(JSON.stringify(payload))}::jsonb,2)`,
                    ),
                );
            assert.equal((await save(teacher, oldest, 2, [], "")).version, 3);
            assert.equal(
                (await read(teacher, `'Old-needle','',''`)).items[0].id,
                oldest,
            );
        },
    );
    await check(
        "Two readers of one shared file have independent private organisation; revoked access fails closed",
        async () => {
            const job = randomUUID(),
                shared = randomUUID();
            await sql(
                `insert into public.jobs(id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms) values(${q(job)},'Fictional shared metadata job','Fictional client','online','published',100,'EUR','fixed_total',100,'Fictional terms');insert into public.documents(id,owner_id,uploaded_by,scope,kind,job_id,original_name,mime_type,size_bytes,client_id) values(${q(shared)},${q(teacher)},${q(teacher)},'job_before','material',${q(job)},'Shared course.txt','text/plain',100,gen_random_uuid())`,
            );
            await save(teacher, shared, 0, ["PRIVATE-A"], "Teacher A");
            await save(peer, shared, 0, ["PRIVATE-B"], "Teacher B");
            assert.equal(
                (await read(peer, `'','',null,null,'',${q(job)}`)).items[0].id,
                shared,
            );
            assert.equal(
                (await read(teacher, "'Shared course'")).items[0].personal_folder,
                "Teacher A",
            );
            assert.equal(
                (await read(peer, "'Shared course'")).items[0].personal_folder,
                "Teacher B",
            );
            assert.deepEqual(
                (await read(admin, "'Shared course'")).items[0].personal_tags,
                [],
            );
            await sql(`update public.jobs set status='draft' where id=${q(job)}`);
            assert.deepEqual(
                (await read(peer, "'','PRIVATE-B','Teacher B'")).items,
                [],
            );
            await assert.rejects(
                save(peer, shared, 1, ["Still private"], "Teacher B"),
                /42501/,
            );
            await actor(
                teacher,
                `select public.rename_document(${q(oldest)},'Old-needle-%_handout.txt',true)`,
            );
            assert.deepEqual((await read(teacher, "'Old-needle'")).items, []);
            await assert.rejects(save(teacher, oldest, 3, [], "Archive"), /42501/);
            await sql(`update public.profiles set active=false where id=${q(peer)}`);
            await assert.rejects(read(peer), /42501/);
        },
    );
    console.log(`${checks} file discovery PostgreSQL checks passed.`);
});