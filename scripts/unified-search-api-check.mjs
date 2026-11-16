/** Actual authenticated cursor pagination and resource revocation. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withApiFixture } from "./testing/api.mjs";
import { quoteSql as q } from "./testing/database.mjs";

await withApiFixture(async ({ actor, service, checked, sql, defer }) => {
  const owner = await actor("unified-search-owner", "lecturer"),
    peer = await actor("unified-search-peer", "lecturer"),
    file = randomUUID(),
    peerFile = randomUUID(),
    prefix = `Fictional-search-${randomUUID()}`;
  defer(() =>
    sql(
      `delete from public.documents where owner_id in(${q(owner.id)},${q(peer.id)});delete from public.notifications where user_id in(${q(owner.id)},${q(peer.id)});`,
    ),
  );
  await checked(
    service.from("documents").insert([
      {
        id: file,
        owner_id: owner.id,
        uploaded_by: owner.id,
        scope: "personal",
        kind: "material",
        original_name: `${prefix} ä %_&?#.pdf`,
        mime_type: "application/pdf",
        size_bytes: 1,
        status: "clean",
        client_id: randomUUID(),
      },
      {
        id: peerFile,
        owner_id: peer.id,
        uploaded_by: peer.id,
        scope: "personal",
        kind: "material",
        original_name: `${prefix} peer private.pdf`,
        mime_type: "application/pdf",
        size_bytes: 1,
        status: "clean",
        client_id: randomUUID(),
      },
    ]),
    "Create only fictional file metadata",
  );
  const search = (client, query, cursor = null) =>
    checked(
      client.rpc("unified_search", {
        p_query: query,
        p_kind: "files",
        p_after_kind: cursor?.kind ?? null,
        p_after_title: cursor?.title ?? null,
        p_after_id: cursor?.id ?? null,
        p_limit: 40,
      }),
      "Search with actual authenticated REST",
    );
  let result = await search(owner.client, prefix);
  assert.deepEqual(
    result.items.map((row) => row.id),
    [file],
  );
  assert.equal(
    new URL(result.items[0].url, "https://example.invalid").searchParams.get(
      "q",
    ),
    `${prefix} ä %_&?#.pdf`,
  );
  assert.deepEqual(
    (await search(peer.client, prefix)).items.map((row) => row.id),
    [peerFile],
  );
  await sql(
    `insert into public.documents(owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) select ${q(owner.id)},${q(owner.id)},'personal','material',${q(prefix + " page ")}||lpad(i::text,4,'0')||'.txt','text/plain',1,'clean',gen_random_uuid() from generate_series(1,1005)i;`,
  );
  const ids = new Set();
  let cursor = null;
  do {
    result = await search(owner.client, `${prefix} page`, cursor);
    for (const row of result.items) {
      assert.ok(!ids.has(row.id));
      ids.add(row.id);
    }
    cursor = result.next_cursor;
    assert.equal(result.has_more, Boolean(cursor));
  } while (cursor);
  assert.equal(ids.size, 1005, "Actual REST traverses beyond its 1000-row cap");
  await checked(
    service
      .from("documents")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", file),
  );
  assert.equal((await search(owner.client, `${prefix} ä`)).items.length, 0);
  await checked(
    service.from("profiles").update({ active: false }).eq("id", owner.id),
  );
  assert.equal(
    (await owner.client.rpc("unified_search", { p_query: prefix })).error?.code,
    "42501",
  );
  console.log(
    "Actual Auth/REST unified search: 1005-row cursor traversal, peer isolation, exact Unicode URLs, current removal and suspension passed.",
  );
});
