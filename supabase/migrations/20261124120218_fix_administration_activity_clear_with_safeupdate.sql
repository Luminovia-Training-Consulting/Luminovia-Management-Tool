begin;

create or replace function private.clear_administration_activity(p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  deleted_count bigint;
begin
  if not private.can_clear_administration_activity() then raise insufficient_privilege; end if;
  if p_confirm is distinct from true then raise invalid_parameter_value; end if;
  lock table private.administration_activity in share row exclusive mode;
  if not private.can_clear_administration_activity() then raise insufficient_privilege; end if;
  -- The primary key is non-null for every receipt. Keep the host's safeupdate
  -- enforcement enabled and explicitly target the rows in this journal.
  delete from private.administration_activity activity where activity.id is not null;
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('removed',deleted_count);
end;
$$;

commit;
