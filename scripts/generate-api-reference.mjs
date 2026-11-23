/**
 * Generates API references from real replayed PostgreSQL migrations.
 * Documented signatures and grants come from the temporary database catalogue.
 */
import {readdir, readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {format} from "prettier";
import ts from "typescript";
import {withTestDatabase} from "./testing/database.mjs";

/** Load the actual published account contract without maintaining a second route list. */
async function accountOperations() {
    const source = await readFile(
        new URL("../supabase/functions/accounts/openapi.ts", import.meta.url),
        "utf8",
    );
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
    const {accountOpenApi} = await import(
        `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
        );
    return Object.entries(accountOpenApi.paths).flatMap(([path, methods]) =>
        Object.entries(methods).map(([method, operation]) => ({
            method: method.toUpperCase(),
            path: path.replace(/^\/v1/, "") || "/",
            purpose: operation.summary,
        })),
    );
}

await withTestDatabase("api_reference", async ({sql}) => {
    const rows = JSON.parse(
        await sql(
            `select jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_arguments(p.oid), 'result', pg_get_function_result(p.oid), 'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'), 'anon', has_function_privilege('anon', p.oid, 'EXECUTE'), 'service', has_function_privilege('service_role', p.oid, 'EXECUTE'), 'definer', p.prosecdef) order by p.proname, pg_get_function_identity_arguments(p.oid))
             from pg_proc p
                      join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public'
               and p.prokind = 'f'
               and not exists(select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`,
        ),
    );
    const restRows = JSON.parse(
        await sql(`select coalesce(jsonb_agg(jsonb_build_object(
      'name',c.relname,
      'kind',case when c.relkind in ('v','m') then 'view' else 'table' end,
      'rls',c.relrowsecurity,
      'select',has_table_privilege('authenticated',c.oid,'SELECT') or has_any_column_privilege('authenticated',c.oid,'SELECT'),
      'insert',has_table_privilege('authenticated',c.oid,'INSERT') or has_any_column_privilege('authenticated',c.oid,'INSERT'),
      'update',has_table_privilege('authenticated',c.oid,'UPDATE') or has_any_column_privilege('authenticated',c.oid,'UPDATE'),
      'delete',has_table_privilege('authenticated',c.oid,'DELETE'),
      'columns',(select coalesce(jsonb_agg(a.attname order by a.attnum),'[]'::jsonb)
        from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
        and (has_column_privilege('authenticated',c.oid,a.attname,'SELECT')
          or has_column_privilege('authenticated',c.oid,a.attname,'INSERT')
          or has_column_privilege('authenticated',c.oid,a.attname,'UPDATE')))
    ) order by c.relname),'[]'::jsonb)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','v','m')
      and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
      and (has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        or has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE'))`),
    );
    const migrations = (
        await readdir(new URL("../supabase/migrations/", import.meta.url))
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
                        new URL(`../supabase/migrations/${name}`, import.meta.url),
                    ),
                )
                .digest("hex"),
        })),
    );
    const fingerprint = createHash("sha256")
        .update(JSON.stringify(sources))
        .digest("hex");
    const accountRoutes = await accountOperations();
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

This reference describes the current repository API. It is generated from a disposable replay of **${migrations.length} migration files** through version **${sources.at(-1).version}**, containing **${rows.length} application public functions** and **${restRows.length} authenticated REST relations**. It excludes extension-owned functions and relations. Source fingerprint (SHA-256 of the ordered JSON version/source-hash list): \`${fingerprint}\`.

Regenerate with \`PORTAL_DB_CONTAINER=<owned-test-container> node scripts/generate-api-reference.mjs\`. The generator creates and drops a random database; it never inspects user records. Use an owned isolated test container, following [local development](DEVELOPMENT.md#section-local-development). Replay uses SQL Auth helpers, so this inventory alone does not verify native Auth, HTTP gateway availability, business eligibility or deployment. [Functional acceptance](DEVELOPMENT.md#section-functional-acceptance) and [QA results](DEVELOPMENT.md#section-test-plan) define that evidence.

## Base URLs and authentication

Open /api/docs while signed in to browse the OpenAPI contract. The explorer starts with requests disabled. Authorization uses the current account's short-lived access token and the configured publishable key. Copyable Swagger commands omit the injected credentials. Download the document from /api/openapi.json. It includes reviewed HTTP and Premium LMS contracts plus the native RPCs discovered in browser calls and verified against the migrated database. Credential exchange, backend integrations and RPCs that issue secrets or accept mail credentials appear in the download. Use the catalogue below for other native signatures.

The generated schemas describe named arguments, omission of database-defaulted arguments, SQL result types and the REST gate for participant and guest sessions. The Internal OpenAPI adds operation-specific authority, input rules, success forms and error descriptions. Where an old SQL default cannot satisfy current business validation, the contract identifies the parameter callers must supply. To refresh the machine-readable native catalogue, run \`PORTAL_DB_CONTAINER=<owned-test-container> node scripts/native-rpc-catalogue.mjs\` after changing a browser RPC call, argument, result, grant or REST role gate. The isolated API surface check compares the checked-in catalogue with a fresh replay.

Send POST /functions/v1/human-login with JSON fields identifier and password. The identifier may be the existing verified email address or the unique installation-local username. Use the returned access_token for subsequent API calls and protect the refresh_token. Invalid credentials return 401 and exhausted attempt budgets return 429. For password recovery, native Auth accepts the verified email address. The portal also accepts the username and preserves the Supabase SDK's original PKCE verifier. The browser sends the lowercase username, S256 challenge and its allowed /auth/callback URL to POST /functions/v1/human-recovery. A valid request returns 202 while the server handles lookup and email delivery in the background. This acknowledgement does not reveal the account or confirm delivery. Use account_username to read your own alias and version. Call save_account_username with p_username and p_expected_version to change it, or send null to remove it. Usernames are normalized to lowercase, 3–32 ASCII characters, and unique across the installation.

Paths below are relative to the configured Supabase API URL, not necessarily the website origin. Local development normally uses \`http://127.0.0.1:54321\`; a selfhost gateway can expose the API beneath \`/backend\`. Read \`VITE_SUPABASE_URL\` from the approved environment rather than hard-coding a deployment hostname.

Use Supabase Auth for invitation-only password login, recovery, sessions and password/email changes. An installation may stage and require native TOTP for administrators and owners. Protected requests by these accounts require an authenticated AAL2 token backed by its current Auth session and verified TOTP factor. A required authenticator step returns HTTP 412. Password recovery does not satisfy authenticator verification. Authenticated API requests carry the public \`apikey\` and \`Authorization: Bearer <user-access-token>\`. Service-role keys are server-only. Database roles, active status and current resource membership remain authoritative on every operation; neither user metadata nor a submitted user ID grants access.

## HTTP methods for Portal workflows

The Swagger method filter and OpenAPI JSON list the operations available in the current edition. Keep using existing POST /rest/v1/rpc calls for creation and transactional commands such as publishing, claiming and recording a payment. Existing clients can continue using those contracts.

Reviewed HTTP aliases are relative to the configured Supabase API URL:

| Method | Example path | Input |
| --- | --- | --- |
| GET | /functions/v1/portal-api/v1/course_workspace | One optional URL-encoded JSON object named input. Supply the RPC arguments required by the operation. |
| PUT | /functions/v1/portal-api/v1/save_ui_preferences | JSON object with the current update parameters. When the same RPC can also create, PUT requires an existing record ID. |
| DELETE | /functions/v1/portal-api/v1/delete_forum_post | JSON object with the exact target and required revision. The operation keeps its domain-specific deletion or withdrawal behavior. |
| DELETE | /functions/v1/accounts/v1/deletions/confirm | JSON object with plan_id, request_id and confirmation set to DELETE. Create the actor-bound preview first. |

The aliases pass the original RPC arguments through the caller's live session and existing authorization rules. They never grant table-level CRUD or replace permission checks. Scope, conflict handling, audit and reviewed deletion dependencies stay with their existing operations. Authenticated clients must use the current publishable API key and user bearer token. Sensitive inputs and credential issuance keep their original POST contracts. Consult the edition-specific schema and operation descriptions for the full list.

## Account HTTP facade

Base: \`/functions/v1/accounts/v1\`. Machine-readable OpenAPI: \`/functions/v1/accounts/openapi.json\`; owning contract: [openapi.ts](supabase/functions/accounts/openapi.ts), enforced by [handler.ts](supabase/functions/accounts/handler.ts).

| Method | Path relative to facade base | Purpose |
| --- | --- | --- |
${accountRoutes.map(({method, path, purpose}) => `| ${cell(method)} | ${cell(path)} | ${cell(purpose)} |`).join("\n")}

The facade permits allowlisted browser Origins; authenticated non-browser clients may omit Origin. This exception does **not** apply to all Edge Functions: files and course-documents require an exact approved Origin. The account handler returns safe errors and checks request bodies before forwarding caller-scoped RPCs. Role editing, activation, deletion and own-account changes have distinct current-authority guards; consult the operation schema and owning handler. A send timeout retains its invitation reservation for reconciliation; it does not imply delivery or authorise an automatic resend.

## Permanent deletion

Permanent deletion requires current database capability and live resource authority. Preview and confirmation recheck actor-bound dependencies; accepted financial references and private-resource ACLs remain authoritative. The account Edge facade uses a database-issued execution permit for exact all-version native Storage cleanup and Auth hard deletion, drains active writer leases and returns completed only after verified absence. Pending receipts survive reload through the own permitted operations projection. Company jobs require consistent current organisation links; former lecturer claims do not grant staff job/file access. No trash or restore is provided. Read [the deletion contract](GUIDE.md#section-permanent-deletion).

## Integration-only website enquiries

\`POST /functions/v1/website-enquiries\` is an explicitly configured server-to-server intake, separate from the bearer-authenticated management facade. The normal gateway public-key/JWT boundary remains enabled; the function additionally requires a private \`X-Luminovia-Integration-Token\` header. Never embed that credential in a browser bundle, public Website or \`VITE_\` variable. The feature starts disabled; reviewed private token, exact Website origin and privacy-notice version are required to enable it. It issues no CORS permission. Server calls may omit Origin; an Origin that is present must exactly match the configured value.

The closed JSON payload contains a stable \`submission_id\` UUID, bounded company/contact/email/topic/message/preferences fields, recognised IANA time zone, \`de\`/\`en\` locale, the configured \`privacy_notice_version\` and literal \`consent: true\`. Actual streamed bodies are limited to 24,000 bytes. Only a confirmed durable database result returns \`202 {"received":true,"receipt":"<submission-id>"}\`; no internal enquiry or customer ID is exposed. Identical retries return the original receipt; changed retries return 409. Persistent sender limits reject new submissions over 10 per minute or 100 per rolling day.

Management uses current capability-protected \`enquiry_context\`, \`enquiry_inbox\`, \`enquiry_detail\` and versioned decision/conversion RPCs from the inventory below. Read [WEBSITE_ENQUIRIES](GUIDE.md#section-website-enquiries) and the [deployed handler](supabase/functions/website-enquiries/handler.ts) for exact fields, error envelopes, permissions and public-activation prerequisites. The download includes the server-only intake contract. The separate [Website relay](https://github.com/Luminovia-Training-Consulting/Website/tree/main/integrations/portal-enquiry) keeps the intake secret on the server and has independent activation settings.

## Native RPC use

Send \`POST /rest/v1/rpc/{name}\` with a JSON object whose keys match the parameter names below, or call \`supabase.rpc(name, args)\`. Defaults are shown as SQL expressions; omit optional JSON keys to use them. SQL \`NULL\` corresponds to JSON \`null\`. UUIDs and instants are JSON strings; arrays are JSON arrays. \`jsonb\` payload validation is defined by the owning migration/feature contract, not inferred from the SQL type. PostgREST returns structured errors; Edge Functions use their own safe error envelopes. Do not treat every 2xx response as a business confirmation: claim RPCs return semantic outcomes such as filled, conflict or terms-changed inside their result.

The OpenAPI distinguishes HTTP 204 with no body from a result returned as JSON. Read the operation's error code as well as the HTTP status. A stale \`set_job_capacity\` version returns SQLSTATE \`40001\` through PostgREST's HTTP 500 mapping. Reload the resource and review its new state before submitting a fresh request. Keep the original request UUID for an identical retry where the operation supports idempotency. See the [PostgREST status mapping](https://docs.postgrest.org/en/v14/references/errors.html#http-status-codes) and [Internal Portal examples](scripts/examples/README.md#internal-portal-permissions-and-scoped-actions--berechtigungen-und-aktionen-im-internen-portal).

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

## Implemented feature and configuration entry points

The same account JWT can call the listed public RPCs, the account facade, and RLS-protected REST tables where the owning feature uses them. These are representative entry points, not an assertion that every target requirement is implemented. Function signatures and effective grants appear below; the current actor's permission, membership, version and business result must still be checked. The [roadmap](ROADMAP.md) records missing product capabilities.

| Product area | Read / action API | Configuration API or current limit |
| --- | --- | --- |
| Dashboard and discovery | \`job_dashboard\`, \`teaching_day\`, \`unified_search\` | \`dashboard_preferences\`, \`save_dashboard_preferences\` |
| Accounts and profiles | Account HTTP facade, \`person_profile\`, \`own_profile_details\` | \`save_profile_details\`, \`save_managed_profile\`, \`save_contact_visibility_preferences\`; no public self-registration |
| Taxonomy | \`taxonomy_catalogue\` | \`save_taxonomy_topic\`, \`set_taxonomy_topic_archived\` under current management authority |
| Organisations and contacts | \`client_organisations\`, \`save_organisation\`, \`save_organisation_contact\` | Account organisation membership uses the facade; private contact visibility remains scoped |
| Courses and requests | \`course_workspace\`, \`save_course_template\`, \`save_course_run\`, \`create_course_run_job\`, \`client_requests\` | \`set_course_visibility\` and current resource permissions govern publication and access |
| Jobs and allocation | \`job_discovery\`, \`job_detail\`, \`claim_job\`, \`manual_assignment_candidates\`, \`manual_assign_job\` | \`manage_job_offer\`, \`save_job_view\`, \`set_job_capacity\`; subjects OR within selection, history is opt-in, upcoming offers default to next-start order; only a confirmed complete-block transaction allocates |
| Calendar and availability | \`global_calendar_events\`, \`my_availability\`, \`import_my_calendar\`, \`export_my_calendar\` | \`manage_global_event\`, \`save_lecturer_availability\`; import creates private appointments, not a continuing feed |
| Chat and collaboration | \`chat_rooms_list\`, \`chat_messages\`, \`send_message\`, \`chat_mention_candidates\` | \`update_chat_group_settings\`, \`set_chat_pin\`, \`set_topic_invitation_only\`; membership is authoritative |
| Files and documents | \`document_discovery\`, \`reserve_document\`, files and course-documents gateways | \`save_document_organisation\`; private bytes require current version access and scanning |
| Contracts | \`contract_records\`, \`acknowledge_contract\`, \`assignment_confirmation\` | \`register_executed_contract\`, \`set_contract_status\`; receipt is not an electronic signature |
| Wiki and forum | \`wiki_pages_list\`, \`wiki_page\`, \`wiki_course_templates\`, \`forum_threads_list\` | \`save_wiki_page\`, \`manage_wiki_course_template\`, \`save_knowledge_category\`, \`moderate_forum_thread\` |
| Finance | \`finance_earnings\`, \`invoice_records\`, \`invoice_payments\`, \`finance_statement\`, \`submit_invoice\` | \`lecturer_compensation\`, \`save_lecturer_compensation\`, \`request_invoice_review\`, finance-only \`invoice_review_cases\`/\`resolve_invoice_review_request\`, \`record_invoice_payment\`; no bank transfer or tax engine |
| Notifications | \`notification_inbox\`, \`attention_preferences\`, \`announcements\` | \`save_notification_preferences\`, \`save_attention_preferences\`, \`manage_announcement\`; external delivery needs separately operated workers |
| Personal UI | \`ui_preferences\`, \`get_my_calendar_color_preferences\` | \`save_ui_preferences\`, \`save_my_calendar_color_preferences\` changes only the caller's validated event palette with an expected version |
| Administration | \`admin_audit_events\`, \`control_center\`, deletion facade | Current role, audit and deletion capabilities; brand/permission-matrix/retention configuration is still pending |

### Recent settings and action contracts

- \`wiki_course_templates(p_page_id)\` selects the current draft revision for the page owner or a current \`wiki.manage\` actor, and the published revision for other permitted readers. Every returned template is filtered by the caller's current template permission. \`manage_wiki_course_template(p_page_id,p_revision,p_template_id,p_remove)\` changes only an unpublished draft at the observed revision; callers must be able to edit the wiki page and read the template. The 20-reference limit, revision check and published-snapshot boundary are enforced by the database.

- \`lecturer_compensation(p_user_id)\` returns the current private mode, percent, daily rate, currency, version and \`is_customized\` flag only to an authorised gross-finance administrator. With no personal override, the percentage inherits the current regular- or senior-lecturer policy (50 percent only when no policy is configured); the fixed daily fallback is EUR 200. \`save_lecturer_compensation\` requires \`p_mode\` \`percent\` or \`daily\`, percent 0–100 with two decimals, nonnegative daily rate with two decimals, \`EUR\` or \`AUD\`, and the observed \`p_expected_version\`. Quotes for published role-split offers use their captured lecturer/senior percentage unless a personal override exists. A version conflict requires reload; saved settings never edit accepted deals. A daily-rate currency/budget mismatch makes a quote unavailable.
- \`manual_assignment_candidates(p_job_id,p_search)\` returns at most 50 active lecturer candidates with eligibility, quote where permitted and the current terms version. \`manual_assign_job\` requires the selected lecturer, reviewed terms version, observed job lifecycle version and stable request UUID. Inspect \`status\`: \`confirmed\` with \`claim_id\`, or a refusal such as \`filled\`, \`conflict\`, \`not_eligible\`, \`terms_changed\`, \`quote_unavailable\` or \`unavailable\`. A 2xx transport response alone is not allocation.
- \`import_my_calendar(p_events)\` accepts an array of 1–500 reviewed appointments. Each object supplies UID, title, start/end instants and IANA time zone; optional description is bounded. It returns \`created\` and \`skipped\` counts. The server derives the owner from the JWT, ignores duplicate import identities and rolls back the entire batch on invalid input or confirmed-assignment overlap. Recurrence expansion and preview are client-side; no subscription is created.
- \`POST /functions/v1/accounts/v1/users\` creates one account with email, display name, transient password, role and idempotency UUID; company accounts additionally need an organisation. Passwords must be 8–128 characters and include uppercase/lowercase letters, a digit and one supported symbol, matching the configured Auth character classes. Its \`201\`/\`200\` response confirms the current request, while \`409\` indicates unresolved/conflicting creation and \`502\` means creation was not confirmed. It sends no invitation. Refer to the machine-readable schema for exact fields and role values.
- \`GET /functions/v1/accounts/v1/me\` includes the caller's stable \`luminovia_user_id\` in the own-profile projection. \`GET /functions/v1/accounts/v1/users\` includes that same field in its bounded \`users.manage\`-authorized directory; the ID is a display reference, not an account lookup or proof of permission. Permission-filtered \`people_directory\` and \`person_profile\` projections include IDs only for profiles the caller may already read.
- Mail administration is restricted by the current \`mail.settings.manage\` permission. \`get_mail_configuration()\` returns versioned SMTP/optional IMAP metadata and credential-presence flags, never usernames or passwords. \`save_mail_configuration(p_expected_version,p_smtp,p_imap)\` validates approved public DNS names, paired ports/TLS, sender metadata and version conflicts; credentials are written to Vault and are write-only. \`queue_mail_connection_test(p_protocol)\` creates a short-lived audited request. The authenticated \`mail-admin\` Edge operation performs a no-message SMTP/IMAP handshake through the private relay and returns only an allowlisted result code. Its GET method reports the configured relay and invitation switches for authorized administrators. \`get_mail_delivery_transport()\`, \`claim_mail_connection_test\` and \`complete_mail_connection_test\` are service-role-only internal relay contracts and are not browser operations.
- \`submit_invoice(p_number,p_claim_ids,p_document_version_id,p_issued_on,p_due_on,p_client_id)\` requires an owned accepted block, a clean exact PDF version and the final scheduled assigned-session end. Attendance and quizzes are not prerequisites; cancelled, partially released or schedule-mismatched blocks return \`invoice_review_required\`. When \`p_due_on\` is omitted it defaults to issue date plus 30 days; an explicit valid date is preserved. \`my_invoice_review_candidates()\` and \`request_invoice_review(p_claim_id,p_request_id)\` expose/request only the lecturer's own review cases; \`invoice_review_cases()\` and \`resolve_invoice_review_request(p_request_id,p_note)\` require current \`finance.manage\`. Review resolution records a note only; it does not create an invoice, change accepted amounts, or record payment.
- \`get_my_calendar_color_preferences()\` returns the caller's own light event-color palette and version; a missing row has safe light defaults. \`save_my_calendar_color_preferences(p_expected_version,p_personal_event_color,p_assignment_event_color,p_customer_event_color)\` accepts only one of the fixed contrast-tested swatches for each category and uses compare-and-set versioning. Color values are not visible to administrators or other accounts through the preference RPC.

\`ui_preferences()\` returns \`{language:"de"|"en",theme:"system"|"light"|"dark",sidebar_collapsed:boolean,version:number}\` for the authenticated account. \`save_ui_preferences(p_patch)\` accepts a nonempty object containing any subset of \`language\`, \`theme\` and \`sidebar_collapsed\`; unknown keys, nulls and invalid values fail. The actor is derived from the access token. A language patch also updates \`profiles.locale\`, which is used by email/push workers. The browser retains a best-effort local choice before login and if an API request fails; a successful account read supplies the next signed-in session's choices. Concurrent writes to the same personal field use last committed write, while patches to different fields preserve each other.

For the other implemented personal settings, read the matching getter first and use its returned \`version\` as \`p_expected_version\` where the save function requires one. Common JSON payload contracts:

| Read / save RPC | Save request shape | Owning validation |
| --- | --- | --- |
| \`dashboard_preferences\` / \`save_dashboard_preferences\` | \`p_payload:{widget_order:["teaching_day","activity","contracts","files","followups"],hidden_widgets:[]},p_expected_version:number\`; order is a permutation of the five IDs | [dashboard schema](src/features/dashboard/personal-api.ts) |
| \`notification_preferences\` / \`save_notification_preferences\` | \`p_payload:{chat:boolean,forum:boolean,job_updates:boolean,reminders:boolean},p_expected_version:number\` | [notification schema](src/features/notifications/api.ts) |
| \`attention_preferences\` / \`save_attention_preferences\` | \`p_payload:{enabled:boolean,start_time:"HH:mm",end_time:"HH:mm",time_zone:"Europe/Berlin"},p_expected_version:number\`; times must differ | [attention schema](src/features/notifications/attention-api.ts) |
| \`delivery_preferences\` / \`save_delivery_preferences\` | \`p_payload:{email_enabled:boolean,quiet_start:null|"HH:mm",quiet_end:null|"HH:mm",time_zone:"Europe/Berlin"},p_expected_version:number\`; quiet times are both null or both distinct valid times | [delivery schema](src/features/notifications/delivery-api.ts) |

The listed zone is an IANA example, not a required location. Save responses return the current settings and version. A stale version is a conflict requiring reload; supplied JSON still undergoes server-side validation. The source schemas and owning SQL define further constraints.

The live help tour is intentionally tab-session state; the separate \`get_welcome_progress\`/\`save_welcome_progress\` API stores the durable account welcome checklist. Offline calendar snapshots and browser push permission/device state depend on the local device; authorized calendar data and push subscriptions are available through their respective APIs. ICS file parsing, recurrence preview and CSV/ICS byte generation are client-side transforms of authorized API data; external clients may submit the normalized \`import_my_calendar\` array and consume \`export_my_calendar\`/finance projections. These client transforms do not grant extra data access.

## Replayed authenticated REST relations

For a direct Data API call, use \`/rest/v1/{relation}\` with the same JWT and public API key. The methods below reflect effective \`authenticated\` PostgreSQL table/column grants at replay time: GET=SELECT, POST=INSERT, PATCH=UPDATE, DELETE=DELETE. The column list is the grant-visible union for those methods, **not** a per-method write schema. RLS, current actor/resource checks, constraints and column-specific grants can further deny a row, operation or field; a listed method does not promise a successful call for every account. Views use their own security definition rather than table RLS. The runtime gateway's generated OpenAPI and owning migration define exact request/filter/response shapes.

| Relation | Kind | Granted methods | Table RLS | Grant-visible columns |
| --- | --- | --- | --- | --- |
${restRows.map((row) => `| ${cell(row.name)} | ${row.kind} | ${[row.select && "GET", row.insert && "POST", row.update && "PATCH", row.delete && "DELETE"].filter(Boolean).join(", ")} | ${row.kind === "view" ? "view definition" : row.rls ? "enabled" : "disabled"} | ${cell(row.columns.join(", "))} |`).join("\n")}

## Replayed public function inventory

The grants column reports effective PostgreSQL EXECUTE privileges for the three listed API roles, including inherited PUBLIC grants. It is **not** a permission grant to the current person and does not describe gateway routing. Private implementations are intentionally excluded. Application wrappers remain security-invoker; trusted server-only routines still require reviewed callers. SQL return types describe database shape; resource-specific JSON fields and error codes belong to the owning feature/migration.

| RPC | Parameters, SQL types and defaults | SQL result | Effective EXECUTE roles | Security |
| --- | --- | --- | --- | --- |
${rows.map((row) => `| ${cell(row.name)} | ${cell(row.args || "none")} | ${cell(row.result)} | ${grant(row)} | ${row.definer ? "DEFINER" : "INVOKER"} |`).join("\n")}

## Files and printable documents

All private responses use no-store semantics and current resource checks. IDs are selectors, never access tokens. The [files gateway](supabase/functions/files/index.ts) accepts \`POST /functions/v1/files\` with an approved Origin and bearer JWT:

- For a multipart upload, send \`file\`, \`client_id\` and optionally \`scope\`, \`kind\`, \`room_id\`, \`job_id\`, \`replace_id\` and \`owner_id\`. Participant course chat attachments require \`scope=room\`, \`kind=chat\`, the current participant course \`room_id\`, \`message_only=true\` and \`course_chat=true\`. RPCs validate targets, rights, quotas and retry identity. Actual byte validation, quarantine and successful scanning precede clean availability.
- JSON exact-version download: \`{ "action": "download", "id": "<document-id>", "version_id": "<version-id>" }\`; omitting \`version_id\` selects the current version. Rights are rechecked around private Storage reads.
- Avatar: \`{ "action": "avatar", "user_id": "<profile-id>" }\` returns only the current permitted clean selection.
- Qualification evidence: \`{ "action": "qualification_evidence_download", "evidence_id": "<evidence-id>" }\` uses its separate exact-version grant.

\`POST /functions/v1/course-documents\` serves authorised course/client resources and renders attendance/completion documents, assignment confirmations, earnings statements and own qualification passports. Its closed, kind-specific JSON inputs and permission recheck are defined in [the handler](supabase/functions/course-documents/handler.ts), with workflows in [course workspace](GUIDE.md#section-course-learning-workspace), [finance](GUIDE.md#section-timesheets-finance-control-center) and [qualification passport](GUIDE.md#section-qualification-passport). These PDFs do not assert a legal signature or professional certification.

In the internal edition, use \`{kind:"resource"|"exam"|"completion"|"wiki_resource"|"assignment_confirmation",id:"<uuid>"}\` with the corresponding published resource, exam share, completion record, wiki attachment or assignment ID. Own qualification passports take \`{kind:"qualification_passport",locale:"de"|"en"}\`. For a company enquiry attachment, use \`{kind:"request_resource",id:"<version-uuid>",request_id:"<uuid>"}\`. Earnings statements take \`{kind:"earnings_statement",from:"YYYY-MM-DD",until:"YYYY-MM-DD",all?:boolean}\`. Course chat files use \`{kind:"course_chat_attachment",id:"<message-uuid>",version_id:"<version-uuid>"}\` or the reason-bound administrative variant in OpenAPI. A course-wide internal PDF uses \`{kind:"attendance",id:"<course-run-id>"}\`. An exact internal session uses \`{kind:"attendance_session",id:"<session-id>",format:"pdf"|"csv"}\`, with PDF as the default. Internal attendance evidence uses \`kind:"resource"\` with the resource ID. In a dedicated Academy, attendance uses the session ID with PDF or CSV, and \`kind:"attendance_evidence"\` uses the selected register evidence ID. Unknown keys and kinds are rejected. The gateway checks the actor and resource before and after reading or rendering; a valid ID alone grants nothing.

For confidential course submissions, use \`GET /api/openapi.json\` for the running edition's request shapes. Enable the course intake under the current course team permissions, then upload using the dedicated multipart mode. Reuse the same client ID, scope and bytes on retry. Download \`{kind:"participant_submission",id:"<course-run-id>",version_id:"<submission-version-id>"}\` as the submitting learner or the current scoped course team. The response is private and the reviewed version is independent of shared course material and chat.

An internal administrator investigating a company with Premium OFF can use \`inspect_retained_course_files\` and then download \`{kind:"retained_course_file",organisation_id:"<uuid>",run_id:"<uuid>",id:"<archive-link-id>",version_id:"<version-id>",file_kind:"exam"|"material",reason:"<audit-purpose>"}\`. Exact scanner-recorded bytes, current authorisation and a fresh audit purpose are required. Storage paths are resolved inside the gateway.

The internal OpenAPI download documents the compatibility \`POST /functions/v1/invite-lecturer\` endpoint. It requires an approved browser Origin, bearer JWT, enabled invitation configuration and a JSON body with \`email\`, optional \`display_name\` and stable \`idempotency_key\` UUID (maximum 2,048 request bytes). Only \`status:"sent"\` confirms delivery; reservation conflicts, throttling, unavailable delivery and uncertain sends must be handled without an automatic second email. The account administration screen uses the account facade's current invitation route, with its own schema and permission checks.

## Dedicated Academy ingress errors

In both dedicated editions, the API gateway returns HTTP 429 with the plain-text body \`local_rate_limited\` when the installation-wide signed request allowance is exhausted. The bucket replenishes every 60 seconds. A maintenance window returns HTTP 503 with a bilingual plain-text message. Both responses include \`Retry-After: 60\` and occur before the request reaches the application handler. Respect the retry delay and keep the original idempotency key for any supported retry. The dedicated OpenAPI catalogue documents these transport responses alongside operation-specific JSON responses. An upstream error with the same status may omit the header.

## Realtime course activity and inbox

Authenticated clients can use Supabase Realtime Postgres Changes on \`public.course_chat_activity\`, filtered by \`room_id=eq.<uuid>\`, with \`INSERT\` and \`UPDATE\`. Use the same current user JWT and publishable API key as REST. Refresh the subscription JWT when Auth refreshes it. Obtain the room ID through \`course_chat_rooms\`, and refresh history through \`course_chat_messages\` after subscription or reconnect and on either event. Each event's new row contains only \`id\`, \`room_id\` and an opaque \`revision\`, all UUIDs. This is an invalidation signal. It carries no body, sender, attachment reference or notification receipt. An uncommitted write or an unpublished attachment does not produce an event. Revisions are neither a pagination cursor nor a durable replay stream.

The database rechecks current membership or authorised company read access for each event. Revoking access can leave the socket connected and silent. Clients must also revalidate the room list and history and discard retained private content after denial. Read permitted history through REST on reconnect. An authorised company contact can read permitted course messages without a raw message-table subscription. Private staff chat elsewhere in the internal Portal uses its separate, membership-scoped Realtime transport.

Use \`notification_inbox\` for the current actor's notification projection and cursor and \`mark_notifications\` to change permitted read state. Refresh the inbox separately from room activity. A notification or retained link never grants room history or file bytes. The current role and resource are checked when projecting inbox items and again when opening a link.

## API compatibility

The OpenAPI information version follows semantic versioning for the explicitly documented contracts. Add optional fields and new operations without changing current semantics. Keep an existing operation and its parser during a deprecation window. Give renamed fields or incompatible required inputs a new versioned operation and announce the replacement before removing the previous contract. Record changes with the release notes. The generated native catalogue lists implementation signatures and permission metadata. Published business behaviour remains subject to current actor, ownership, course and edition checks.

## Company integration keys

In **Admin → Companies → API integrations** or **Academy administration → Course integrations**, an authorised administrator issues an expiring key for one organisation and one scope. Store its one-time secret on the consuming server. Rotation keeps the scope and invalidates the previous secret. Revocation, expiry, issuer role loss, company archiving and an inactive Academy licence prevent use.

Call these server endpoints with \`Authorization: Bearer <integration-key>\` and without an Origin header. Requests share the key's allowance of 60 per minute. HTTP 429 includes \`Retry-After\`.

| Key scope | Endpoint | Result |
| --- | --- | --- |
| \`courses.read\` | \`GET /functions/v1/company-integration\` | Published course IDs, titles and time zones. Page with \`limit\` (1–50) and \`after\` from the previous \`next_cursor\`. |
| \`enrolments.write\` | \`POST /functions/v1/company-integration/enrolments\` | Enrol a confirmed company participant by \`course_id\` and their \`participant_id\` (Luminovia User ID). The same request returns the existing enrolment, while a removed or completed enrolment returns 409. |
| \`reports.read\` | \`GET /functions/v1/company-integration/participation?course_id=<uuid>\` | Counts of sessions, currently enrolled learners and completed learners. The response contains aggregate counts without learner-level records. |

Enrolment and reports require Premium LMS enabled for the internal company or an active dedicated Academy licence. The enrolment operation works with published courses and existing, confirmed memberships. Invitations and membership approval continue in the account workflows. Wrong scope returns 401. An unavailable course or participant returns 404 without distinguishing foreign resources. Invalid arguments return 400 and unsupported HTTP methods return 405 with the allowed method. Each route documents its JSON error shape. The [integration examples](scripts/examples/README.md) include runnable requests.

## Company course webhooks

The [worker and receiver contract](OPERATIONS.md#company-course-webhooks) describes scoped subscriptions, exact signed JSON, timestamp validation, delivery attempts and deduplication. The downloadable OpenAPI document includes the webhook receiver contract. Subscription creation returns a signing key once and is excluded from interactive Swagger requests.

The internal download also includes the customer accounting receiver contract and the explicitly authorised \`company_accounting_webhook_subscribe\` operation. Each accounting event carries its customer invoice ID, occurrence time, version and event ID. Amounts and documents remain available through authorised portal accounting views.

## Assignment amendments, teaching evidence and settlement journal

Use \`save_assignment_change\` to save a versioned proposal. A company contact can submit eligible shared dates. A manager calls \`assignment_change_action\` with \`coordinate\` to request consent from each affected lecturer. Staff can include eligible lecturer-specific terms and compensation. Current versions and independent consent govern application. An obsolete version returns HTTP 409. Retry an uncertain result with the original request identifier and payload.

Teaching evidence reads and transitions use the \`delivery_sessions\`, \`delivery_session\`, \`delivery_history\`, \`save_delivery_draft\`, \`submit_delivery\`, \`review_delivery\` and \`confirm_customer_delivery\` RPCs. Reopening preserves every earlier submission and leaves the agreed schedule intact. Clients with current company scope receive the confirmed projection. Private drafts and correction reasons remain within their authorised scopes.

Internal finance can call \`accounting_settlement_journal\` with inclusive ISO calendar dates \`p_from\` and \`p_to\`. It returns \`luminovia.settlement-journal/1\`, with authorised original-currency movements and reversals. Timestamp-based reporting days use UTC. An invalid or wider-than-366-day period returns HTTP 400. A report over 5,000 movements returns HTTP 413 so callers can narrow the period. Existing invoice snapshots still use \`luminovia.accounting/1\`.

## Calendar feeds, source revisions and privacy

\`GET /functions/v1/calendar-feed?token=<private-token>\` is a distinct token-authorised iCalendar subscription, not a bearer-authenticated account endpoint. The high-entropy secret grants the selected private feed; store/share it accordingly. SQL stores its hash and the gateway repeats revocation checks. [Calendar connections](GUIDE.md#section-calendar-connections) owns scope, expiry and revocation details.

Course-run job publication binds a trusted source revision and exact session references; stale previews reject rather than silently changing the teaching block. [Course building blocks](GUIDE.md#section-course-building-blocks) and [staff comments](GUIDE.md#section-resource-comments) explain their separate resource rights. Client or learner access does not grant staff discussion access. [Architecture](DEVELOPMENT.md#section-architecture) records the explicit opt-in minimal own offline teaching snapshot; generic authenticated responses and private file bytes are not cached offline.
`;
    // Use the pinned repository formatter so regeneration reproduces the committed bytes.
    await writeFile(
        "API_REFERENCE.md",
        await format(text, {parser: "markdown"}),
    );
    console.log(
        `Generated authenticated API reference from ${rows.length} migrated public functions; no user data or credentials included.`,
    );
});
