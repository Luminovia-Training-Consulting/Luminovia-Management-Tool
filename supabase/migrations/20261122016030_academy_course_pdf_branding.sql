begin;

-- The browser operator pins the brand of the authenticated release during
-- database preparation. Public brand overrides remain administrator-owned.
create table private.academy_pdf_release_brand (
  installation_id uuid not null references private.installation_identity(installation_id),
  release_commit text not null check (release_commit ~ '^[0-9a-f]{40}$'),
  name text not null check (char_length(name) between 1 and 72
    and name !~ U&'[[:cntrl:]<>\00AD\061C\200B-\200F\202A-\202E\2060-\206F\FEFF]'),
  short_name text not null check (char_length(short_name) between 1 and 20
    and short_name !~ U&'[[:cntrl:]<>\00AD\061C\200B-\200F\202A-\202E\2060-\206F\FEFF]'),
  theme_color text not null check (theme_color ~ '^#[0-9a-f]{6}$'),
  primary key (installation_id,release_commit)
);
alter table private.academy_pdf_release_brand enable row level security;
revoke all on private.academy_pdf_release_brand from public,anon,authenticated,service_role;

create function private.pin_academy_pdf_release_brand(
  p_installation_id uuid, p_release_commit text,
  p_name text, p_short_name text, p_theme_color text
)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from private.installation_identity where singleton
    and installation_id = p_installation_id and edition <> 'internal' for share;
  if not found or not exists (
    select 1 from private.installation_verified_licence licence
    where licence.installation_id = p_installation_id
      and licence.terms->>'release_commit' = p_release_commit
      and licence.starts_at <= statement_timestamp() and licence.expires_at > statement_timestamp()
  ) then raise insufficient_privilege; end if;

  insert into private.academy_pdf_release_brand(installation_id,release_commit,name,short_name,theme_color)
    values (p_installation_id,p_release_commit,btrim(p_name),btrim(p_short_name),lower(p_theme_color))
    on conflict (installation_id,release_commit) do nothing;
  if not exists (
    select 1 from private.academy_pdf_release_brand brand
    where brand.installation_id = p_installation_id and brand.release_commit = p_release_commit
      and (brand.name,brand.short_name,brand.theme_color) = (btrim(p_name),btrim(p_short_name),lower(p_theme_color))
  ) then raise exception 'Academy PDF release brand differs from the installed receipt' using errcode = 'PT409'; end if;
end;
$$;

create function private.academy_pdf_brand()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'name', coalesce(override.name, release.name, 'Academy'),
    'short_name', coalesce(override.short_name, release.short_name, 'Academy'),
    'theme_color', coalesce(override.theme_color, release.theme_color, '#172b4b')
  )
  from private.installation_identity identity
  join private.installation_verified_licence licence using (installation_id)
  cross join private.academy_public_branding override
  left join private.academy_pdf_release_brand release
    on release.installation_id = identity.installation_id
    and release.release_commit = licence.terms->>'release_commit'
  where identity.singleton and identity.edition <> 'internal' and override.singleton;
$$;

-- Store the presentation separately from the existing immutable participation
-- facts. Historical records have no issue-time presentation to reconstruct.
alter table private.course_completion_records add column academy_pdf_brand jsonb;

create function private.snapshot_academy_completion_pdf_brand()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if coalesce(private.academy_course_access_status() = 'active', false) then
    new.academy_pdf_brand := private.academy_pdf_brand();
  else
    new.academy_pdf_brand := null;
  end if;
  return new;
end;
$$;

create trigger academy_completion_pdf_brand before insert on private.course_completion_records
  for each row execute function private.snapshot_academy_completion_pdf_brand();

revoke all on function private.pin_academy_pdf_release_brand(uuid,text,text,text,text),
  private.academy_pdf_brand(),private.snapshot_academy_completion_pdf_brand()
  from public,anon,authenticated,service_role;

do $migration$
declare
  definition text := pg_get_functiondef('private.course_document_access(text,uuid)'::regprocedure);
  attendance_anchor constant text := 'return private.academy_attendance_report(p_id)';
  completion_anchor constant text := '  return resolved;';
begin
  if cardinality(string_to_array(definition, attendance_anchor)) <> 2
    or cardinality(string_to_array(definition, completion_anchor)) <> 2 then
    raise exception 'Expected exact academy completion and attendance document branches';
  end if;
  execute replace(replace(definition,attendance_anchor,
    $fragment$return private.academy_attendance_report(p_id)
      || jsonb_build_object('academy_pdf_brand',private.academy_pdf_brand())$fragment$),
    completion_anchor,$fragment$  if dedicated and p_kind = 'completion' and resolved is not null then
    return resolved || jsonb_build_object('academy_pdf_brand', coalesce(
      (select record.academy_pdf_brand from private.course_completion_records record where record.id = p_id),
      private.academy_pdf_brand()
    ));
  end if;
$fragment$ || completion_anchor);
end;
$migration$;

notify pgrst, 'reload schema';
commit;
