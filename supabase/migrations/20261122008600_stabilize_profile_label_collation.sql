begin;

-- Label canonicalization must not depend on the database's locale-specific
-- tie-break when case-insensitive duplicates have different capitalization.
create or replace function private.profile_labels(
  p_labels jsonb,
  p_max integer,
  p_length integer
)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  result text[];
begin
  if jsonb_typeof(p_labels) <> 'array'
     or jsonb_array_length(p_labels) > p_max
     or exists (
       select 1 from jsonb_array_elements(p_labels) label
       where jsonb_typeof(label) <> 'string'
     ) then
    raise exception 'Invalid labels' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_labels) label
    where length(trim(label)) not between 1 and p_length
       or label ~ '[[:cntrl:]]'
  ) then
    raise exception 'Invalid labels' using errcode = '22023';
  end if;
  select coalesce(array_agg(value order by lower(value) collate "C"), '{}'::text[])
  into result
  from (
    select distinct on (lower(trim(label)) collate "C") trim(label) as value
    from jsonb_array_elements_text(p_labels) label
    order by lower(trim(label)) collate "C", trim(label) collate "C"
  ) canonical;
  return result;
end;
$$;

commit;
