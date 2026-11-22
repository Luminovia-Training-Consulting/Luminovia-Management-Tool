-- Preserve the existing client conflict codes while giving expected business
-- conflicts a 409 response. Real database transaction failures still bubble up.
begin;

create or replace function public.save_assignment_change(
  p_id uuid, p_claim_id uuid, p_payload jsonb, p_expected_version integer, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path='' as $$
begin
  return private.save_assignment_change(p_id,p_claim_id,p_payload,p_expected_version,p_request_id);
exception
  when serialization_failure then
    if sqlerrm not in ('New request version required','Change request or source changed; reload') then
      raise;
    end if;
    raise sqlstate 'PGRST' using
      message = jsonb_build_object('code',sqlstate,'message',sqlerrm)::text,
      detail = '{"status":409,"headers":{}}';
end;
$$;

create or replace function public.assignment_change_action(
  p_id uuid, p_action text, p_expected_version integer, p_note text, p_request_id uuid
) returns uuid language plpgsql security invoker set search_path='' as $$
begin
  return private.assignment_change_action(p_id,p_action,p_expected_version,p_note,p_request_id);
exception
  when serialization_failure then
    if sqlerrm not in (
      'Change request changed; reload',
      'Original assignment changed; recreate request',
      'Request is not awaiting a response',
      'An original assignment changed; recreate the shared request'
    ) then
      raise;
    end if;
    raise sqlstate 'PGRST' using
      message = jsonb_build_object('code',sqlstate,'message',sqlerrm)::text,
      detail = '{"status":409,"headers":{}}';
  when exclusion_violation then
    raise sqlstate 'PGRST' using
      message = '{"code":"23P01","message":"Amended sessions conflict with current commitments"}',
      detail = '{"status":409,"headers":{}}';
end;
$$;

commit;
