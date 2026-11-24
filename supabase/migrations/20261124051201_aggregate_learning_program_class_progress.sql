begin;

create or replace function private.learning_program_class_progress(p_program_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  company_id uuid;
  result jsonb;
begin
  if p_program_id is null then raise invalid_parameter_value; end if;
  select organisation_id into company_id from private.learning_programs where id = p_program_id;
  if not found or not coalesce(
    private.learning_program_manager(company_id) and private.course_lms_read_enabled(company_id), false
  ) then raise insufficient_privilege; end if;

  -- Class totals only need counts. The individual programme view also
  -- computes prerequisite order, step state and receipt links.
  with learner_progress as (
    select membership.class_id, enrolled.user_id,
      count(module.position) as module_slots,
      count(receipt.id) as modules_completed
    from private.learning_program_members enrolled
    join private.company_participant_memberships membership
      on membership.user_id = enrolled.user_id and membership.organisation_id = company_id
      and membership.status = 'active' and membership.class_id is not null
    left join private.learning_program_courses module on module.program_id = enrolled.program_id
    left join public.course_runs run on run.id = module.course_id and run.organisation_id = company_id
    left join public.course_enrolments enrolment on enrolment.course_run_id = run.id
      and enrolment.user_id = enrolled.user_id and enrolment.status in ('enrolled', 'completed')
    left join private.course_completion_records receipt on receipt.run_id = run.id
      and receipt.user_id = enrolment.user_id and receipt.revoked_at is null
    where enrolled.program_id = p_program_id and private.active_company_participant(enrolled.user_id, company_id)
    group by membership.class_id, enrolled.user_id
  ), class_progress as (
    select class.id as class_id, class.name as class_name,
      count(*) as participants,
      count(*) filter (where progress.module_slots > 0
        and progress.modules_completed = progress.module_slots) as participants_completed,
      sum(progress.module_slots) as module_slots,
      sum(progress.modules_completed) as modules_completed
    from learner_progress progress
    join private.course_classes class on class.id = progress.class_id and class.organisation_id = company_id
    group by class.id, class.name
  )
  select coalesce(jsonb_agg(to_jsonb(class_progress) order by lower(class_name), class_id), '[]'::jsonb)
  into result
  from class_progress;
  return result;
end;
$$;

commit;
