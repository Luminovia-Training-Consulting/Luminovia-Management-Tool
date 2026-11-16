begin;

-- An own-only projection for the protected PDF gateway. No subject parameter,
-- certificate bytes, storage paths or new attestation is created by this read.
create function private.own_qualification_passport(p_locale text,p_as_of timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); facts jsonb; entries jsonb; person public.profiles;
begin
 if not private.lecturer_actor() then raise exception 'Own active lecturer required' using errcode='42501';end if;
 if p_locale is null or p_locale not in('de','en') or p_as_of is null or not isfinite(p_as_of)
 or p_as_of<now()-interval '5 minutes' or p_as_of>now()+interval '30 seconds' then
  raise exception 'Current passport timestamp and locale required' using errcode='22023';
 end if;
 if (select count(*) from public.lecturer_topics where user_id=actor)>250 then
  raise exception 'Passport exceeds bounded document size' using errcode='54000';
 end if;
 select * into person from public.profiles where id=actor;
 -- Current expiry is deliberately based on server now(), not p_as_of. If a
 -- qualification expires while PDF rendering runs, the gateway recheck differs.
 select coalesce(jsonb_agg(jsonb_build_object(
  'topic_id',t.id,'label_de',t.label_de,'label_en',t.label_en,'archived',t.archived_at is not null,
  'status',case when not l.verified then 'unverified' when l.valid_until<=now() then 'expired' else 'verified' end,
  'verified',l.verified,'valid_until',l.valid_until,'record_version',coalesce(s.version,0),
  'current_evidence_status',case when s.evidence_id is null then 'none' when e.id is null then 'unavailable' when e.withdrawn_at is not null then 'withdrawn'
    when d.id is null or d.deleted_at is not null or d.owner_id<>actor or d.kind<>'certificate' or d.scope<>'personal' or v.status<>'clean' or v.sha256 is distinct from e.sha256 then 'unavailable' else 'available' end,
  'current_evidence',case when e.withdrawn_at is null and d.deleted_at is null and d.owner_id=actor and d.kind='certificate' and d.scope='personal' and v.status='clean' and v.sha256=e.sha256 then
    jsonb_build_object('name',v.original_name,'version',v.version,'sha256',e.sha256,'bound_at',e.created_at) end,
  -- Keep historical attestation provenance separate from a current evidence
  -- binding: withdrawing a certificate does not rewrite the verification flag.
  'attestation',case when a.id is not null then jsonb_build_object('at',a.created_at,'basis',a.basis,'verified',a.verified,'valid_until',a.valid_until,
    'evidence_sha256',ae.sha256,'evidence_withdrawn',ae.withdrawn_at is not null) end
 ) order by lower(case when p_locale='de' then t.label_de else t.label_en end),t.id),'[]'::jsonb) into entries
 from public.lecturer_topics l join public.topics t on t.id=l.topic_id
 left join private.qualification_states s on s.user_id=l.user_id and s.topic_id=l.topic_id
 left join private.qualification_evidence e on e.id=s.evidence_id and e.user_id=actor and e.topic_id=t.id
 left join public.document_versions v on v.id=e.document_version_id
 left join public.documents d on d.id=v.document_id
 left join lateral(select ev.* from private.qualification_events ev where ev.user_id=actor and ev.topic_id=t.id and ev.action='attest' order by ev.version desc,ev.id desc limit 1)a on true
 left join private.qualification_evidence ae on ae.id=a.evidence_id and ae.user_id=actor and ae.topic_id=t.id
 where l.user_id=actor;
 facts=jsonb_build_object('type','qualification_passport','schema_version',1,'locale',p_locale,'issued_at',p_as_of,
  'display_name',person.display_name,'time_zone',person.time_zone,
  'self_declared',coalesce((select jsonb_build_object('country',country,'languages',languages,'teaching_experience',teaching_experience) from public.profile_details where user_id=actor),jsonb_build_object('country','','languages','[]'::jsonb,'teaching_experience','')),
  'qualifications',entries);
 return jsonb_build_object('issued_at',p_as_of,'data',facts,'hash',encode(sha256(convert_to(facts::text,'UTF8')),'hex'));
end;$$;

-- The invoker wrapper derives its subject from the actual current session. MFA
-- managers can export their own passport but receive no foreign export bypass.
create function public.own_qualification_passport(p_locale text,p_as_of timestamptz)
returns jsonb language sql stable security invoker set search_path='' as $$
 select private.own_qualification_passport(p_locale,p_as_of);
$$;
revoke all on function private.own_qualification_passport(text,timestamptz),public.own_qualification_passport(text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function private.own_qualification_passport(text,timestamptz),public.own_qualification_passport(text,timestamptz) to authenticated;
commit;
