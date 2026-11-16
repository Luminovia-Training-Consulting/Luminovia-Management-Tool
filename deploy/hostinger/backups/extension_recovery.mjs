/**
 * Restore reviewed extension versions, ACLs and function settings after logical recovery. Version/hash checks reject a different extension inventory as equivalent.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectCommand } from "../backup.mjs";

// Public original installer bytes only. Never called against a live container.
// Install only the captured, verified extension catalog and check the available version.
export async function installExtensionRecovery(
  database,
  requested,
  recovery,
  temporary,
) {
  assert.equal(recovery.format, "luminovia-extension-recovery-v1");
  assert.equal(
    recovery.bootstrapImage,
    "supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00",
  );
  assert.match(database.name, /^portal-restore-[0-9a-f-]{36}$/);
  const labels = JSON.parse(
    await collectCommand("docker", [
      "inspect",
      "--format",
      "{{json .Config.Labels}}",
      database.name,
    ]),
  );
  assert.equal(
    labels["org.luminovia.portal.restore-validation"],
    database.name.slice("portal-restore-".length),
  );
  const host = JSON.parse(
    await collectCommand("docker", [
      "inspect",
      "--format",
      "{{json .HostConfig}}",
      database.name,
    ]),
  );
  assert.equal(host.NetworkMode, "none");
  assert(!host.PortBindings || !Object.keys(host.PortBindings).length);
  const selected = Object.keys(requested).filter(
    (name) => requested[name] === recovery.versions[name],
  );
  const directory = resolve(temporary, "legacy-extension-installers");
  await mkdir(directory, { recursive: true, mode: 0o755 });
  let count = 0;
  for (const [name, file] of Object.entries(recovery.files)) {
    assert.match(name, /^[a-z0-9_-]+(?:--[a-zA-Z0-9_.-]+)?\.(?:control|sql)$/);
    if (
      !selected.some(
        (ext) => name === ext + ".control" || name.startsWith(ext + "--"),
      )
    )
      continue;
    const contents = Buffer.from(file.base64, "base64");
    assert(contents.length < 1024 * 1024);
    assert.equal(contents.length, file.bytes);
    assert.equal(
      createHash("sha256").update(contents).digest("hex"),
      file.sha256,
    );
    await writeFile(resolve(directory, name), contents, { mode: 0o644 });
    count++;
  }
  if (count) {
    const share = await collectCommand("docker", [
      "exec",
      database.name,
      "pg_config",
      "--sharedir",
    ]);
    assert.match(share, /^\/(?:usr|nix)\/[A-Za-z0-9_./-]+$/);
    await collectCommand("docker", [
      "cp",
      directory + "/.",
      database.name + ":" + share + "/extension",
    ]);
  }
  return {
    extensions: selected,
    installerFiles: count,
    bootstrapImage: recovery.bootstrapImage,
  };
}

// Normalize known restore-related ACL representation against the expected inventory; do not silently accept unexpected privileges.
export async function canonicalizePrivileges(database, actual, expected) {
  const descriptors = [];
  const ids = new Map();
  const register = (item, kind) => {
    const value = { acl: item.acl, owner: item.owner, kind };
    const key = JSON.stringify(value);
    if (!ids.has(key)) {
      ids.set(key, descriptors.length);
      descriptors.push({ id: descriptors.length, ...value });
    }
    return ids.get(key);
  };
  for (const summary of [actual, expected])
    for (const [field, kind] of [
      ["tables", "r"],
      ["functions", "f"],
    ])
      for (const item of summary[field]) register(item, kind);
  if (descriptors.length === 0) return;
  const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
  const sql = `with entries as(select * from jsonb_to_recordset(${literal(JSON.stringify(descriptors))}::jsonb) as x(id int,acl text,owner text,kind text)) select json_object_agg(id,(select coalesce(json_agg(json_build_object('grantor',pg_get_userbyid(grantor),'grantee',case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end,'privilege',privilege_type,'grantable',is_grantable) order by pg_get_userbyid(grantor),case when grantee=0 then 'PUBLIC' else pg_get_userbyid(grantee) end,privilege_type,is_grantable),'[]'::json) from aclexplode(coalesce(entries.acl::aclitem[],acldefault(entries.kind::"char",(select oid from pg_roles where rolname=entries.owner)))))) from entries;`;
  const canonical = JSON.parse(await database.sql(sql));
  for (const summary of [actual, expected])
    for (const [field, kind] of [
      ["tables", "r"],
      ["functions", "f"],
    ])
      for (const item of summary[field]) {
        const id = register(item, kind);
        item.acl = canonical[id];
      }
}

// pg_dump deliberately omits member definitions of an extension, including
// later ALTER FUNCTION settings. Replay the captured settings only for genuine
// extension members; ordinary application functions must survive pg_restore
// unchanged and are checked without this repair.
// Replay captured settings only for the expected extension functions.
export async function restoreExtensionFunctionSettings(
  database,
  source,
  dbname,
) {
  const literal = (s) => "'" + s.replaceAll("'", "''") + "'";
  const rows = source.functions.map(
    ({ schema, name, arguments: args, configuration }) => ({
      schema,
      name,
      args,
      configuration,
    }),
  );
  const sql = `do $restore_extension_settings$ declare item record; target oid; option text; split_at integer; setting_name text; previous_setting text; begin
    for item in select * from jsonb_to_recordset(${literal(JSON.stringify(rows))}::jsonb) as x(schema text,name text,args text,configuration text[]) loop
      select p.oid into target from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname=item.schema and p.proname=item.name and pg_get_function_identity_arguments(p.oid)=item.args
       and exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e');
      if target is not null then
        execute format('ALTER FUNCTION %s RESET ALL',target::regprocedure);
        if item.configuration is not null then foreach option in array item.configuration loop
          split_at:=position('=' in option);
          if split_at<2 then raise exception 'Invalid captured extension setting'; end if;
          setting_name:=substring(option from 1 for split_at-1);
          previous_setting:=current_setting(setting_name,true);
          perform set_config(setting_name,substring(option from split_at+1),true);
          execute format('ALTER FUNCTION %s SET %I FROM CURRENT',target::regprocedure,setting_name);
          perform set_config(setting_name,previous_setting,true);
        end loop; end if;
      end if;
    end loop;
  end $restore_extension_settings$;`;
  await collectCommand(
    "docker",
    [
      "exec",
      "-i",
      database.name,
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      dbname,
      "-X",
      "-qAt",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql },
  );
}
