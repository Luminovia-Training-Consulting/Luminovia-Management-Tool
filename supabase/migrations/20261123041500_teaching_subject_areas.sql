begin;

-- Subject areas use the existing catalogue tree and profile topic selection.
insert into public.topics (id, kind, label_de, label_en)
values
  ('fbb0c720-bcdf-4c96-aac4-16931325ba01', 'topic', 'IT und Informatik', 'IT and Computing'),
  ('fbb0c720-bcdf-4c96-aac4-16931325ba02', 'topic', 'Business und Wirtschaft', 'Business and Economics'),
  ('fbb0c720-bcdf-4c96-aac4-16931325ba03', 'topic', 'Sonstige Themen', 'Other Subjects');

-- Classify the shipped teaching catalogue while preserving existing hierarchies.
with subjects(label, area) as (values
  ('LPIC-1', 1),
  ('LPIC-1 Prüfung 101-500', 1),
  ('LPIC-1 Prüfung 102-500', 1),
  ('Cisco CCNA', 1),
  ('CompTIA Security+', 1),
  ('CompTIA PenTest+', 1),
  ('Microsoft 365 Endpoint Administrator Associate', 1),
  ('DATEV-Anwender Lohn- und Gehaltsabrechnung', 2),
  ('Technisches Englisch B1/B2', 1),
  ('IHK-Abschlussprüfung IT-Berufe Teil 1', 1),
  ('IHK-Abschlussprüfung IT-Berufe Teil 2', 1),
  ('Linux', 1),
  ('Linux-Installation und Systemstart', 1),
  ('Linux-Systemarchitektur', 1),
  ('Linux-Paketverwaltung', 1),
  ('GNU- und Unix-Kommandos', 1),
  ('Shell-Skripting', 1),
  ('Reguläre Ausdrücke', 1),
  ('vi', 1),
  ('Linux-Prozessverwaltung', 1),
  ('Linux-Dateisysteme', 1),
  ('Partitionierung und Speicherquoten', 1),
  ('Linux-Dateirechte und Dateilinks', 1),
  ('Linux-Benutzer- und Gruppenverwaltung', 1),
  ('Aufgabenplanung unter Linux', 1),
  ('Linux-Desktopumgebungen', 1),
  ('Lokalisierung und Internationalisierung', 1),
  ('Systemprotokollierung', 1),
  ('Systemzeit und Zeitsynchronisation', 1),
  ('Mail-Transfer-Agents', 1),
  ('Linux-Druckverwaltung', 1),
  ('Linux-Netzwerkkonfiguration', 1),
  ('Linux-Systemhärtung', 1),
  ('Netzwerkgrundlagen', 1),
  ('IPv4-Adressierung und Subnetting', 1),
  ('IPv6-Adressierung und Konnektivität', 1),
  ('Routing', 1),
  ('OSPF', 1),
  ('Switching und VLANs', 1),
  ('Spanning Tree', 1),
  ('Link Aggregation', 1),
  ('Layer-3-Redundanz', 1),
  ('Wide Area Networks', 1),
  ('Virtuelle private Netzwerke', 1),
  ('Netzwerk-Zugriffslisten', 1),
  ('DHCP', 1),
  ('Netzwerkadressübersetzung', 1),
  ('DNS', 1),
  ('Quality of Service', 1),
  ('WLAN und Wireless-Sicherheit', 1),
  ('Bluetooth-Sicherheit', 1),
  ('Softwaredefinierte Netzwerke', 1),
  ('Cisco IOS', 1),
  ('Cisco DNA Center', 1),
  ('SNMP', 1),
  ('Informationssicherheit', 1),
  ('IT-Sicherheitsmanagement', 1),
  ('IT-Sicherheitsstandards', 1),
  ('Identitäts- und Zugriffsmanagement', 1),
  ('Zugriffssteuerungsmodelle', 1),
  ('Mehrfaktor-Authentifizierung', 1),
  ('Kryptografie', 1),
  ('Public-Key-Infrastruktur', 1),
  ('Physische IT-Sicherheit', 1),
  ('Konfigurations- und Patchmanagement', 1),
  ('Schadsoftware und Bedrohungsindikatoren', 1),
  ('Social Engineering', 1),
  ('E-Mail-Sicherheit', 1),
  ('Data Loss Prevention', 1),
  ('Sichere Netzwerkarchitektur', 1),
  ('Firewalls und Bedrohungserkennung', 1),
  ('Schwachstellenmanagement', 1),
  ('Penetrationstests und Ethical Hacking', 1),
  ('Sichere Anwendungsentwicklung', 1),
  ('Sicherheit eingebetteter Systeme', 1),
  ('Mobile Gerätesicherheit', 1),
  ('Incident Response und digitale Forensik', 1),
  ('IT-Risikomanagement', 1),
  ('Datensicherung und Notfallwiederherstellung', 1),
  ('Geschäftskontinuität und Resilienz', 1),
  ('IT-Sicherheitsaudits', 1),
  ('Datenschutz und Compliance', 1),
  ('Microsoft 365', 1),
  ('Microsoft-365-Mandantenverwaltung', 1),
  ('Microsoft Entra ID', 1),
  ('Microsoft Entra Identitätssynchronisierung', 1),
  ('Microsoft Entra Identitätsschutz', 1),
  ('Microsoft Authenticator', 1),
  ('PowerShell', 1),
  ('Microsoft Purview', 1),
  ('Microsoft Defender for Endpoint', 1),
  ('Endpunktsicherheit', 1),
  ('Microsoft Intune', 1),
  ('Intune-Geräteregistrierung und -konformität', 1),
  ('Intune-Gerätekonfiguration', 1),
  ('Intune-App-Verwaltung', 1),
  ('Intune-Updateverwaltung', 1),
  ('Windows-Clientbereitstellung', 1),
  ('Windows Autopilot', 1),
  ('Microsoft Deployment Toolkit', 1),
  ('Windows Admin Center', 1),
  ('Windows-Remoteverwaltung', 1),
  ('Windows-Geräteidentität', 1),
  ('Azure Monitor', 1),
  ('Cloud Computing', 1),
  ('Cloud-Service- und Bereitstellungsmodelle', 1),
  ('Cloud-Infrastruktur und Redundanz', 1),
  ('Virtualisierung', 1),
  ('Containerisierung', 1),
  ('Docker', 1),
  ('Kubernetes', 1),
  ('Amazon Web Services', 1),
  ('Microsoft Azure', 1),
  ('Google Cloud Platform', 1),
  ('DevOps und CI/CD', 1),
  ('Infrastructure as Code', 1),
  ('AWS CloudFormation', 1),
  ('Azure Resource Manager', 1),
  ('Terraform', 1),
  ('HashiCorp Packer', 1),
  ('Cloud-init', 1),
  ('Ansible', 1),
  ('Cloud- und Infrastrukturmonitoring', 1),
  ('Prometheus', 1),
  ('Boto3', 1),
  ('Python', 1),
  ('Cloud-Sicherheit', 1),
  ('Cloud-Kosten und Skalierung', 1),
  ('Serverless Computing', 1),
  ('Microservices und ereignisgesteuerte Architekturen', 1),
  ('Relationale Datenbanken und Datenbankentwurf', 1),
  ('SQL', 1),
  ('SQL-Datenabfragen und Datenänderungen', 1),
  ('Datenbankschlüssel und Indizes', 1),
  ('Sichten, Cursor und gespeicherte Prozeduren', 1),
  ('Datenbanktransaktionen und Zugriffsrechte', 1),
  ('Künstliche Intelligenz', 1),
  ('KI-Ethik und Anwendungsfelder', 1),
  ('Maschinelles Lernen', 1),
  ('Überwachtes Lernen', 1),
  ('Unüberwachtes und teilüberwachtes Lernen', 1),
  ('Bestärkendes Lernen', 1),
  ('Datenvorbereitung und Feature Engineering', 1),
  ('Modellauswahl und Modellevaluation', 1),
  ('Lineare Modelle', 1),
  ('Entscheidungsbäume und Ensembles', 1),
  ('Klassifikationsverfahren', 1),
  ('Clustering', 1),
  ('Dimensionsreduktion', 1),
  ('Neuronale Netze und Deep Learning', 1),
  ('Computer Vision', 1),
  ('Verarbeitung natürlicher Sprache', 1),
  ('TensorFlow', 1),
  ('PyTorch', 1),
  ('DATEV', 2),
  ('Lohn- und Gehaltsabrechnung', 2),
  ('Monats- und Jahresabschluss in der Lohnabrechnung', 2),
  ('Englisch für IT-Berufe', 1),
  ('IT-Kundenkommunikation', 1),
  ('Hardware- und Softwareinstallation', 1)
)
update public.topics topic
set parent_id = ('fbb0c720-bcdf-4c96-aac4-16931325ba0' || subjects.area)::uuid,
    version = topic.version + 1
from subjects
where topic.label_de = subjects.label and topic.parent_id is null;

-- Unclassified topics belong to Other. Existing offers without topic tags
-- remain general offers. One shared area is sufficient for mixed offers.
create function private.teaching_subject_matches(p_topics uuid[], p_lecturer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  with recursive
  selected(topic_id, source) as (
    select topic_id, 'offer' from unnest(p_topics) as topic(topic_id)
    union all
    select t.id, 'profile' from public.lecturer_topics lt
    join public.topics t on t.id = lt.topic_id
    where lt.user_id = p_lecturer and t.archived_at is null
  ),
  ancestors(topic_id, source, ancestor_id) as (
    select topic_id, source, topic_id from selected
    union
    select a.topic_id, a.source, t.parent_id
    from ancestors a join public.topics t on t.id = a.ancestor_id
    where t.parent_id is not null
  ),
  areas as (
    select topic_id, source, coalesce(
      min(case ancestor_id
        when 'fbb0c720-bcdf-4c96-aac4-16931325ba01' then 1
        when 'fbb0c720-bcdf-4c96-aac4-16931325ba02' then 2
        when 'fbb0c720-bcdf-4c96-aac4-16931325ba03' then 3
      end), 3) area
    from ancestors
    group by topic_id, source
  )
  select cardinality(p_topics) = 0
    or exists (
      select 1 from areas offer join areas profile using (area)
      where offer.source = 'offer' and profile.source = 'profile'
    );
$$;
create function private.job_subject_matches(p_job uuid, p_lecturer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.teaching_subject_matches(
    array(select topic_id from public.job_requirements where job_id = p_job),
    p_lecturer
  );
$$;
revoke all on function private.teaching_subject_matches(uuid[],uuid),
  private.job_subject_matches(uuid,uuid)
  from public, anon, authenticated, service_role;

-- Preserve the existing authority, contract, pricing and concurrency checks.
do $migration$
declare
  rule record;
  definition text;
begin
  for rule in select * from (values
    ('private.can_read_job(uuid)',
      $old$job.status='published'$old$,
      $new$(job.status = 'published' and (job.urgent_reopened_at is not null or private.job_subject_matches(job.id, auth.uid())))$new$),
    ('private.can_read_course_run(uuid)',
      $old$and not private.course_lecturer_blocked(run.id,auth.uid())$old$,
      $new$and not private.course_lecturer_blocked(run.id,auth.uid())
            and private.teaching_subject_matches(array(
              select requirement.topic_id
              from public.jobs job
              join public.job_requirements requirement on requirement.job_id = job.id
              where job.course_run_id = run.id and job.status = 'published'
              union
              select topic_id from public.course_template_topics where template_id = run.template_id
            ), auth.uid())$new$),
    ('private.claim_job_base(uuid,uuid,integer)',
      $old$exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics lt where lt.user_id=actor and lt.topic_id=r.topic_id))$old$,
      $new$not private.job_subject_matches(j.id, actor)$new$),
    ('private.replacement_eligibility_before_company_rejection_guard(uuid,uuid,uuid)',
      $old$exists(select 1 from public.job_requirements r where r.job_id=p_job and not exists(select 1 from public.lecturer_topics t
  where t.user_id=p_user and t.topic_id=r.topic_id))$old$,
      $new$not private.job_subject_matches(p_job, p_user)$new$),
    ('private.marketplace_eligibility_before_company_rejection_guard(uuid,uuid)',
      $old$not exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(
  select 1 from public.lecturer_topics lt where lt.user_id=p_user and lt.topic_id=r.topic_id))$old$,
      $new$private.job_subject_matches(j.id, p_user)$new$),
    ('private.matching_job_lecturers(uuid)',
      $old$not exists (
      select 1 from public.job_requirements requirement
      where requirement.job_id = j.id and not exists (
        select 1 from public.lecturer_topics topic
        where topic.user_id = p.id and topic.topic_id = requirement.topic_id
      )
    )$old$,
      $new$private.job_subject_matches(j.id, p.id)$new$),
    ('private.assignment_change_validate(uuid,jsonb)',
      $old$if exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics q where q.user_id=c.lecturer_id and q.topic_id=r.topic_id)) then raise exception 'Qualifications do not cover amended work' using errcode='22023';end if;$old$,
      ''),
    ('private.job_waitlist(uuid)',
      $old$can_join=j.status in('filled','published')$old$,
      $new$can_join=private.job_subject_matches(j.id, auth.uid()) and j.status in('filled','published')$new$),
    ('private.job_waitlist(uuid)',
      $old$case when j.status in('published','filled') or private.can_read_job(j.id) then j.title else '' end$old$,
      $new$case when private.can_read_job(j.id) or
        (j.status in('published','filled') and private.job_subject_matches(j.id, auth.uid()))
        then j.title else '' end$new$),
    ('private.readiness_snapshot(uuid)',
      $old$select 1 from public.job_claims c join public.jobs j on j.id=c.job_id join public.job_requirements q on q.job_id=j.id
  where j.course_run_id=r.id and c.status='confirmed' and not exists(select 1 from public.lecturer_topics lt
   where lt.user_id=c.lecturer_id and lt.topic_id=q.topic_id)$old$,
      $new$select 1 from public.job_claims c join public.jobs j on j.id=c.job_id
  where j.course_run_id=r.id and c.status='confirmed' and not private.job_subject_matches(j.id, c.lecturer_id)$new$),
    ('private.readiness_snapshot(uuid)',
      $old$'complete',coalesce(qualification_ok,false),'blocking',true,'responsible','management'$old$,
      $new$'complete',coalesce(qualification_ok,false),'blocking',false,'responsible','lecturer'$new$),
    ('private.job_dashboard()',
      $old$not exists(select 1 from public.job_requirements r where r.job_id=j.id and not exists(select 1 from public.lecturer_topics t where t.user_id=auth.uid()and t.topic_id=r.topic_id))$old$,
      $new$private.job_subject_matches(j.id, auth.uid())$new$),
    ('private.recommended_jobs()',
      $old$not exists(select 1 from public.job_requirements req where req.job_id=j.id and not exists(select 1 from public.lecturer_topics topic where topic.user_id=auth.uid() and topic.topic_id=req.topic_id and (topic.valid_until is null or topic.valid_until>=s.ends)))$old$,
      $new$private.job_subject_matches(j.id, auth.uid())$new$)
  ) as rules(signature, old_check, new_check)
  loop
    definition := pg_get_functiondef(rule.signature::regprocedure);
    if cardinality(string_to_array(definition, rule.old_check)) <> 2 then
      raise exception 'Expected exactly one subject check in %', rule.signature;
    end if;
    execute replace(definition, rule.old_check, rule.new_check);
  end loop;
end;
$migration$;

commit;
