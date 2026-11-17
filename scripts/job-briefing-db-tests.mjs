/** Real isolated PostgreSQL checks for job references, selectively released
 * contacts, versioned edits and retries. Native Auth/HTTP is verified separately. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const admin = "bd100000-0000-4000-8000-000000000001";
const manager = "bd100000-0000-4000-8000-000000000002";
const teacher = "bd100000-0000-4000-8000-000000000003";
const peer = "bd100000-0000-4000-8000-000000000004";
const learner = "bd100000-0000-4000-8000-000000000005";
const client = "bd100000-0000-4000-8000-000000000006";
const guest = "bd100000-0000-4000-8000-000000000007";
let checks = 0;

await withTestDatabase("job_briefing", async ({ sql, actor }) => {
  const actors = [
    [admin, "admin"],
    [manager, "management"],
    [teacher, "lecturer"],
    [peer, "lecturer"],
    [learner, "participant"],
    [client, "client"],
    [guest, "guest"],
  ];
  await sql(`insert into auth.users(id,email) values ${actors.map(([id, role]) => `(${q(id)},${q(`briefing-${role}-${id}@example.invalid`)})`).join(",")};
    insert into public.user_roles(user_id,role) values ${actors.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};`);
  let day = 1;
  /** Each offer owns a future, non-conflicting block, without contract prerequisites. */
  const create = async (status = "published") => {
    const payload = {
      title: "Fictional optional job briefing",
      customer_name: "Fictional briefing organisation",
      delivery_type: "online",
      status,
      amount: 100,
      total_amount: 100,
      currency: "EUR",
      rate_unit: "fixed_total",
      terms: "Immutable original briefing-fixture terms",
      requires_contract: false,
      sessions: [
        {
          starts_at: new Date(Date.UTC(2051, 0, day, 8)).toISOString(),
          ends_at: new Date(Date.UTC(2051, 0, day, 9)).toISOString(),
        },
      ],
    };
    day += 2;
    return actor(
      admin,
      `select public.create_job(${q(JSON.stringify(payload))}::jsonb)`,
      "aal1",
    );
  };
  /** Read only the public invoker projection under the selected actual SQL actor. */
  const get = async (job, who = admin, aal = "aal1") =>
    JSON.parse(await actor(who, `select public.job_briefing(${q(job)})`, aal));
  /** Bind the complete reviewed payload, expected version and request key. */
  const save = async (
    job,
    values,
    version = 0,
    key = randomUUID(),
    who = admin,
    aal = "aal1",
  ) =>
    JSON.parse(
      await actor(
        who,
        `select public.save_job_briefing(${q(job)},${version === null ? "null" : version},${key === null ? "null" : q(key)},${q(JSON.stringify(values))}::jsonb)`,
        aal,
      ),
    );
  /** Count only completed assertions; no failed or skipped case becomes acceptance evidence. */
  const check = async (name, fn) => {
    await fn();
    checks++;
    console.log("PASS " + name);
  };
  const payload = {
    reference_url:
      "https://briefing.example.invalid/original?topic=network#details",
    reference_label: "Original fictional specification",
    reference_description:
      "According to the linked fictional specification.\n<script>literal authored example</script>",
    contact_name: "Fictional Coordinator",
    contact_email: "coordinator@example.invalid",
    contact_phone: "+49 (0) 40 123-456",
    contact_description: "Fictional scheduling contact only.",
    contact_visibility: "after_claim",
  };

  await check(
    "Empty existing jobs keep optional defaults; unrelated client/learner/guest/anonymous and draft peers are denied",
    async () => {
      const job = await create(),
        draft = await create("draft");
      const defaults = await get(job, teacher, "aal1");
      assert.equal(defaults.version, 0);
      assert.equal(defaults.reference_url, "");
      assert.equal(defaults.has_contact, false);
      assert.equal(defaults.contact_visible, false);
      assert.equal(defaults.contact_visibility, "after_claim");
      assert.equal(defaults.can_edit, false);
      for (const who of [learner, client, guest])
        await assert.rejects(get(job, who, "aal1"), /42501/);
      await assert.rejects(get(draft, peer, "aal1"), /42501/);
      await assert.rejects(
        sql(`set role anon;select public.job_briefing(${q(job)});`),
        /42501/,
      );
    },
  );

  await check(
    "Only active current job managers with permission save; forged fields and malformed versions fail without rows",
    async () => {
      const job = await create();
      for (const who of [admin, manager]) {
        const authorizedJob = await create();
        const authorized = await save(
          authorizedJob,
          payload,
          0,
          randomUUID(),
          who,
          "aal1",
        );
        assert.equal(authorized.version, 1);
        assert.equal(authorized.can_manage, true);
      }
      for (const who of [teacher, peer, learner, client, guest]) {
        await assert.rejects(
          save(job, payload, 0, randomUUID(), who, "aal1"),
          /42501/,
        );
      }
      for (const who of [teacher, learner, client, guest])
        await assert.rejects(
          save(job, payload, 0, randomUUID(), who, "aal1"),
          /42501/,
        );
      for (const extra of [
        { user_id: admin },
        { organisation_id: randomUUID() },
        { can_edit: true },
        { version: 7 },
        { contact_visibility: null },
        { contact_name: 42 },
      ]) {
        await assert.rejects(save(job, { ...payload, ...extra }), /22023/);
      }
      await assert.rejects(save(job, payload, null), /22023/);
      await assert.rejects(save(job, payload, -1), /22023/);
      await assert.rejects(save(job, payload, 0, null), /22023/);
      for (const malformed of [null, [], "not an object"]) {
        await assert.rejects(save(job, malformed), /22023/);
      }
      await assert.rejects(
        save(job, { contact_name: " ".repeat(121) }),
        /22023/,
      );
      assert.equal((await get(job)).version, 0);
    },
  );

  await check(
    "Authorized managers and assigned lecturers see scoped contacts while peers do not",
    async () => {
      const job = await create();
      const saved = await save(job, payload);
      assert.equal(saved.version, 1);
      assert.equal(saved.can_manage, true);
      assert.equal(saved.can_edit, true);
      assert.equal(saved.contact_email, payload.contact_email);
      const peerView = await get(job, peer, "aal1");
      assert.equal(peerView.reference_url, payload.reference_url);
      assert.equal(
        peerView.reference_description,
        payload.reference_description,
      );
      assert.equal(peerView.has_contact, true);
      assert.equal(peerView.contact_visible, false);
      for (const key of [
        "contact_name",
        "contact_email",
        "contact_phone",
        "contact_description",
      ])
        assert.equal(peerView[key], "");
      const passwordOnly = await get(job, admin, "aal1");
      assert.equal(passwordOnly.can_manage, true);
      assert.equal(passwordOnly.contact_visible, true);
      assert.equal(passwordOnly.contact_email, payload.contact_email);
      const raw = await actor(
        peer,
        `select to_jsonb(j) from public.jobs j where id=${q(job)}`,
        "aal1",
      );
      assert(!raw.includes("coordinator@example.invalid"));
      assert(!raw.includes(payload.reference_url));
    },
  );

  await check(
    "Explicit offer-viewer release and clearing work without importing internal organisation contacts or notes",
    async () => {
      const job = await create();
      const released = { ...payload, contact_visibility: "offer_viewers" };
      await save(job, released);
      const peerView = await get(job, peer, "aal1");
      assert.equal(peerView.contact_visible, true);
      assert.equal(peerView.contact_name, payload.contact_name);
      assert.equal(peerView.contact_email, payload.contact_email);
      assert.equal(
        (await get(job, teacher, "aal1")).contact_description,
        payload.contact_description,
      );
      await save(job, {}, 1);
      const cleared = await get(job, peer, "aal1");
      assert.equal(cleared.version, 2);
      assert.equal(cleared.has_contact, false);
      assert.equal(cleared.reference_description, "");
      assert.equal(
        await sql(`select count(*) from public.organisation_contacts`),
        "0",
      );
    },
  );

  await check(
    "Safe duplication creates a new unshared briefing instead of copying personal contact data",
    async () => {
      const job = await create();
      await save(job, payload);
      const state = JSON.parse(
        await actor(admin, `select public.job_lifecycle(${q(job)})`, "aal1"),
      );
      const copy = await actor(
        admin,
        `select public.manage_job_offer(${q(job)},'duplicate',${state.version},${q(randomUUID())},'{"title":"Fictional separately reviewed copy"}'::jsonb)`,
        "aal1",
      );
      assert.notEqual(copy, job);
      const copied = await get(copy);
      assert.equal(copied.version, 0);
      assert.equal(copied.has_contact, false);
      assert.equal(copied.reference_url, "");
      assert.equal((await get(job)).contact_email, payload.contact_email);
    },
  );

  await check(
    "URLs reject executable schemes, credentials, control characters and invalid ports; optional bounds are strict",
    async () => {
      const job = await create();
      for (const url of [
        "javascript:alert(1)",
        "data:text/html,test",
        "//example.invalid",
        "https:///bad",
        "https://u:p@example.invalid/path",
        "https://example.invalid/a b",
        "https://example.invalid/a\nb",
        "https://example.invalid:65536",
        "https://example.invalid:0",
        "https://[:::]/brief",
        "https://[1:2:3:4:5:6:7]/brief",
        "https://[1:2:3:4:5:6:7:8:9]/brief",
        "https://[::1/64]/brief",
        "https://example.invalid/a\\b",
        "https://example.invalid/a\u00a0b",
        "https://example.invalid/a\ufeffb",
        "https://999.999.999.999/brief",
        "https://256.0.0.1/brief",
        "https://1.2.3.09/brief",
        "https://example.123/brief",
        "https://example.0x12/brief",
        "https://example.0x/brief",
        "https://0x100000000/brief",
        "https://münchen.example.invalid/brief",
      ]) {
        await assert.rejects(
          save(job, { ...payload, reference_url: url }),
          /22023/,
        );
      }
      for (const extra of [
        { reference_url: "x".repeat(2049) },
        { reference_label: "x".repeat(121) },
        { reference_description: "x".repeat(4001) },
        { contact_name: "x".repeat(121) },
        { contact_email: "bad@example.invalid\nBcc:evil@example.invalid" },
        { contact_email: "invalid" },
        { contact_email: "person\u00a0name@example.invalid" },
        { contact_email: "person\ufeffname@example.invalid" },
        { contact_email: "x".repeat(255) },
        { contact_phone: "123\r\n456" },
        { contact_phone: "1".repeat(51) },
        { contact_description: "x".repeat(2001) },
        { contact_visibility: "public" },
      ]) {
        await assert.rejects(save(job, { ...payload, ...extra }), /22023/);
      }
      assert.equal((await get(job)).version, 0);
      let version = 0;
      for (const reference_url of [
        "http://[::1]:8443/reference",
        "https://[2001:db8::1]/reference",
        "http://127.0.0.1:8080/reference",
        "https://xn--mnchen-3ya.example.invalid/reference",
        "https://example.invalid/a%20b",
      ]) {
        const saved = await save(job, { ...payload, reference_url }, version);
        version++;
        assert.equal(saved.reference_url, reference_url);
        assert.doesNotThrow(() => new URL(saved.reference_url));
        assert.equal((await get(job)).reference_url, reference_url);
      }
      // PostgreSQL counts Unicode characters, including supplementary code
      // points, rather than the UTF-16 units used by HTML input maxlength.
      const unicode = {
        ...payload,
        contact_name: "😀".repeat(120),
        reference_description: "😀".repeat(4000),
      };
      const storedUnicode = await save(job, unicode, version);
      assert.equal(storedUnicode.contact_name, unicode.contact_name);
      assert.equal(
        storedUnicode.reference_description,
        unicode.reference_description,
      );
      const exactUnicode = JSON.parse(
        await actor(
          admin,
          `with saved as (select public.job_briefing(${q(job)}) as value)
           select jsonb_build_object(
             'name_characters', char_length(value->>'contact_name'),
             'name_bytes', octet_length(value->>'contact_name'),
             'name_exact', convert_to(value->>'contact_name','UTF8')=decode(${q(Buffer.from(unicode.contact_name).toString("base64"))},'base64'),
             'description_characters', char_length(value->>'reference_description'),
             'description_bytes', octet_length(value->>'reference_description'),
             'description_exact', convert_to(value->>'reference_description','UTF8')=decode(${q(Buffer.from(unicode.reference_description).toString("base64"))},'base64')
           ) from saved`,
          "aal1",
        ),
      );
      assert.deepEqual(exactUnicode, {
        name_characters: 120,
        name_bytes: 480,
        name_exact: true,
        description_characters: 4000,
        description_bytes: 16000,
        description_exact: true,
      });
      await assert.rejects(
        save(
          job,
          { ...unicode, contact_name: unicode.contact_name + "😀" },
          version + 1,
        ),
        /22023/,
      );
    },
  );

  await check(
    "Same-key concurrent retries save exactly once; changed job, version or payload cannot reuse an identity",
    async () => {
      const job = await create(),
        other = await create(),
        key = randomUUID();
      const result = await Promise.all([
        save(job, payload, 0, key),
        save(job, payload, 0, key),
      ]);
      assert.equal(result[0].version, 1);
      assert.equal(result[1].version, 1);
      assert.equal(
        await sql(
          `select count(*) from public.audit_events where resource_id=${q(job)} and action='job.briefing.saved'`,
        ),
        "1",
      );
      assert.equal(
        await sql(
          `select count(*) from private.job_briefing_requests where job_id=${q(job)}`,
        ),
        "1",
      );
      await assert.rejects(
        save(job, { ...payload, reference_label: "Changed" }, 0, key),
        /22023/,
      );
      await assert.rejects(save(other, payload, 0, key), /22023/);
      await assert.rejects(save(job, payload, 1, key), /22023/);
      await assert.rejects(save(job, payload, 0), /40001/);
      await save(
        job,
        { ...payload, reference_label: "Newer current reference" },
        1,
      );
      const oldRetry = await save(job, payload, 0, key);
      assert.equal(oldRetry.version, 2);
      assert.equal(oldRetry.reference_label, "Newer current reference");
      assert.equal(
        await sql(
          `select count(*) from public.audit_events where resource_id=${q(job)} and action='job.briefing.saved'`,
        ),
        "2",
      );
    },
  );

  await check(
    "Two managers saving the same reviewed version produce one success and one conflict",
    async () => {
      const job = await create();
      await save(job, payload);
      const attempts = await Promise.allSettled([
        save(job, { ...payload, reference_label: "Admin candidate" }, 1),
        save(
          job,
          { ...payload, reference_label: "Manager candidate" },
          1,
          randomUUID(),
          manager,
        ),
      ]);
      assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        attempts.filter(
          (x) => x.status === "rejected" && /40001/.test(x.reason.message),
        ).length,
        1,
      );
      assert.equal((await get(job)).version, 2);
    },
  );

  await check(
    "A real confirmed claim releases its own contact; cancellation removes it without repricing accepted history",
    async () => {
      const job = await create();
      await save(job, payload);
      const quote = await actor(
        teacher,
        `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'=${q(job)}`,
        "aal1",
      );
      const claim = JSON.parse(
        await actor(
          teacher,
          `select public.claim_job(${q(job)},${q(randomUUID())},${quote})`,
          "aal1",
        ),
      );
      assert.equal(claim.status, "confirmed");
      assert.equal(
        (await get(job, teacher, "aal1")).contact_email,
        payload.contact_email,
      );
      await sql(
        `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'guest');`,
      );
      await assert.rejects(get(job, teacher, "aal1"), /42501/);
      await sql(
        `delete from public.user_roles where user_id=${q(teacher)};insert into public.user_roles(user_id,role) values(${q(teacher)},'lecturer');`,
      );
      const before = await sql(
        `select to_jsonb(c) from public.job_claims c where id=${q(claim.claim_id)}`,
      );
      await save(
        job,
        { ...payload, contact_email: "replacement@example.invalid" },
        1,
      );
      assert.equal(
        (await get(job, teacher, "aal1")).contact_email,
        "replacement@example.invalid",
      );
      assert.equal(
        await sql(
          `select to_jsonb(c) from public.job_claims c where id=${q(claim.claim_id)}`,
        ),
        before,
      );
      await actor(
        teacher,
        `select public.cancel_job_assignment(${q(claim.claim_id)},'Fictional schedule cancellation',${q(randomUUID())})`,
        "aal1",
      );
      const cancelled = await get(job, teacher, "aal1");
      assert.equal(cancelled.contact_visible, false);
      assert.equal(cancelled.contact_email, "");
      assert.equal(cancelled.reference_url, payload.reference_url);
    },
  );

  await check(
    "Current role removal and suspension revoke existing actor reads, writes and saved-operation retries",
    async () => {
      const job = await create(),
        key = randomUUID();
      await save(job, payload, 0, key);
      await sql(`delete from public.user_roles where user_id=${q(peer)};`);
      await assert.rejects(get(job, peer, "aal1"), /42501/);
      await sql(
        `insert into public.user_roles(user_id,role) values(${q(peer)},'lecturer');update public.profiles set active=false where id=${q(manager)};`,
      );
      await assert.rejects(get(job, manager), /42501/);
      await assert.rejects(
        save(job, payload, 1, randomUUID(), manager),
        /42501/,
      );
      await sql(
        `update public.profiles set active=false where id=${q(admin)};`,
      );
      await assert.rejects(save(job, payload, 0, key), /42501/);
      await sql(
        `update public.profiles set active=true where id in(${q(admin)},${q(manager)});`,
      );
    },
  );

  await check(
    "Archiving closes edits, permits authorized history and exact old retries, and audit contains flags only",
    async () => {
      const job = await create(),
        key = randomUUID();
      await save(job, payload, 0, key);
      await sql(`update public.jobs set status='archived' where id=${q(job)};`);
      const archived = await get(job);
      assert.equal(archived.can_manage, true);
      assert.equal(archived.can_edit, false);
      await assert.rejects(save(job, payload, 1), /22023/);
      assert.equal((await save(job, payload, 0, key)).version, 1);
      const audit = JSON.parse(
        await sql(
          `select details from public.audit_events where resource_id=${q(job)} and action='job.briefing.saved'`,
        ),
      );
      assert.deepEqual(Object.keys(audit).sort(), [
        "contact_visibility",
        "has_contact",
        "has_reference",
        "version",
      ]);
      assert(!JSON.stringify(audit).includes(payload.contact_name));
      assert(!JSON.stringify(audit).includes(payload.reference_url));
    },
  );

  await check(
    "Private rows and retry payloads enforce RLS and no direct grants; own job deletion cleans both tables",
    async () => {
      for (const table of ["job_briefings", "job_briefing_requests"]) {
        assert.equal(
          await sql(
            `select relrowsecurity from pg_class where oid=${q("private." + table)}::regclass`,
          ),
          "t",
        );
        for (const role of ["anon", "authenticated"]) {
          for (const right of ["SELECT", "INSERT", "UPDATE", "DELETE"])
            assert.equal(
              await sql(
                `select has_table_privilege(${q(role)},${q("private." + table)},${q(right)})`,
              ),
              "f",
            );
        }
        await assert.rejects(
          actor(admin, `select * from private.${table}`, "aal1"),
          /42501/,
        );
      }
      for (const signature of [
        "public.job_briefing(uuid)",
        "private.job_briefing(uuid)",
        "public.save_job_briefing(uuid,integer,uuid,jsonb)",
        "private.save_job_briefing(uuid,integer,uuid,jsonb)",
      ]) {
        assert.equal(
          await sql(
            `select has_function_privilege('anon',${q(signature)},'EXECUTE')`,
          ),
          "f",
        );
      }
      const job = await create("draft");
      await save(job, payload);
      await sql(
        `delete from public.job_sessions where job_id=${q(job)};delete from public.job_requirements where job_id=${q(job)};delete from public.jobs where id=${q(job)};`,
      );
      assert.equal(
        await sql(
          `select count(*) from private.job_briefings where job_id=${q(job)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select count(*) from private.job_briefing_requests where job_id=${q(job)}`,
        ),
        "0",
      );
    },
  );
});
console.log(
  `\n${checks} job briefing PostgreSQL checks passed (optional references, contact release/revocation, concurrency, retry identity and immutable commercial history).`,
);
