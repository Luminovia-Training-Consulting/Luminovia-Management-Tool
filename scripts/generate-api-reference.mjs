/**
 * Generates API references from real replayed PostgreSQL migrations.
 * Documented signatures and grants come from the temporary database catalogue.
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { format } from "prettier";
import { withTestDatabase } from "./testing/database.mjs";
await withTestDatabase("api_reference", async ({ sql }) => {
  const rows = JSON.parse(
    await sql(
      `select jsonb_agg(jsonb_build_object('name',p.proname,'args',pg_get_function_arguments(p.oid),'result',pg_get_function_result(p.oid),'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),'anon',has_function_privilege('anon',p.oid,'EXECUTE'),'service',has_function_privilege('service_role',p.oid,'EXECUTE'),'definer',p.prosecdef) order by p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')`,
    ),
  );
  const migrations = (
    await readdir(new URL("supabase/migrations/", import.meta.url))
  )
    .filter((name) => name.endsWith(".sql"))
    .sort();
  // Bind the inventory to actual source bytes without republishing historical customer filenames.
  const sources = await Promise.all(
    migrations.map(async (name) => ({
      version: name.slice(0, 14),
      sha256: createHash("sha256")
        .update(
          await readFile(
            new URL(`supabase/migrations/${name}`, import.meta.url),
          ),
        )
        .digest("hex"),
    })),
  );
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(sources))
    .digest("hex");
  // Defaults are PostgreSQL expressions; escape table delimiters rather than changing signatures.
  const cell = (value) =>
    String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  const grant = (row) =>
    [
      row.authenticated && "authenticated",
      row.anon && "anon",
      row.service && "service_role",
    ]
      .filter(Boolean)
      .join(", ") || "No listed API role";
  const text = `# Platform API reference

This reference describes the current repository API. It is generated from a disposable replay of **${migrations.length} migration files** through version **${sources.at(-1).version}**, containing **${rows.length} application public functions**. It excludes extension-owned functions. Source fingerprint (SHA-256 of the ordered JSON version/source-hash list): \`${fingerprint}\`.

Regenerate with \`PORTAL_DB_CONTAINER=<owned-test-container> node scripts/generate-api-reference.mjs\`. The generator creates and drops a random database; it never inspects user records. Use an owned isolated test container, following [local development](DEVELOPMENT.md#section-local-development). Replay uses SQL Auth helpers, so this inventory alone does not verify native Auth, HTTP gateway availability, business eligibility or deployment. [Functional acceptance](DEVELOPMENT.md#section-functional-acceptance) and [QA results](DEVELOPMENT.md#section-test-plan) define that evidence.

## Base URLs and authentication

Paths below are relative to the configured Supabase API URL, not necessarily the website origin. Local development normally uses \`http://127.0.0.1:54321\`; a selfhost gateway can expose the API beneath \`/backend\`. Read \`VITE_SUPABASE_URL\` from the approved environment rather than hard-coding a deployment hostname.

Use Supabase Auth for invitation-only login, recovery, sessions, password/email changes and TOTP. Public signup is disabled. Authenticated API requests carry the public \`apikey\` and \`Authorization: Bearer <user-access-token>\`. Service-role keys are server-only. Database roles, active status, current resource membership and required MFA remain authoritative on every operation; neither user metadata nor a submitted user ID grants access.

## Account HTTP facade

Base: \`/functions/v1/accounts/v1\`. Machine-readable OpenAPI: \`/functions/v1/accounts/openapi.json\`; owning contract: [openapi.ts](supabase/functions/accounts/openapi.ts), enforced by [handler.ts](supabase/functions/accounts/handler.ts).

| Method | Path relative to facade base | Purpose |
| --- | --- | --- |
| GET, PATCH | /me | Own identity, roles, capabilities and safe profile edits |
| GET | /users?q=&limit=&offset= | MFA-authorised bounded account directory |
| GET | /roles | Current role catalogue and assignability |
| PUT | /users/{id}/roles | Audited subordinate-role assignment |
| PATCH | /users/{id}/status | Reversible suspension/reactivation |
| PUT, DELETE | /users/{id}/organisations/{organisationId} | Administration-only scoped client membership |
| POST | /invitations | Durable, role-bound idempotent invitation |
| GET | /deletions/access, /deletions/resources, /deletions/operations | Current permitted targets and incomplete operation recovery |
| POST | /deletions/preview | Reviewed target, scope counts and dependency blockers |
| POST | /deletions/confirm | Explicit irreversible DELETE confirmation with actor-bound plan/request IDs |
| POST | /deletions/operations/{id} | Resume native cleanup; 202 means pending, 200 means completed |

The facade permits allowlisted browser Origins; authenticated non-browser clients may omit Origin. This exception does **not** apply to all Edge Functions: files and course-documents require an exact approved Origin. The account handler returns safe errors and checks request bodies before forwarding caller-scoped RPCs. Self/equal/higher/last-admin protections apply where relevant. A send timeout retains its invitation reservation for reconciliation; it does not imply delivery or authorise an automatic resend.

## Permanent deletion

Permanent deletion requires current AAL2 and live resource authority. Preview and confirmation recheck actor-bound dependencies; accepted financial references and private-resource ACLs remain authoritative. The account Edge facade uses a database-issued execution permit for exact all-version native Storage cleanup and Auth hard deletion, drains active writer leases and returns completed only after verified absence. Pending receipts survive reload through the own permitted operations projection. Company jobs require consistent current organisation links; former lecturer claims do not grant staff job/file access. No trash or restore is provided. Read [the deletion contract](GUIDE.md#section-permanent-deletion).

## Integration-only website enquiries

\`POST /functions/v1/website-enquiries\` is an explicitly configured server-to-server intake, separate from the bearer-authenticated management facade. The normal gateway public-key/JWT boundary remains enabled; the function additionally requires a private \`X-Luminovia-Integration-Token\` header. Never embed that credential in a browser bundle, public Website or \`VITE_\` variable. The feature starts disabled; reviewed private token, exact Website origin and privacy-notice version are required to enable it. It issues no CORS permission. Server calls may omit Origin; an Origin that is present must exactly match the configured value.

The closed JSON payload contains a stable \`submission_id\` UUID, bounded company/contact/email/topic/message/preferences fields, recognised IANA time zone, \`de\`/\`en\` locale, the configured \`privacy_notice_version\` and literal \`consent: true\`. Actual streamed bodies are limited to 24,000 bytes. Only a confirmed durable database result returns \`202 {"received":true,"receipt":"<submission-id>"}\`; no internal enquiry or customer ID is exposed. Identical retries return the original receipt; changed retries return 409. Persistent sender limits reject new submissions over 10 per minute or 100 per rolling day.

Management uses current MFA-protected \`enquiry_context\`, \`enquiry_inbox\`, \`enquiry_detail\` and versioned decision/conversion RPCs from the inventory below. Read [WEBSITE_ENQUIRIES](GUIDE.md#section-website-enquiries) and the [deployed handler](supabase/functions/website-enquiries/handler.ts) for exact fields, error envelopes, permissions and public-activation prerequisites. Source presence does not connect or publish the public Website.

## Native RPC use

Send \`POST /rest/v1/rpc/{name}\` with a JSON object whose keys match the parameter names below, or call \`supabase.rpc(name, args)\`. Defaults are shown as SQL expressions; omit optional JSON keys to use them. SQL \`NULL\` corresponds to JSON \`null\`. UUIDs and instants are JSON strings; arrays are JSON arrays. \`jsonb\` payload validation is defined by the owning migration/feature contract, not inferred from the SQL type. PostgREST returns structured errors; Edge Functions use their own safe error envelopes. Do not treat every 2xx response as a business confirmation: claim RPCs return semantic outcomes such as filled, conflict or terms-changed inside their result.

Example (existing authorised job and reviewed current quote required):

\`\`\`ts
const { data, error } = await supabase.rpc("claim_job", {
  p_job_id: selectedJobId,
  p_idempotency_key: operationId,
  p_terms_version: reviewedTermsVersion,
});
if (error) throw error;
// Inspect the returned status before showing confirmed allocation.
\`\`\`

Keep a retry's operation UUID and reviewed payload stable. Version/cursor conflicts require a fresh authorised read and renewed consent where applicable. Accepted rates, currencies, contract versions and session snapshots are immutable. Monetary values remain in their original currency. See [job lifecycle](GUIDE.md#section-job-lifecycle), [role-specific pricing](GUIDE.md#section-delegated-roles-pricing) and [discovery](GUIDE.md#section-job-discovery).

## Replayed public function inventory

The grants column reports effective PostgreSQL EXECUTE privileges for the three listed API roles, including inherited PUBLIC grants. It is **not** a permission grant to the current person and does not describe gateway routing. Private implementations are intentionally excluded. Application wrappers remain security-invoker; trusted server-only routines still require reviewed callers. SQL return types describe database shape; resource-specific JSON fields and error codes belong to the owning feature/migration.

| RPC | Parameters, SQL types and defaults | SQL result | Effective EXECUTE roles | Security |
| --- | --- | --- | --- | --- |
${rows.map((row) => `| ${cell(row.name)} | ${cell(row.args || "none")} | ${cell(row.result)} | ${grant(row)} | ${row.definer ? "DEFINER" : "INVOKER"} |`).join("\n")}

## Files and printable documents

All private responses use no-store semantics and current resource checks. IDs are selectors, never access tokens. The [files gateway](supabase/functions/files/index.ts) accepts \`POST /functions/v1/files\` with an approved Origin and bearer JWT:

- Multipart upload: \`file\`, \`client_id\`, optional \`scope\`, \`kind\`, \`room_id\`, \`job_id\`, \`replace_id\` and \`owner_id\`. RPCs validate targets, rights, quotas and retry identity. Actual byte validation, quarantine and successful scanning precede clean availability.
- JSON exact-version download: \`{ "action": "download", "id": "<document-id>", "version_id": "<version-id>" }\`; omitting \`version_id\` selects the current version. Rights are rechecked around private Storage reads.
- Avatar: \`{ "action": "avatar", "user_id": "<profile-id>" }\` returns only the current permitted clean selection.
- Qualification evidence: \`{ "action": "qualification_evidence_download", "evidence_id": "<evidence-id>" }\` uses its separate exact-version grant.

\`POST /functions/v1/course-documents\` serves authorised course/client resources and renders attendance/completion documents, assignment confirmations, earnings statements and own qualification passports. Its closed, kind-specific JSON inputs and permission recheck are defined in [the handler](supabase/functions/course-documents/handler.ts), with workflows in [course workspace](GUIDE.md#section-course-learning-workspace), [finance](GUIDE.md#section-timesheets-finance-control-center) and [qualification passport](GUIDE.md#section-qualification-passport). These PDFs do not assert a legal signature or professional certification.

## Calendar feeds, source revisions and privacy

\`GET /functions/v1/calendar-feed?token=<private-token>\` is a distinct token-authorised iCalendar subscription, not a bearer-authenticated account endpoint. The high-entropy secret grants the selected private feed; store/share it accordingly. SQL stores its hash and the gateway repeats revocation checks. [Calendar connections](GUIDE.md#section-calendar-connections) owns scope, expiry and revocation details.

Course-run job publication binds a trusted source revision and exact session references; stale previews reject rather than silently changing the teaching block. [Course building blocks](GUIDE.md#section-course-building-blocks) and [staff comments](GUIDE.md#section-resource-comments) explain their separate resource rights. Client or learner access does not grant staff discussion access. [Architecture](DEVELOPMENT.md#section-architecture) records the explicit opt-in minimal own offline teaching snapshot; generic authenticated responses and private file bytes are not cached offline.
`;
  // Use the pinned repository formatter so regeneration reproduces the committed bytes.
  await writeFile(
    "API_REFERENCE.md",
    await format(text, { parser: "markdown" }),
  );
  console.log(
    `Generated authenticated API reference from ${rows.length} migrated public functions; no user data or credentials included.`,
  );
});
