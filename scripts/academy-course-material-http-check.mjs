/** WL-T21 rehearsal with real local Auth, SQL, Edge, Storage and ClamAV. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q } from "./testing/database.mjs";

const [edition, release] = process.argv.slice(2);
assert.ok(
  ["customer-self-hosted", "customer-managed"].includes(edition) &&
    /^[a-f0-9]{40}$/.test(release ?? ""),
  "Usage: node scripts/academy-course-material-http-check.mjs EDITION RELEASE_SHA",
);
assert.equal(process.env.PORTAL_TEST_MODE, "1", "Disposable rehearsal only.");
const config = readFileSync("supabase/config.toml", "utf8");
const project =
  /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]{8})"$/m.exec(config)?.[1];
assert.ok(project, "Only a random local test project may be rehearsed.");
const port = /^\[api\][\s\S]*?^port\s*=\s*(\d+)$/m.exec(config)?.[1];
const origin = /^site_url\s*=\s*"(http:\/\/127\.0\.0\.1:\d+)"$/m.exec(
  config,
)?.[1];
assert.ok(
  port && origin,
  "The isolated API and application origin must be configured.",
);

// Credentials come only from the matching CLI-managed local stack. Never echo them.
const cli = "./node_modules/.bin/supabase";
const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = JSON.parse(
  execFileSync(cli, ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }),
);
const base = `http://127.0.0.1:${port}`;
assert.equal(API_URL, base);
const make = (key) =>
  createClient(base, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
const service = make(SERVICE_ROLE_KEY);
const sql = (statement) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-XqAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statement, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  ).trim();

const installation = randomUUID();
const now = Date.now();
const day = (days) => new Date(now + days * 86_400_000).toISOString();
const terms = {
  installation_id: installation,
  edition,
  release_commit: release,
  issued_at: day(-2),
  starts_at: day(-1),
  expires_at: day(2),
  grace_until: day(3),
  modules: ["lms"],
  limits: {
    seat_count: 10,
    storage_bytes: 20_000_000,
    api_requests_per_minute: 60,
  },
};
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
await prepareAcademyInstallation(
  {
    envelope: signAcademyLicence(terms, privateKey),
    publicKey,
    expected: terms,
    now,
  },
  sql,
);
sql(
  `select private.configure_academy_course_access(${q(installation)},${q(release)},true)`,
);

async function actor(label, role) {
  const email = `fictional-${label}-${randomUUID()}@example.invalid`;
  const password = `A!9a-${randomUUID()}`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  assert.equal(created.error, null, "Create a local fictional account");
  const id = created.data.user.id;
  sql(
    `insert into public.user_roles(user_id,role) values (${q(id)},${q(role)})`,
  );
  const signed = await make(ANON_KEY).auth.signInWithPassword({
    email,
    password,
  });
  assert.equal(signed.error, null, "Sign in through real local Auth");
  return { id, token: signed.data.session.access_token };
}

async function request(path, who, body, method = "POST") {
  return fetch(base + path, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(35_000),
    headers: {
      Origin: origin,
      apikey: ANON_KEY,
      ...(who ? { Authorization: `Bearer ${who.token}` } : {}),
      ...(body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
    },
    body: body instanceof FormData ? body : JSON.stringify(body),
  });
}

async function json(response, status, error) {
  const contentType = response.headers.get("content-type") ?? "";
  assert.match(contentType, /application\/json/);
  const result = await response.json();
  const code = result.error ?? result.code;
  assert.equal(
    response.status,
    status,
    "Unexpected Academy HTTP status" +
      (typeof code === "string" && /^[a-z0-9_]{1,40}$/i.test(code)
        ? ` (${code})`
        : ""),
  );
  if (error) assert.equal(result.error, error);
  return result;
}

const admin = await actor("administrator", "admin");
const teacher = await actor("teacher", "lecturer");
const learner = await actor("learner", "participant");
const outside = await actor("outside", "participant");
const [organisation, template, run, consent] = Array.from(
  { length: 4 },
  randomUUID,
);
sql(`
  insert into public.organisations(id,name) values (${q(organisation)},'Fictional Academy');
  insert into public.course_templates(id,title) values(${q(template)},'Fictional Workshop');
  insert into public.course_runs(id,template_id,organisation_id)
    values (${q(run)},${q(template)},${q(organisation)});
  insert into public.course_sessions(course_run_id,starts_at,ends_at)
    values (${q(run)},now()+interval '1 day',now()+interval '25 hours');
  insert into private.company_participant_link_requests
    (id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
    select ${q(consent)},${q(organisation)},${q(admin.id)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
    from public.profiles where id=${q(learner.id)};
  insert into private.company_participant_memberships
    (organisation_id,user_id,status,link_request_id,invited_by,joined_at)
    values (${q(organisation)},${q(learner.id)},'active',${q(consent)},${q(admin.id)},now());
  insert into public.course_enrolments(course_run_id,user_id,enrolled_by,status)
    values (${q(run)},${q(learner.id)},${q(admin.id)},'enrolled');
`);
const assignment = await request(
  "/rest/v1/rpc/academy_assign_course_instructor",
  admin,
  {
    p_course_id: run,
    p_instructor_id: teacher.id,
    p_request_id: randomUUID(),
  },
);
assert.equal((await json(assignment, 200)).status, "confirmed");

const file = "/functions/v1/files?mode=academy-material";
const bytes = Buffer.from(
  "Fictional Academy worksheet — scan and exact delivery.\n",
);
function upload(who, body, clientId = randomUUID()) {
  const form = new FormData();
  form.set("academy_course_id", run);
  form.set("client_id", clientId);
  form.set(
    "file",
    new File([body], "Fictional-workshop.txt", { type: "text/plain" }),
  );
  return request(file, who, form);
}
const requestId = randomUUID();
await json(await upload(outside, bytes), 403, "upload_not_allowed");
await json(
  await upload(teacher, Buffer.alloc(10 * 1024 * 1024 + 1, 97)),
  413,
  "file_size",
);
const initial = await json(await upload(teacher, bytes, requestId), 200);
const document = initial.document;
assert.equal(document.status, "clean");
assert.deepEqual(
  await json(await upload(teacher, bytes, requestId), 200),
  initial,
);
await json(
  await upload(teacher, Buffer.from("Different worksheet\n"), requestId),
  409,
  "idempotency_conflict",
);

const digest = createHash("sha256").update(bytes).digest("hex");
const provenance = JSON.parse(
  sql(`
  select jsonb_build_object('document',document_id,'status',status,'sha256',sha256,
    'scanner',scanner_version,'path',object_path)
  from public.document_versions where id=${q(document.current_version_id)}
`),
);
assert.equal(provenance.document, document.id);
assert.equal(provenance.status, "clean");
assert.equal(provenance.sha256, digest);
assert.match(provenance.scanner, /^ClamAV /);

const publish = () =>
  request("/rest/v1/rpc/academy_course_material_action", teacher, {
    p_run_id: run,
    p_action: "resource_share",
    p_id: document.current_version_id,
    p_audience: "participants",
    p_category: "material",
  });
const [firstPublish, secondPublish] = await Promise.all([publish(), publish()]);
const resource = await json(firstPublish, 200);
assert.deepEqual(await json(secondPublish, 200), resource);
const download = (who) =>
  request("/functions/v1/course-documents", who, {
    kind: "resource",
    id: resource.id,
  });
await json(await download(null), 401, "authentication_required");
await json(await download(outside), 403, "document_unavailable");
const delivered = await download(learner);
assert.equal(delivered.status, 200);
assert.match(delivered.headers.get("cache-control"), /no-store/);
assert.match(delivered.headers.get("content-disposition"), /^attachment;/);
assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), bytes);
const publicObject = await fetch(
  base + "/storage/v1/object/portal-clean/" + provenance.path,
  {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${learner.token}` },
    signal: AbortSignal.timeout(10_000),
  },
);
assert.ok(
  [400, 401, 403, 404].includes(publicObject.status),
  `Expected an access denial from raw Storage, received HTTP ${publicObject.status}`,
);
await publicObject.body?.cancel();
// The operator can access Storage in this disposable stack. Corrupting only
// the fixture proves the Edge response fails closed even with a clean receipt.
const replaced = await service.storage
  .from("portal-clean")
  .update(provenance.path, Buffer.from("Fictional wrong version."), {
    contentType: "text/plain",
  });
assert.equal(
  replaced.error,
  null,
  "Replace only the disposable fixture object",
);
await json(await download(learner), 503, "document_integrity_failed");

const withdrawn = await request(
  "/rest/v1/rpc/academy_course_material_action",
  teacher,
  {
    p_run_id: run,
    p_action: "resource_remove",
    p_id: resource.id,
  },
);
assert.equal(withdrawn.status, 200);
await json(await download(learner), 403, "document_unavailable");
console.log(
  JSON.stringify({
    edition,
    release,
    sha256: digest,
    raw_storage_status: publicObject.status,
    checks: [
      "clamav_clean",
      "exact_http_bytes",
      "same_request_retry",
      "different_bytes_conflict",
      "size_limit",
      "concurrent_publication",
      "signed_out_denied",
      "outside_course_denied",
      "raw_storage_denied",
      "altered_storage_denied",
      "same_token_revoked",
    ],
  }),
);
