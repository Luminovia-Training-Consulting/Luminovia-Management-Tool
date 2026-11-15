/** Disposable 14→17 review rehearsal. Auth is a four-row id/email stub; this is
 * not a live backup, native password/MFA or Storage-binary preservation claim. */
import assert from "node:assert/strict";
import { quoteSql, withTestDatabase } from "./testing/database.mjs";
import {
  loadM4ReviewContext,
  validateM4History,
} from "../deploy/hostinger/reviewed-m4-plan.mjs";

const context = await loadM4ReviewContext();
const historyQuery =
  "select coalesce(json_agg(json_build_object('version',version,'source',statements[1]) order by version),'[]'::json)::text from supabase_migrations.schema_migrations";
const historyInsert = (entry) =>
  `insert into supabase_migrations.schema_migrations(version,name,statements) values(${quoteSql(entry.version)},${quoteSql(entry.file.slice(15, -4))},array[${quoteSql(entry.source)}]);`;
const id = (n) => `f4000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const roleColumns =
  "oid,rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolvaliduntil,rolbypassrls,rolconfig";
const memberColumns =
  "roleid,member,grantor,admin_option,inherit_option,set_option";

const snapshotSQL = `
create temporary table m4_old_rows(schema_name text,table_name text,column_names text,before_rows jsonb);
create temporary table m4_old_roles as select ${roleColumns} from pg_roles;
create temporary table m4_old_memberships as select ${memberColumns} from pg_auth_members;
do $snapshot$ declare r record; cols text; rows jsonb; begin
 for r in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private','auth') loop
  select string_agg(format('%I',attname),',' order by attnum) into cols from pg_attribute where attrelid=r.oid and attnum>0 and not attisdropped;
  execute format('select coalesce(jsonb_agg(to_jsonb(old_columns)),''[]''::jsonb) from (select %s from %I.%I) old_columns',cols,r.nspname,r.relname) into rows;
  insert into m4_old_rows values(r.nspname,r.relname,cols,rows);
 end loop;
end;$snapshot$;
`;
const preservationSQL = `
do $preserved$ declare r record; missing bigint; after_count bigint; expected_new integer; begin
 for r in select * from m4_old_rows loop
  execute format('select count(*) from (select value from jsonb_array_elements($1) except all select to_jsonb(old_columns) from (select %s from %I.%I) old_columns) missing',r.column_names,r.schema_name,r.table_name) into missing using r.before_rows;
  if missing<>0 then raise exception 'M4 old row changed in %.%',r.schema_name,r.table_name; end if;
  execute format('select count(*) from %I.%I',r.schema_name,r.table_name) into after_count;
  expected_new=case when r.schema_name='public' and r.table_name='course_templates' then 22 else 0 end;
  if after_count<>jsonb_array_length(r.before_rows)+expected_new then raise exception 'Unexpected M4 additions in %.%',r.schema_name,r.table_name; end if;
 end loop;
 if exists((select ${roleColumns} from pg_roles except all select * from m4_old_roles) union all (select * from m4_old_roles except all select ${roleColumns} from pg_roles)) then raise exception 'Native role attributes changed'; end if;
 if exists((select ${memberColumns} from pg_auth_members except all select * from m4_old_memberships) union all (select * from m4_old_memberships except all select ${memberColumns} from pg_auth_members)) then raise exception 'Native role membership changed'; end if;
end;$preserved$;
`;
// Only these three source-hash-verified bodies are joined inside this temporary
// database test. The production review-plan tool exposes no apply operation.
const atomicRehearsal = (poison = "") =>
  "begin;\n" +
  snapshotSQL +
  context.pending
    .map(
      (entry) =>
        entry.source
          .replace(/^\s*begin;\s*/i, "")
          .replace(/\s*commit;\s*$/i, "") +
        "\n" +
        historyInsert(entry),
    )
    .join("\n") +
  "\n" +
  poison +
  "\n" +
  preservationSQL +
  "\ncommit;";

await withTestDatabase(
  "review_preservation",
  async ({ sql }) => {
    await sql(`
 create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);
 ${context.baseline.map(historyInsert).join("\n")}
 insert into auth.users(id,email) values
 ('${id(1)}','preservation-admin@example.invalid'),('${id(2)}','preservation-teacher@example.invalid'),
 ('${id(3)}','preservation-client@example.invalid'),('${id(4)}','preservation-learner@example.invalid');
 update public.profiles set display_name=case id when '${id(2)}' then 'Preserved teacher' else 'Prior fictional profile' end,bio_de='Unveränderte Biografie',phone='+49 000 000',time_zone='Australia/Brisbane';
 insert into public.user_roles(user_id,role) values('${id(1)}','admin'),('${id(2)}','lecturer'),('${id(3)}','client'),('${id(4)}','participant');
 insert into public.profile_details(user_id,country,languages,labels,teaching_experience) values('${id(2)}','DE',array['Deutsch','English'],array['Prior label'],'Prior teaching history');
 insert into public.organisations(id,name,country,time_zone) values('${id(10)}','Prior fictional organisation','DE','Europe/Berlin');
 insert into public.client_organisation_memberships(user_id,organisation_id) values('${id(3)}','${id(10)}');
 insert into public.organisation_private_details(organisation_id,private_notes) values('${id(10)}','Prior private note');
 insert into public.organisation_contacts(organisation_id,name,email,notes) values('${id(10)}','Prior fictional contact','contact@example.invalid','Prior contact note');
 insert into public.course_templates(id,title,description,syllabus,prerequisites) values('${id(11)}','Edited prior template','Prior description','User-edited prior syllabus','Prior prerequisites');
 insert into public.course_runs(id,template_id,organisation_id,time_zone) values('${id(12)}','${id(11)}','${id(10)}','Europe/Berlin');
 insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values('${id(13)}','${id(12)}','2026-01-02T08:00:00Z','2026-01-02T12:00:00Z');
 insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms) values('${id(14)}','${id(12)}','Prior accepted work','Prior fictional organisation','online','filled',2250,2250,'EUR','fixed_total','Prior accepted terms');
 insert into public.job_sessions(id,job_id,course_session_id,starts_at,ends_at) values('${id(15)}','${id(14)}','${id(13)}','2026-01-02T08:00:00Z','2026-01-02T12:00:00Z');
 insert into public.contracts(id,user_id,status,effective_from,expires_at,version,title) values('${id(16)}','${id(2)}','active','2025-01-01','2040-01-01',1,'Prior executed contract metadata');
 insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version,contract_id) values('${id(17)}','${id(14)}','${id(2)}','${id(18)}',2250,2250,'EUR','fixed_total','Prior accepted terms',1,'${id(16)}');
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values('${id(17)}','${id(2)}','2026-01-02T08:00:00Z','2026-01-02T12:00:00Z');
 insert into public.personal_events(user_id,title,starts_at,ends_at,time_zone) values('${id(2)}','Prior private event','2038-09-01T01:00Z','2038-09-01T02:00Z','Australia/Brisbane');
 insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by) values('${id(12)}','${id(4)}','completed','${id(1)}');
 insert into public.course_reviews(course_run_id,lecturer_id,reviewer_id,rating,comment) values('${id(12)}','${id(2)}','${id(4)}',4,'Prior enrolled feedback');
 insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values('${id(20)}','${id(2)}','${id(2)}','personal','invoice','Prior invoice.pdf','application/pdf',224,'clean','${id(21)}');
 insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,scanner_version,status) values('${id(22)}','${id(20)}','${id(2)}','${id(23)}',1,'prior/private/object.pdf','Prior invoice.pdf','application/pdf',224,repeat('a',64),'Prior scanner metadata','clean');
 update public.documents set current_version_id='${id(22)}' where id='${id(20)}';
 insert into public.invoices(id,user_id,number,issued_on,due_on,currency,total_amount,document_version_id,status,client_id,labels) values('${id(24)}','${id(2)}','PRESERVED-1','2026-01-03','2026-02-03','EUR',2250,'${id(22)}','paid','${id(25)}',array['Prior invoice label']);
 insert into public.invoice_items(invoice_id,claim_id) values('${id(24)}','${id(17)}');
 insert into public.payment_records(invoice_id,amount,currency,paid_at,reference,recorded_by,client_id) values('${id(24)}',2250,'EUR','2026-01-04','Prior tracked payment','${id(1)}','${id(26)}');
 update private.document_storage_limits set total_quota_bytes=11811160064,owner_quota_bytes=2147483648 where singleton;
 `);
    const before = JSON.parse(await sql(historyQuery));
    assert.equal(validateM4History(before, context), false);
    console.log(
      "PASS Exact 14 baseline with fictional profiles/roles, edited course, accepted fees, invoice/payment/file metadata, private event and custom quotas is loaded",
    );
    await assert.rejects(
      sql(
        atomicRehearsal(
          `update public.profiles set display_name='Deliberate preservation failure' where id='${id(2)}';`,
        ),
      ),
      /M4 old row changed/,
    );
    assert.equal(
      await sql("select count(*) from supabase_migrations.schema_migrations"),
      "14",
    );
    assert.equal(
      await sql(
        "select coalesce(to_regclass('public.profile_avatars')::text,'')",
      ),
      "",
    );
    assert.equal(
      await sql(`select display_name from public.profiles where id='${id(2)}'`),
      "Preserved teacher",
    );
    console.log(
      "PASS Deliberate old-row mutation aborts all 3 migrations atomically, retaining 14 history entries and old data",
    );
    await sql(atomicRehearsal());
    const after = JSON.parse(await sql(historyQuery));
    assert.equal(validateM4History(after, context), true);
    assert.equal(
      await sql("select count(*) from public.building_blocks"),
      "22",
    );
    assert.equal(
      await sql("select count(*) from public.building_block_sources"),
      "24",
    );
    assert.equal(
      await sql("select count(*) from public.course_templates"),
      "23",
    );
    assert.equal(
      await sql(
        "select total_quota_bytes||'/'||owner_quota_bytes from private.document_storage_limits",
      ),
      "11811160064/2147483648",
    );
    console.log(
      "PASS Exact reviewed 14→17 rehearsal preserves every old column/row/ID, role flags/memberships and custom quotas while adding only 22 templates/24 sources",
    );
    assert.equal(validateM4History(after, context), true);
    console.log(
      "PASS Completed 17 history validates without offering another application; native Auth passwords/MFA and Storage bytes are outside this stub rehearsal",
    );
    console.log(
      "\n4 M4 preservation PostgreSQL checks passed (temporary database only).",
    );
  },
  { migrationsThrough: "20261115142130" },
);
