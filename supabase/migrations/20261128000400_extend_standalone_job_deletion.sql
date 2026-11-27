begin;

-- Historical inactive line items are relevant too; the active-only index
-- cannot serve ownership and reference checks across the full invoice history.
create index invoice_items_claim_lookup on public.invoice_items(claim_id, invoice_id);
create index invoice_review_audit_resource on public.audit_events(resource_id)
  where action = 'invoice.reviewed';

alter function private.deletion_scope(text, uuid)
  rename to deletion_scope_before_job_invoices;

-- Preview, confirmation and the worker share this exact ownership graph.
create function private.deletion_scope(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  scope jsonb := private.deletion_scope_before_job_invoices(p_kind, p_id);
  claim_ids uuid[];
  invoice_ids uuid[];
  document_ids uuid[];
  notice_predicate text;
  relation text;
begin
  if p_kind <> 'job' then
    return scope;
  end if;

  -- Job-owned publication state exists for both staff and company deletions.
  foreach relation in array array[
    'private.job_matching_requirements', 'private.job_publication_plans',
    'private.job_publication_invitees', 'private.job_publication_requests',
    'private.training_offer_creator_drafts'
  ] loop
    scope := private.deletion_add_scope(scope, relation, format('x.job_id=%L::uuid', p_id));
  end loop;

  if private.deletion_admin(auth.uid()) then
    select coalesce(array_agg(claim.id order by claim.id), array[]::uuid[]) into claim_ids
    from public.job_claims claim where claim.job_id = p_id;

    scope := private.deletion_add_scope(scope, 'private.training_assignment_delivery',
      format('x.claim_id=any(%L::uuid[])', claim_ids));

    -- A replacement joining two jobs is shared evidence. Only a relationship
    -- whose two assignments are inside this operation belongs in the cascade.
    scope := private.deletion_add_scope(scope, 'private.partial_teaching_replacements',
      format('x.source_claim_id=any(%L::uuid[]) and x.replacement_claim_id=any(%L::uuid[])', claim_ids, claim_ids));

    -- Review, payment, a contractual series or another job makes an invoice
    -- independent accounting evidence. Never let jobs.manage alone erase it.
    if private.has_permission('finance.manage') then
      select coalesce(array_agg(invoice.id order by invoice.id), array[]::uuid[]) into invoice_ids
      from public.invoices invoice
      where invoice.status = 'submitted'
        and invoice.reviewed_at is null and invoice.reviewed_by is null
        and invoice.series_approval_id is null
        and exists (
          select 1 from public.invoice_items item
          where item.invoice_id = invoice.id and item.claim_id = any(claim_ids)
        )
        and not exists (
          select 1 from public.invoice_items item
          where item.invoice_id = invoice.id and not (item.claim_id = any(claim_ids))
        )
        and not exists (select 1 from public.payment_records payment where payment.invoice_id = invoice.id)
        and not exists (
          select 1 from public.audit_events event
          where event.resource_id = invoice.id and event.action = 'invoice.reviewed'
        );

      if cardinality(invoice_ids) > 0 then
        scope := private.deletion_add_scope(scope, 'public.invoices', format('x.id=any(%L::uuid[])', invoice_ids));
        scope := private.deletion_add_scope(scope, 'public.invoice_items', format('x.invoice_id=any(%L::uuid[])', invoice_ids));

        -- Freeze document identities independently of invoices. The worker may
        -- remove the invoice before deleting its PDF versions and storage.
        select coalesce(array_agg(distinct document.id order by document.id), array[]::uuid[]) into document_ids
        from public.invoices invoice
        join public.document_versions version on version.id = invoice.document_version_id
        join public.documents document on document.id = version.document_id
        where invoice.id = any(invoice_ids)
          and document.scope = 'personal' and document.kind = 'invoice'
          and document.owner_id = invoice.user_id and document.job_id is null and document.room_id is null
          and not exists (
            select 1 from public.document_versions other_version
            join public.invoices other_invoice on other_invoice.document_version_id = other_version.id
            where other_version.document_id = document.id
              and not (other_invoice.id = any(invoice_ids))
          );

        scope := private.deletion_add_scope(scope, 'public.documents', format('x.id=any(%L::uuid[])', document_ids));
        scope := private.deletion_add_scope(scope, 'public.document_versions', format('x.document_id=any(%L::uuid[])', document_ids));
        scope := private.deletion_add_scope(scope, 'private.document_organisation', format('x.document_id=any(%L::uuid[])', document_ids));

        notice_predicate := format('x.kind=''invoice_submitted'' and x.resource_id=any(%L::uuid[])', invoice_ids);
        scope := private.deletion_add_scope(scope, 'public.notifications', notice_predicate);
        foreach relation in array array['private.notification_email_outbox', 'private.notification_push_outbox'] loop
          scope := private.deletion_add_scope(scope, relation,
            format('x.notification_id in(select notice.id from public.notifications notice where %s)',
              replace(notice_predicate, 'x.', 'notice.')));
        end loop;
      end if;
    end if;
  end if;

  -- Union selectors once per relation so each count, fingerprint and fence is
  -- computed for the complete set, including any scope supplied by older layers.
  return (
    select jsonb_agg(jsonb_build_object('table', relation_name, 'predicate', predicate) order by first_position)
    from (
      select entry->>'table' relation_name,
        string_agg('(' || (entry->>'predicate') || ')', ' or ' order by position) predicate,
        min(position) first_position
      from jsonb_array_elements(scope) with ordinality item(entry, position)
      group by entry->>'table'
    ) grouped
  );
end;
$$;

revoke all on function private.deletion_scope_before_job_invoices(text, uuid),
  private.deletion_scope(text, uuid) from public, anon, authenticated, service_role;

-- Recovery can pick a different administrator. Keep the finance requirement
-- on the stored plan, including after a partial or retried worker run.
do $migration$
declare
  definition text := pg_get_functiondef('private.deletion_operation_authorized(uuid,uuid)'::regprocedure);
  marker constant text := ' if o.actor_id<>p_actor then';
begin
  if cardinality(string_to_array(definition, marker)) <> 2 then
    raise exception 'Expected the current deletion operation authorization';
  end if;
  execute replace(definition, marker, $branch$
 if o.kind = 'job' and private.deletion_selector(o.scope, 'public.invoices') is not null
   and not exists (
     select 1 from public.user_roles role
     join public.role_permissions permission on permission.role = role.role
     where role.user_id = p_actor and permission.permission = 'finance.manage'
   ) then return false; end if;
$branch$ || marker);
end;
$migration$;

-- These relationships were introduced after the original job fences.
do $migration$
declare
  relation regclass;
begin
  for relation in select unnest(array[
    'private.job_matching_requirements', 'private.job_publication_plans',
    'private.job_publication_invitees', 'private.job_publication_requests',
    'private.training_offer_creator_drafts', 'private.training_assignment_delivery',
    'private.partial_teaching_replacements'
  ]::regclass[]) loop
    if not exists (
      select 1 from pg_catalog.pg_trigger
      where tgrelid = relation and tgname = 'permanent_deletion_fence'
    ) then
      execute format('create trigger permanent_deletion_fence before insert or update or delete on %s
        for each row execute function private.guard_permanent_deletion()', relation);
    end if;
  end loop;
end;
$migration$;

commit;
