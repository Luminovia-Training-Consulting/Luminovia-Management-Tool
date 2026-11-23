/** Isolated database proof for file activity receipts, without exposing any file content. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("admin_activity_files", async ({actor, sql}) => {
    const uploader = randomUUID();
    const regular = randomUUID();
    const confidential = randomUUID();
    const rejected = randomUUID();
    const resource = randomUUID();
    const room = randomUUID();
    const versions = Object.fromEntries([regular, confidential, rejected].map((id) => [id, randomUUID()]));
    await sql(`
        insert into auth.users(id,email) values (${q(uploader)},'fictional-file-owner@example.invalid');
        insert into public.user_roles(user_id,role) values (${q(uploader)},'lecturer');
        insert into public.chat_rooms(id,kind,dm_key)
          values(${q(room)},'dm',${q(randomUUID())});
    `);
    for (const doc of [regular, confidential, rejected]) {
        const privateChat = doc === confidential;
        await sql(`
            insert into public.documents(id,owner_id,uploaded_by,scope,kind,room_id,original_name,mime_type,size_bytes,client_id)
            values(${q(doc)},${q(uploader)},${q(uploader)},${q(privateChat ? "room" : "personal")},
              ${q(privateChat ? "chat" : "material")},${privateChat ? q(room) : "null"},
              'Private filename.pdf','application/pdf',5,${q(randomUUID())});
            insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes)
            values(${q(versions[doc])},${q(doc)},${q(uploader)},${q(randomUUID())},1,
              ${q(`private/${doc}`)},'Private filename.pdf','application/pdf',5);
            update public.documents set current_version_id=${q(versions[doc])} where id=${q(doc)};
        `);
    }
    const receiptRows = async () => JSON.parse(await sql(`
        select coalesce(jsonb_agg(jsonb_build_object('actor',actor_id,'action',action,'resource',resource_id)
          order by action,resource_id),'[]') from private.administration_activity
          where action in ('document.uploaded','document.file_downloaded')
    `));
    assert.deepEqual(await receiptRows(), [], "A reservation does not count as an upload");
    const publish = (doc, status) => `
        update public.document_versions set status=${q(status)},sha256=repeat('a',64),scanner_version='Fictional scanner'
        where id=${q(versions[doc])}
    `;
    await sql(`begin; ${publish(regular, "clean")}; rollback;`);
    assert.deepEqual(await receiptRows(), [], "The upload receipt rolls back with publication");
    await sql(`${publish(regular, "clean")}; ${publish(regular, "clean")};
        ${publish(confidential, "clean")}; ${publish(rejected, "rejected")};`);
    const uploaded = {actor: uploader, action: "document.uploaded", resource: regular};
    assert.deepEqual(await receiptRows(), [uploaded], "Only a verified publication outside chat is recorded, exactly once");

    const record = `select public.record_admin_file_download(${q(uploader)},${q(resource)})`;
    await assert.rejects(actor(uploader, record), /42501/);
    await assert.rejects(sql(`begin; set local role anon; ${record}; rollback;`), /42501/);
    await sql(`begin; set local role service_role; ${record}; commit;`);
    assert.deepEqual(await receiptRows(), [
        {actor: uploader, action: "document.file_downloaded", resource},
        uploaded,
    ]);
    assert.equal(await sql(`
        select count(*) from public.audit_events where action in ('document.uploaded','document.file_downloaded')
    `), "0", "The 30-day transfer journal does not duplicate immutable business receipts");
    console.log("PASS file publication and worker-only download receipts stay in the private activity journal");
});
