begin;

-- In-progress offer inputs belong to their author. An optional course source
-- binds every operation to its existing permissions and reviewed schedule.
create table private.training_offer_creator_drafts (
  id uuid primary key,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  course_run_id uuid references public.course_runs(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  state text not null default 'editing' check (state in ('editing','created','discarded')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 65536),
  confirmation_hash text
);
create index training_offer_drafts_owner_source_idx
  on private.training_offer_creator_drafts (owner_id, course_run_id, updated_at desc, id)
  where state <> 'discarded';
create index training_offer_drafts_course_idx on private.training_offer_creator_drafts(course_run_id)
  where course_run_id is not null;
create index training_offer_drafts_job_idx on private.training_offer_creator_drafts(job_id)
  where job_id is not null;
alter table private.training_offer_creator_drafts enable row level security;
revoke all on private.training_offer_creator_drafts from public,anon,authenticated,service_role;

create function private.require_training_offer_creator(p_course_run_id uuid)
returns void language plpgsql stable security invoker set search_path = '' as $$
begin
  if not private.actor_active() or not private.has_permission('jobs.manage')
    or not exists (select 1 from private.installation_identity where singleton and edition='internal')
    or (p_course_run_id is not null and not private.has_permission('courses.manage'))
    then raise insufficient_privilege;
  end if;
end;
$$;

create function private.training_offer_creator_receipt(p_row private.training_offer_creator_drafts,p_payload boolean)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id',p_row.id,'revision',p_row.revision,'updated_at',p_row.updated_at,
    'title',coalesce(p_row.payload#>>'{values,title}',''),'state',p_row.state,'job_id',p_row.job_id,
    'payload',case when p_payload and p_row.state='editing' then p_row.payload end)
$$;

create function private.training_offer_creator_drafts(p_course_run_id uuid,p_draft_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_training_offer_creator(p_course_run_id);
  return coalesce((
    select jsonb_agg(private.training_offer_creator_receipt(draft,p_draft_id is not null)
      order by draft.updated_at desc,draft.id)
    from (
      select * from private.training_offer_creator_drafts draft
      where draft.owner_id=auth.uid() and draft.course_run_id is not distinct from p_course_run_id
        and (draft.state='editing' or (draft.state='created' and draft.job_id is not null))
        and (p_draft_id is null or draft.id=p_draft_id)
      order by (draft.state='editing') desc,draft.updated_at desc,draft.id limit 100
    ) draft
  ), '[]'::jsonb);
end;
$$;

create function private.training_offer_creator_draft_action(
  p_course_run_id uuid,p_draft_id uuid,p_expected_revision integer,p_action text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  draft private.training_offer_creator_drafts;
  duplicate_id uuid;
  duplicate private.training_offer_creator_drafts;
  job uuid;
  parameters jsonb;
  digest text;
  commission numeric;
begin
  perform private.require_training_offer_creator(p_course_run_id);
  if p_action is null or p_action not in ('save','duplicate','discard','commit')
    or p_draft_id is null or p_expected_revision is null or p_expected_revision<0
    or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>65536
    then raise invalid_parameter_value;
  end if;

  -- Serialise this actor's first saves, revisions and final acknowledgements.
  perform pg_advisory_xact_lock(hashtextextended('training-offer-draft:' || actor::text,0));
  perform private.require_training_offer_creator(p_course_run_id);
  select * into draft from private.training_offer_creator_drafts
    where id=p_draft_id and owner_id=actor and course_run_id is not distinct from p_course_run_id for update;
  if p_action='save' then
    if (p_payload-array['values','commission','internal_only','preset','source_revision'])<>'{}'::jsonb
      or jsonb_typeof(p_payload->'values') is distinct from 'object'
      or jsonb_typeof(p_payload#>'{values,title}') is distinct from 'string'
      or char_length(p_payload#>>'{values,title}')>200
      or (p_course_run_id is not null and coalesce(p_payload->>'source_revision','') !~ '^[a-f0-9]{64}$')
      then raise invalid_parameter_value;
    end if;
    if draft.id is null and p_expected_revision=0 then
      if (select count(*) from private.training_offer_creator_drafts where owner_id=actor and state='editing')>=100
        then raise program_limit_exceeded;
      end if;
      insert into private.training_offer_creator_drafts(id,owner_id,course_run_id,payload)
      values(p_draft_id,actor,p_course_run_id,p_payload) on conflict do nothing returning * into draft;
    end if;
    if draft.id is not null and draft.state='editing' and draft.payload=p_payload
      and p_expected_revision in (draft.revision,draft.revision-1)
      then return private.training_offer_creator_receipt(draft,true);
    end if;
  elsif p_action='commit' then
    digest := encode(extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
    if draft.state='created' and draft.confirmation_hash=digest
      and p_expected_revision in (draft.revision,draft.revision-1)
      then return private.training_offer_creator_receipt(draft,false);
    end if;
  elsif p_action='discard' and draft.state='discarded'
    and p_expected_revision in (draft.revision,draft.revision-1)
    then return private.training_offer_creator_receipt(draft,false);
  end if;

  if draft.id is null then raise insufficient_privilege; end if;
  if draft.state<>'editing' or draft.revision<>p_expected_revision then
    raise exception 'Training offer draft changed' using errcode = '40001';
  end if;

  if p_action='save' then
    update private.training_offer_creator_drafts set payload=p_payload,revision=revision+1,updated_at=now()
      where id=draft.id returning * into draft;
  elsif p_action='discard' then
    update private.training_offer_creator_drafts set payload='{}',state='discarded',revision=revision+1,updated_at=now()
      where id=draft.id returning * into draft;
  elsif p_action='duplicate' then
    duplicate_id := (p_payload->>'new_id')::uuid;
    if duplicate_id is null or duplicate_id=p_draft_id or (p_payload-'new_id')<>'{}'::jsonb
      then raise invalid_parameter_value;
    end if;
    select * into duplicate from private.training_offer_creator_drafts where id=duplicate_id and owner_id=actor
      and course_run_id is not distinct from p_course_run_id;
    if duplicate.id is not null and duplicate.state='editing' and duplicate.revision=1 and duplicate.payload=draft.payload
      then return private.training_offer_creator_receipt(duplicate,true);
    end if;
    if (select count(*) from private.training_offer_creator_drafts where owner_id=actor and state='editing')>=100
      then raise program_limit_exceeded;
    end if;
    insert into private.training_offer_creator_drafts (id,owner_id,course_run_id,payload)
    values(duplicate_id,actor,p_course_run_id,draft.payload) on conflict do nothing returning * into draft;
    if draft.id is null then raise insufficient_privilege; end if;
  else
    parameters := p_payload->'offer';
    commission := (p_payload->>'commission')::numeric;
    if jsonb_typeof(parameters) is distinct from 'object' then raise invalid_parameter_value; end if;
    -- Invoke the already-authoritative offer creator. Keeping the offer and
    -- receipt in the same transaction makes a lost response safe to replay.
    if p_course_run_id is null then
      job := private.create_capacity_job(parameters,(p_payload->>'capacity')::integer,p_draft_id,
        (p_payload->>'organisation_id')::uuid,commission);
    elsif (parameters->>'source_revision') is distinct from (draft.payload->>'source_revision') then
      raise exception 'Reviewed course source has changed' using errcode='40001';
    elsif p_payload->>'preset_id' is not null then
      job := private.create_training_offer_from_preset(p_course_run_id,parameters,commission,p_draft_id,
        (p_payload->>'preset_id')::uuid,(p_payload->>'preset_revision')::integer);
    else
      job := private.create_course_run_job(p_course_run_id,parameters,commission,p_draft_id);
    end if;
    update private.training_offer_creator_drafts set job_id=job,confirmation_hash=digest,
      payload=jsonb_build_object('values',jsonb_build_object('title',draft.payload#>>'{values,title}')),
      state='created',revision=revision+1,updated_at=now()
      where id=draft.id returning * into draft;
  end if;
  return private.training_offer_creator_receipt(draft,true);
end;
$$;

create function public.training_offer_creator_drafts(p_course_run_id uuid default null,p_draft_id uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.training_offer_creator_drafts(p_course_run_id,p_draft_id)
$$;
create function public.training_offer_creator_draft_action(
  p_course_run_id uuid,p_draft_id uuid,p_expected_revision integer,p_action text,p_payload jsonb
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.training_offer_creator_draft_action(p_course_run_id,p_draft_id,p_expected_revision,p_action,p_payload)
$$;

revoke all on function private.require_training_offer_creator(uuid),
  private.training_offer_creator_receipt(private.training_offer_creator_drafts,boolean),
  private.training_offer_creator_drafts(uuid,uuid),public.training_offer_creator_drafts(uuid,uuid),
  private.training_offer_creator_draft_action(uuid,uuid,integer,text,jsonb),
  public.training_offer_creator_draft_action(uuid,uuid,integer,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.training_offer_creator_drafts(uuid,uuid),public.training_offer_creator_drafts(uuid,uuid),
  private.training_offer_creator_draft_action(uuid,uuid,integer,text,jsonb),
  public.training_offer_creator_draft_action(uuid,uuid,integer,text,jsonb) to authenticated;
-- Drafts are private working state. The existing deletion preview and write
-- fence include them when their author, source course or confirmed offer is removed.
alter function private.deletion_scope(text,uuid) rename to deletion_scope_before_offer_creator_drafts;
create function private.deletion_scope(p_kind text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  scope jsonb := private.deletion_scope_before_offer_creator_drafts(p_kind,p_id);
  relation record;
  predicate text;
  selectors text[] := '{}';
begin
  for relation in select * from (values
    ('public.profiles','owner_id'),
    ('public.course_runs','course_run_id'),
    ('public.jobs','job_id')
  ) as row(table_name,column_name) loop
    predicate := private.deletion_selector(scope,relation.table_name);
    if predicate is not null then
      selectors := array_append(selectors, format('x.%I in (select x.id from %s x where %s)',
        relation.column_name,relation.table_name,predicate));
    end if;
  end loop;
  if cardinality(selectors)>0 then
    scope := private.deletion_add_scope(scope,'private.training_offer_creator_drafts',array_to_string(selectors,' or '));
  end if;
  return scope;
end;
$$;
revoke all on function private.deletion_scope_before_offer_creator_drafts(text,uuid),
  private.deletion_scope(text,uuid) from public,anon,authenticated,service_role;
create trigger permanent_deletion_fence
  before insert or update or delete on private.training_offer_creator_drafts
  for each row execute function private.guard_permanent_deletion();

notify pgrst,'reload schema';
commit;
