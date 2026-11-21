begin;

-- Join a course channel on the same successful transaction as the claim. Keep
-- the existing receipt fast path and all role, quote and allocation checks.
do $migration$
declare
  source text := pg_catalog.pg_get_functiondef('private.claim_job_base(uuid,uuid,integer)'::regprocedure);
  end_of_claim text := $old$
 return jsonb_build_object('status','confirmed','claim_id',v_claim);
exception when exclusion_violation then$old$;
  revised text;
begin
  revised := replace(source, end_of_claim, $new$
 -- Claiming already holds the actor and job locks. Lock the run before the
 -- channel, matching enrolment, channel creation and assignment release.
 perform 1 from public.course_runs r
 where r.id = j.course_run_id and r.archived_at is null for no key update;
 if found then
  select r.id into v_room from public.chat_rooms r
  where r.course_run_id = j.course_run_id and r.kind = 'participant_course' for update;
  if found then
   perform private.participant_chat_assignment_grant(v_room, actor);
   insert into public.chat_members(room_id,user_id) values(v_room,actor)
   on conflict(room_id,user_id) do update
   set removed_at=null,joined_at=clock_timestamp()
   where public.chat_members.removed_at is not null;
  end if;
 end if;
 return jsonb_build_object('status','confirmed','claim_id',v_claim);
exception when exclusion_violation then$new$);
  if revised = source then
    raise exception 'Unexpected successful claim seam for course channel synchronization';
  end if;
  execute revised;
end;
$migration$;

commit;
