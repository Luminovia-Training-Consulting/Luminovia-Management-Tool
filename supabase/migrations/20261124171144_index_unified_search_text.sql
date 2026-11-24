begin;

create extension if not exists pg_trgm with schema extensions;

-- Match only the rows eligible to be searched. The projection still applies
-- current document, chat membership and personal message-visibility checks.
create index documents_search_live_name_trgm
  on public.documents using gin (lower(original_name) extensions.gin_trgm_ops)
  where deleted_at is null and status = 'clean';

create index messages_search_live_body_trgm
  on public.messages using gin (lower(body) extensions.gin_trgm_ops)
  where deleted_at is null;

-- Keep the public entry point and participant-specific course chat links.
create or replace function private.unified_search_before_course_chat_links(
  p_query text, p_kind text default '',
  p_after_kind text default null, p_after_title text default null,
  p_after_id uuid default null, p_limit integer default 40
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  items jsonb;
  literal_pattern text;
begin
  if not (private.actor_active() or (coalesce(p_kind in ('courses', 'chats'), false) and private.learning_actor())) then
    raise exception 'Active account required' using errcode = '42501';
  end if;
  if p_query is null or length(trim(p_query)) not between 2 and 100 or
     p_kind is null or p_kind not in ('', 'jobs', 'files', 'wiki', 'forum', 'chats', 'people', 'courses', 'clients', 'contracts', 'finance') or
     (p_after_kind is not null and p_after_kind not in ('jobs', 'files', 'wiki', 'forum', 'chats', 'people', 'courses', 'clients', 'contracts', 'finance')) or
     p_limit is null or p_limit not between 1 and 80 or
     (p_after_kind is null) <> (p_after_title is null) or
     (p_after_kind is null) <> (p_after_id is null) or
     length(p_after_title) > 1000 then
    raise exception 'Invalid search page' using errcode = '22023';
  end if;
  p_query := lower(trim(p_query));
  -- Use LIKE only as an indexable literal substring predicate. Percent,
  -- underscore and the chosen escape character remain ordinary search text.
  literal_pattern := '%' || replace(replace(replace(p_query, '!', '!!'), '%', '!%'), '_', '!_') || '%';
  with available as (
    select job.id, 'jobs'::text kind, job.title, job.customer_name detail,
      '/jobs/' || job.id url
    from public.jobs job
    where private.can_read_job(job.id) and
      position(p_query in lower(job.title || ' ' || job.description || ' ' || job.customer_name)) > 0
    union all
    select document.id, 'files', document.original_name, ''::text,
      '/files?q=' || private.search_url_component(document.original_name)
    from public.documents document
    where document.deleted_at is null and document.status = 'clean' and
      private.can_access_document(document.id) and
      lower(document.original_name) like literal_pattern escape '!'
    union all
    select page.id, 'wiki', revision.title, revision.locale,
      '/wiki?page=' || page.id
    from public.wiki_pages page
    join public.wiki_revisions revision on revision.page_id = page.id and
      revision.version = case
        when page.owner_id = auth.uid() or private.has_permission('wiki.manage')
          then page.current_version else page.published_version end
    where not page.archived and private.can_read_wiki(page.id) and
      position(p_query in lower(revision.title || ' ' || revision.content_text)) > 0
    union all
    select thread.id, 'forum', thread.title, ''::text,
      '/forum?thread=' || thread.id
    from public.forum_threads thread
    where not thread.archived and private.can_read_forum(thread.id) and
      (position(p_query in lower(thread.title)) > 0 or exists (
        select 1 from public.forum_posts post
        where post.thread_id = thread.id and post.deleted_at is null and
          position(p_query in lower(post.content_text)) > 0
      ))
    union all
    select message.id, 'chats', left(message.body, 150), ''::text,
      '/chats?room=' || message.room_id
    from public.messages message
    where message.deleted_at is null and
      private.can_access_chat_room(message.room_id) and
      not private.chat_message_hidden(message.id) and
      lower(message.body) like literal_pattern escape '!'
    union all
    select profile.id, 'people', profile.display_name, ''::text,
      '/people/' || profile.id
    from public.profiles profile
    where private.profile_staff(profile.id) and private.can_read_person(profile.id) and
      position(p_query in lower(profile.display_name || ' ' || profile.bio_de || ' ' || profile.bio_en)) > 0
    union all
    select run.id, 'courses', template.title, coalesce(organisation.name, ''),
      case when private.course_premium_access(run.id)
        then '/courses/' || run.id || '/workspace' else '/courses?run=' || run.id end
    from public.course_runs run
    join public.course_templates template on template.id = run.template_id
    left join public.organisations organisation on organisation.id = run.organisation_id
    where run.archived_at is null and
      (private.can_read_course_run(run.id) or private.course_search_allowed(run.id)) and
      position(p_query in lower(template.title || ' ' || template.description || ' ' || coalesce(organisation.name, ''))) > 0
    union all
    select organisation.id, 'clients', organisation.name, ''::text,
      case when private.has_permission('organisations.manage') then '/clients'
        when private.client_has_organisation(organisation.id) then '/client'
        else '/courses' end
    from public.organisations organisation
    where private.favourite_resource('organisation', organisation.id) is not null and
      position(p_query in lower(organisation.name)) > 0
    union all
    select contract.id, 'contracts', contract.title, ''::text, '/contracts'
    from public.contracts contract
    where (contract.user_id = auth.uid() or private.has_permission('contracts.read') or
      private.has_permission('contracts.manage')) and
      position(p_query in lower(contract.title)) > 0
    union all
    select invoice.id, 'finance', invoice.number, invoice.currency, '/finance'
    from public.invoices invoice
    where private.can_read_invoice(invoice.id) and
      position(p_query in lower(invoice.number)) > 0
  ), page as (
    select * from available item
    where (p_kind = '' or item.kind = p_kind) and
      (p_after_kind is null or
        (item.kind, lower(item.title), item.id) > (p_after_kind, p_after_title, p_after_id))
    order by item.kind, lower(item.title), item.id
    limit p_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'kind', kind, 'title', title, 'detail', detail, 'url', url
  ) order by kind, lower(title), id), '[]'::jsonb)
  into items from page;
  return jsonb_build_object(
    'items', case when jsonb_array_length(items) > p_limit then items - p_limit else items end,
    'has_more', jsonb_array_length(items) > p_limit,
    'next_cursor', case when jsonb_array_length(items) > p_limit then jsonb_build_object(
      'kind', items->(p_limit - 1)->>'kind',
      'title', lower(items->(p_limit - 1)->>'title'),
      'id', items->(p_limit - 1)->>'id'
    ) else null end
  );
end;
$$;

commit;
