/** Privileged setup only for independently owned fictional SQL/API fixtures. */
import {randomUUID} from "node:crypto";

export async function seedCalendarMetadata(sql, teacher, peer) {
    const ids = Object.fromEntries(
        [
            "organisation",
            "template",
            "run",
            "linked",
            "manual",
            "foreign",
            "requiredTopic",
            "templateTopic",
        ].map((key) => [key, randomUUID()]),
    );
    const {
        organisation,
        template,
        run,
        linked,
        manual,
        foreign,
        requiredTopic,
        templateTopic,
    } = ids;
    await sql(`insert into public.organisations(id, name)
               values ('${organisation}', 'Fictional calendar company');
 insert into public.course_templates(id,title) values('${template}','Fictional course template');
 insert into public.course_runs(id,template_id,organisation_id) values('${run}','${template}','${organisation}');
 insert into public.topics(id,label_de,label_en,kind) values('${requiredTopic}','Kalendertechnik','Calendar technology','topic'),('${templateTopic}','Kurswerkzeug','Course tool','tool');
 insert into public.course_template_topics(template_id,topic_id) values('${template}','${requiredTopic}'),('${template}','${templateTopic}');
 insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms,course_run_id)
 values('${linked}','Own linked assignment','Original customer','online','filled',10,10,'EUR','fixed_total','PRIVATE TERMS','${run}'),
 ('${manual}','Own manual assignment','Fictional manual customer','online','filled',20,20,'EUR','fixed_total','PRIVATE TERMS',null),
 ('${foreign}','Foreign assignment','Hidden foreign customer','online','filled',30,30,'EUR','fixed_total','PRIVATE TERMS','${run}');
 insert into public.job_requirements(job_id,topic_id) values('${linked}','${requiredTopic}');
 insert into public.job_claims(job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
 values('${linked}','${teacher}','${randomUUID()}',10,10,'EUR','fixed_total','PRIVATE TERMS',1),('${manual}','${teacher}','${randomUUID()}',20,20,'EUR','fixed_total','PRIVATE TERMS',1),('${foreign}','${peer}','${randomUUID()}',30,30,'EUR','fixed_total','PRIVATE TERMS',1);
 insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at)
 select claim.id,claim.lecturer_id,slot.starts_at,slot.starts_at+interval '1 hour'
 from public.job_claims claim join (values
   ('${linked}'::uuid,now()+interval '3 days'),
   ('${manual}'::uuid,now()+interval '4 days'),
   ('${foreign}'::uuid,now()+interval '20 days')
 ) slot(job_id,starts_at) on slot.job_id=claim.job_id;`);
    return ids;
}

export async function cleanupCalendarMetadata(sql, ids) {
    const {
        organisation,
        template,
        run,
        linked,
        manual,
        foreign,
        requiredTopic,
        templateTopic,
    } = ids;
    await sql(
        `delete
         from public.assignment_sessions
         where claim_id in (
             select id
             from public.job_claims
             where job_id in ('${linked}', '${manual}', '${foreign}')
         );
        delete
         from public.job_claims
         where job_id in ('${linked}', '${manual}', '${foreign}');
        delete
        from public.job_requirements
        where job_id = '${linked}';
        delete
        from public.jobs
        where id in ('${linked}', '${manual}', '${foreign}');
        delete
        from public.course_runs
        where id = '${run}';
        delete
        from public.course_template_topics
        where template_id = '${template}';
        delete
        from public.course_templates
        where id = '${template}';
        delete
        from public.organisations
        where id = '${organisation}';
        delete
        from public.topics
        where id in ('${requiredTopic}', '${templateTopic}');`,
    );
}
