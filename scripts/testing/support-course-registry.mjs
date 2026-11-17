/** Shared real PostgreSQL tests for exclusive support/course document registry
 * ownership. Synthetic registry mode tests only the clearly labelled optional
 * version_id contract; real mode invokes the installed course RPC/file gateway.
 * Rows represent fictional scanner output, not actual Storage/Auth acceptance.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { quoteSql as q } from "./database.mjs";

/** Hold one owned transaction until explicitly released after pg_blocking_pids
 * proves which statement is waiting. A readiness marker identifies its backend.
 */
async function hold(fixture, body) {
  const marker = "support_course_gate_" + randomUUID().replaceAll("-", "");
  const child = spawn(
    "docker",
    [
      "exec",
      "-i",
      fixture.container,
      "psql",
      "-U",
      "postgres",
      "-d",
      fixture.database,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "",
    error = "",
    released = false;
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolve()
        : reject(Error(error || "Owned support/course transaction failed")),
    );
  });
  void closed.catch(() => {});
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Owned support/course transaction not ready")),
      10000,
    );
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const line = output
        .split("\n")
        .find((value) => value.startsWith(marker + ":"));
      if (line) {
        clearTimeout(timer);
        resolve(Number(line.slice(marker.length + 1)));
      }
    });
    child.stderr.on("data", (chunk) => (error += chunk));
    child.once("error", (reason) => {
      clearTimeout(timer);
      reject(reason);
    });
    child.once("close", () => {
      clearTimeout(timer);
      reject(
        Error(
          error || "Owned support/course transaction ended before readiness",
        ),
      );
    });
  });
  child.stdin.write(
    `begin;${body};select ${q(marker + ":")}||pg_backend_pid();\n`,
  );
  const pid = await ready;
  return {
    pid,
    finish: async () => {
      if (!released) {
        released = true;
        child.stdin.end("commit;\n\\q\n");
      }
      await closed;
    },
  };
}
/** Require a specific held backend, not a timing guess or unrelated lock wait. */
async function waitBlocked(sql, identifier, holderPid) {
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    if (
      (await sql(
        `select exists(select 1 from pg_stat_activity where datname=current_database()and pid<>pg_backend_pid()and position(${q(identifier)}in query)>0 and ${holderPid}=any(pg_blocking_pids(pid)))`,
      )) === "t"
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw Error("Expected support/course document wait was never observed");
}
/** Model the same authenticated SQL GUCs used by the common isolated fixture. */
function authenticated(user, body) {
  return `set local role authenticated;set local request.jwt.claims=${q(JSON.stringify({ sub: user, aal: "aal1", role: "authenticated" }))};${body}`;
}

/** Verify exact signatures, owner-only grants, fixed search paths and actual
 * strict diagnostics. Trigger checks use the installed optional registry row type.
 */
export async function assertSupportCourseGuards(sql, { registry }) {
  const helper = "private.support_document_has_course_reference(uuid)",
    guard = "private.support_course_resource_guard()";
  for (const signature of [helper, guard]) {
    const raw = await sql(
      `select jsonb_build_object('definer',prosecdef,'search_path',coalesce('search_path=""'=any(proconfig),false),'result',pg_get_function_result(oid))from pg_proc where oid=to_regprocedure(${q(signature)})`,
    );
    assert.ok(raw, "Missing required support registry helper: " + signature);
    const facts = JSON.parse(raw);
    assert.equal(facts.definer, true);
    assert.equal(facts.search_path, true);
    assert.equal(facts.result, signature === helper ? "boolean" : "trigger");
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        await sql(
          `select has_function_privilege(${q(role)},${q(signature)},'EXECUTE')`,
        ),
        "f",
      );
  }
  await sql(
    "create extension if not exists plpgsql_check with schema extensions",
  );
  assert.deepEqual(
    JSON.parse(
      await sql(
        `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)from extensions.plpgsql_check_function_tb(${q(helper)}::regprocedure)t`,
      ),
    ),
    [],
  );
  if (registry) {
    assert.equal(
      await sql(
        `select count(*)from pg_trigger where tgrelid='private.course_resources'::regclass and not tgisinternal and tgfoid=${q(guard)}::regprocedure and(tgtype::int&23)=23 and tgattr::text=(select attnum::text from pg_attribute where attrelid='private.course_resources'::regclass and attname='version_id')`,
      ),
      "1",
    );
    assert.deepEqual(
      JSON.parse(
        await sql(
          `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)from extensions.plpgsql_check_function_tb(${q(guard)}::regprocedure,'private.course_resources'::regclass)t`,
        ),
      ),
      [],
    );
  }
}

/** Create fictional requesters/uploader and exact clean version metadata. */
async function fixtureActors({ sql, actor }) {
  const manager = randomUUID(),
    learner = randomUUID(),
    outsider = randomUUID();
  await sql(
    `insert into auth.users(id,email)values${[manager, learner, outsider].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};insert into public.user_roles(user_id,role)values(${q(manager)},'admin'),(${q(learner)},'participant'),(${q(outsider)},'participant');update public.profiles set display_name='Fictional registry actor';`,
  );
  /** Each support ticket belongs to the learner; an internal manager upload must
   * never reach them through a separate course-sharing registry.
   */
  const ticket = () =>
    actor(
      learner,
      `select public.create_support_ticket(${q(JSON.stringify({ title: "Fictional support registry question", category: "documents", description: "Fictional internal evidence must stay dedicated" }))},${q(randomUUID())})`,
    );
  /** Construct only scanner-result rows; do not claim that physical bytes exist. */
  const file = async () => {
    const document = randomUUID(),
      version = randomUUID(),
      path = manager + "/" + document + "/" + version;
    await sql(
      `insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)values(${q(document)},${q(manager)},${q(manager)},'personal','material','Fictional internal registry evidence.txt','text/plain',12,'clean',${q(randomUUID())});insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)values(${q(version)},${q(document)},${q(manager)},${q(randomUUID())},1,${q(path)},'Fictional internal registry evidence.txt','text/plain',12,'clean',repeat('a',64));update public.documents set current_version_id=${q(version)}where id=${q(document)}`,
    );
    return { document, version, path };
  };
  /** Exact support action used by both ordinary and held transactions. */
  const attachSql = (ticketId, item, key = randomUUID()) =>
    `select public.update_support_ticket(${q(ticketId)},'attach',${q(JSON.stringify({ document_id: item.document, internal: true }))},1,${q(key)})`;
  const attach = (ticketId, item, key = randomUUID()) =>
    actor(manager, attachSql(ticketId, item, key), "aal1");
  /** Recheck both rows used by the generic authenticated file gateway. */
  const hidden = async (item) => {
    for (const who of [learner, outsider]) {
      assert.equal(
        await actor(
          who,
          `select count(*)from public.documents where id=${q(item.document)}`,
        ),
        "0",
      );
      assert.equal(
        await actor(
          who,
          `select count(*)from public.document_versions where id=${q(item.version)}`,
        ),
        "0",
      );
    }
  };
  return {
    manager,
    learner,
    outsider,
    ticket,
    file,
    attachSql,
    attach,
    hidden,
  };
}

/** No optional registry is installed: helper returns false and ordinary private
 * attachment creation is still usable, with effective helper grants checked.
 */
export async function runSupportCourseAbsenceChecks(fixture) {
  const { sql, actor } = fixture;
  assert.equal(
    await sql("select to_regclass('private.course_resources')is null"),
    "t",
  );
  await assertSupportCourseGuards(sql, { registry: false });
  assert.equal(
    await sql(
      `select private.support_document_has_course_reference(${q(randomUUID())})`,
    ),
    "f",
  );
  const f = await fixtureActors(fixture),
    item = await f.file(),
    ticket = await f.ticket();
  await f.attach(ticket, item);
  await f.hidden(item);
  assert.equal(
    await actor(
      f.manager,
      `select private.can_access_document(${q(item.document)})`,
      "aal1",
    ),
    "t",
  );
  assert.equal(
    await actor(
      f.manager,
      `select private.can_access_document(${q(item.document)})`,
    ),
    "t",
  );
  assert.equal(
    JSON.parse(
      await actor(f.learner, `select public.support_ticket(${q(ticket)})`),
    ).attachments.length,
    0,
  );
  console.log(
    "PASS absent optional course registry: exact helpers/grants/strict body, false lookup, usable internal support attachment and requester/file denial",
  );
}

/** Both registration orders and controlled concurrent wins must remain
 * mutually exclusive. Actual course mode also exercises its independent gateway.
 */
export async function runSupportCourseRegistryChecks(
  fixture,
  { label, requireRealCourse = false },
) {
  const { sql, actor } = fixture;
  const real =
    (await sql(
      "select to_regprocedure('public.course_workspace_action(uuid,text,jsonb,integer)')is not null and to_regprocedure('public.course_document_access(text,uuid)')is not null",
    )) === "t";
  if (requireRealCourse)
    assert.equal(
      real,
      true,
      "Pinned PR17 prerequisite missing: actual public course action/document RPCs required",
    );
  assert.equal(
    await sql("select to_regclass('private.course_resources')is not null"),
    "t",
    "A real or explicitly synthetic optional registry is required",
  );
  await assertSupportCourseGuards(sql, { registry: true });
  let groups = 1;
  console.log(
    `PASS ${label}: exact owner-only signatures, INSERT/UPDATE-OF hook and zero strict function/trigger diagnostics`,
  );
  const f = await fixtureActors(fixture);
  let run;
  if (real) {
    const payload = {
      title: "Fictional isolated course registry",
      customer_name: "Fictional registry academy",
      delivery_type: "online",
      location: "https://example.invalid/registry",
      time_zone: "UTC",
      status: "published",
      amount: 100,
      total_amount: 200,
      currency: "EUR",
      rate_unit: "per_day",
      terms: "Fictional immutable course terms",
      requires_contract: false,
      sessions: [1, 2].map((day) => ({
        starts_at: `2068-01-0${day}T08:00:00Z`,
        ends_at: `2068-01-0${day}T09:00:00Z`,
      })),
    };
    const job = await actor(
      f.manager,
      `select public.create_job(${q(JSON.stringify(payload))})`,
      "aal1",
    );
    run = await sql(`select course_run_id from public.jobs where id=${q(job)}`);
    await actor(
      f.manager,
      `select public.manage_course_enrolment(${q(run)},${q(f.learner)},'enrolled')`,
      "aal1",
    );
  }
  /** Use installed public APIs when available; synthetic mode has no invented
   * public API and performs only labelled private registry contract writes.
   */
  const shareSql = (item, tag = "") =>
    real
      ? `/*${tag}*/select public.course_workspace_action(${q(run)},'resource_share',${q(JSON.stringify({ version_id: item.version, audience: "participants", category: "material" }))},0)`
      : `/*${tag}*/insert into private.course_resources(version_id)values(${q(item.version)})returning jsonb_build_object('id',id)`;
  const share = async (item, tag = "") =>
    JSON.parse(
      real
        ? await actor(f.manager, shareSql(item, tag), "aal1")
        : await sql(shareSql(item, tag)),
    ).id;
  const remove = async (id) =>
    real
      ? actor(
          f.manager,
          `select public.course_workspace_action(${q(run)},'resource_remove',${q(JSON.stringify({ id }))},0)`,
          "aal1",
        )
      : sql(
          `update private.course_resources set removed_at=clock_timestamp()where id=${q(id)}`,
        );
  /** Prove independent resource access exists rather than relying on ordinary
   * personal-document denial to disguise the cross-registry security boundary.
   */
  const gateway = async (id, item, allowed) => {
    if (!real) return;
    if (allowed) {
      const record = JSON.parse(
        await actor(
          f.learner,
          `select public.course_document_access('resource',${q(id)})`,
        ),
      );
      assert.equal(record.id, item.version);
      assert.equal(record.document_id, item.document);
      assert.equal(record.object_path, item.path);
      await assert.rejects(
        actor(
          f.outsider,
          `select public.course_document_access('resource',${q(id)})`,
        ),
        /42501/,
      );
    } else
      await assert.rejects(
        actor(
          f.learner,
          `select public.course_document_access('resource',${q(id)})`,
        ),
        /42501/,
      );
  };
  const check = async (name, body) => {
    await body();
    groups++;
    console.log(`PASS ${label}: ${name}`);
  };
  await check(
    "course-first live reference refuses internal support dedication without changing either record",
    async () => {
      const item = await f.file(),
        ticket = await f.ticket(),
        id = await share(item);
      await f.hidden(item);
      await gateway(id, item, true);
      await assert.rejects(f.attach(ticket, item), /42501/);
      assert.equal(
        await sql(
          `select count(*)from private.support_attachments where document_id=${q(item.document)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select version from private.support_tickets where id=${q(ticket)}`,
        ),
        "1",
      );
      await gateway(id, item, true);
    },
  );
  await check(
    "removed course history still refuses support dedication" +
      (real ? "; installed gateway revokes the removed resource" : ""),
    async () => {
      const item = await f.file(),
        ticket = await f.ticket(),
        id = await share(item);
      await remove(id);
      await gateway(id, item, false);
      assert.equal(
        await sql(
          `select private.support_document_has_course_reference(${q(item.document)})`,
        ),
        "t",
      );
      await assert.rejects(f.attach(ticket, item), /42501/);
      assert.equal(
        await sql(
          `select count(*)from private.course_resources where version_id=${q(item.version)}and removed_at is not null`,
        ),
        "1",
      );
    },
  );
  await check(
    "support-first refuses course INSERT and version UPDATE; original safe resource remains unchanged",
    async () => {
      const item = await f.file(),
        ticket = await f.ticket();
      await f.attach(ticket, item);
      await f.hidden(item);
      await assert.rejects(share(item), /42501/);
      const safe = await f.file(),
        id = await share(safe);
      await assert.rejects(
        sql(
          `update private.course_resources set version_id=${q(item.version)}where id=${q(id)}`,
        ),
        /42501/,
      );
      assert.equal(
        await sql(
          `select version_id from private.course_resources where id=${q(id)}`,
        ),
        safe.version,
      );
      assert.equal(
        await sql(
          `select count(*)from private.course_resources where version_id=${q(item.version)}`,
        ),
        "0",
      );
      await gateway(id, safe, true);
    },
  );
  await check(
    "observed course-first document lock winner makes the waiting support action fail atomically",
    async () => {
      const item = await f.file(),
        ticket = await f.ticket(),
        key = randomUUID();
      const gate = await hold(
        fixture,
        real ? authenticated(f.manager, shareSql(item)) : shareSql(item),
      );
      const pending = f.attach(ticket, item, key);
      void pending.catch(() => {});
      try {
        await waitBlocked(sql, key, gate.pid);
        await gate.finish();
        await assert.rejects(pending, /42501/);
      } finally {
        await gate.finish();
      }
      assert.equal(
        await sql(
          `select count(*)from private.support_attachments where document_id=${q(item.document)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select version from private.support_tickets where id=${q(ticket)}`,
        ),
        "1",
      );
      const id = await sql(
        `select id from private.course_resources where version_id=${q(item.version)}`,
      );
      assert.ok(id);
      await gateway(id, item, true);
    },
  );
  await check(
    "observed support-first document lock winner makes the waiting course action fail atomically",
    async () => {
      const item = await f.file(),
        ticket = await f.ticket(),
        tag = randomUUID();
      const gate = await hold(
        fixture,
        authenticated(f.manager, f.attachSql(ticket, item)),
      );
      const pending = share(item, tag);
      void pending.catch(() => {});
      try {
        await waitBlocked(sql, tag, gate.pid);
        await gate.finish();
        await assert.rejects(pending, /42501/);
      } finally {
        await gate.finish();
      }
      assert.equal(
        await sql(
          `select count(*)from private.course_resources where version_id=${q(item.version)}`,
        ),
        "0",
      );
      assert.equal(
        await sql(
          `select version from private.support_tickets where id=${q(ticket)}`,
        ),
        "2",
      );
      assert.equal(
        await sql(
          `select count(*)from private.support_attachments where document_id=${q(item.document)}and internal`,
        ),
        "1",
      );
      await f.hidden(item);
    },
  );
  console.log(
    `PASS ${label}: ${groups} SQL registry groups; ${real ? "installed public resource_share/resource_remove/course_document_access exercised" : "synthetic private registry contract only; no course RPC/Storage/Auth claim"}`,
  );
  return { groups, real };
}
