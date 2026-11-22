/** Replay actual migrations and prove role-separated completed-course evaluations. */
import assert from "node:assert/strict";
import {generateKeyPairSync, randomUUID} from "node:crypto";
import {configureAcademyCourseAccess, prepareAcademyInstallation} from "./academy-installation.mjs";
import {signAcademyLicence} from "./academy-licence.mjs";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

const denied = /42501/;
const gate = (name, method = "POST", profile = "public") =>
    `set local request.path=${q(`/rpc/${name}`)}; set local request.method=${q(method)};
     set local request.headers=${q(JSON.stringify({"accept-profile": profile}))};select public.require_portal_access();`;
const value = (entry) => entry === null ? "null" : typeof entry === "string" ? q(entry) : String(entry);

for (const edition of ["internal", "customer-managed", "customer-self-hosted"]) {
    await withTestDatabase("course_evaluations", async ({sql, actor}) => {
        const [admin, manager, teacher, colleague, foreignTeacher, learner, peerLearner, withdrawn, company, foreignCompany] =
            Array.from({length: 10}, randomUUID);
        const [organisation, foreignOrganisation, template, run, futureRun, foreignRun, classId, foreignClass, lateSession] =
            Array.from({length: 9}, randomUUID);
        const identities = [
            [admin,"admin","Fictional admin"], [manager,"management","Fictional manager"],
            [teacher,"lecturer","Fictional instructor A"], [colleague,"lecturer","Fictional instructor B"],
            [foreignTeacher,"lecturer","Fictional outsider"], [learner,"participant","Fictional learner A"],
            [peerLearner,"participant","Fictional learner B"], [withdrawn,"participant","Fictional withdrawn learner"],
            [company,"client","Fictional contact"], [foreignCompany,"client","Fictional foreign contact"],
        ];
        const now = Date.now();
        const date = (n) => new Date(now + n * 86_400_000).toISOString();
        const terms = {
            installation_id: randomUUID(), edition, release_commit: "56".repeat(20),
            issued_at: date(-5), starts_at: date(-4), expires_at: date(4), grace_until: date(5),
            modules: ["lms"], limits: {seat_count: 40, storage_bytes: 1_000_000, api_requests_per_minute: 50},
        };
        if (edition !== "internal") {
            const vendor = generateKeyPairSync("ed25519");
            const options = {
                envelope: signAcademyLicence(terms, vendor.privateKey),
                publicKey: vendor.publicKey, expected: terms, now,
            };
            await prepareAcademyInstallation(options, sql);
            await configureAcademyCourseAccess({...options, enabled: true}, sql);
        }
        await sql(`
          insert into auth.users(id,email,email_confirmed_at) values
            ${identities.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
          insert into public.user_roles(user_id,role) values
            ${identities.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
          update public.profiles profile set display_name = names.label
          from (values ${identities.map(([id, ,label]) => `(${q(id)}::uuid,${q(label)})`).join(",")}) names(id,label)
          where profile.id = names.id;
          insert into public.organisations(id,name) values
            (${q(organisation)},'Fictional course company'),(${q(foreignOrganisation)},'Fictional other company');
          insert into public.client_organisation_memberships(user_id,organisation_id) values
            (${q(company)},${q(organisation)}),(${q(foreignCompany)},${q(foreignOrganisation)});
          insert into public.course_templates(id,title) values (${q(template)},'Fictional training');
          insert into public.course_runs(id,template_id,organisation_id) values
            (${q(run)},${q(template)},${q(organisation)}),(${q(futureRun)},${q(template)},${q(organisation)}),
            (${q(foreignRun)},${q(template)},${q(foreignOrganisation)});
          insert into public.course_sessions(course_run_id,starts_at,ends_at) values
            (${q(run)},now()-interval '2 days',now()-interval '47 hours'),
            (${q(foreignRun)},now()-interval '2 days',now()-interval '47 hours');
          insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
            (${q(lateSession)},${q(futureRun)},now()+interval '2 days',now()+interval '49 hours');
          insert into private.course_classes(id,organisation_id,name) values
            (${q(classId)},${q(organisation)},'Fictional class'),(${q(foreignClass)},${q(foreignOrganisation)},'Foreign class');
          insert into private.course_class_assignments(course_id,organisation_id,class_id,version)
            values (${q(run)},${q(organisation)},${q(classId)},1);
        `);
        const allocations = [[teacher,run],[colleague,run],[teacher,futureRun],[foreignTeacher,foreignRun]];
        for (const [instructor, course] of allocations) {
            const job = randomUUID(), claim = randomUUID();
            await sql(`
              insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
                values(${q(job)},${q(course)},'Fictional teaching','Fictional training','online','filled',100,'EUR','fixed_total',100,'Fictional course');
              insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version)
                values(${q(claim)},${q(job)},${q(instructor)},${q(randomUUID())},100,'EUR','fixed_total',100,'Fictional course',1);
              ${edition === "internal" ? "" :
                `insert into private.academy_course_instructors(course_id,instructor_id,claim_id,assigned_by,request_id)
                  values (${q(course)},${q(instructor)},${q(claim)},${q(admin)},${q(randomUUID())});`}
            `);
        }
        for (const [person, status] of [[learner,"enrolled"], [peerLearner,"completed"], [withdrawn,"removed"]]) {
            const link = randomUUID();
            await sql(`
              insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
                select ${q(link)},${q(organisation)},${q(admin)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
                from public.profiles where id=${q(person)};
              insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
                values(${q(organisation)},${q(person)},'active',${q(link)},${q(admin)},now());
              insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by)
                values(${q(run)},${q(person)},${q(status)},${q(admin)});
            `);
        }

        const command = (name, args) => `select to_jsonb(public.${name}(${args.map(value).join(",")}))`;
        const rpc = (who, name, ...args) => actor(who, gate(name) + command(name, args)).then(JSON.parse);
        const list = (who, course = run) => rpc(who, "course_evaluations", course);
        const save = (who, role, kind, id, score = 5, revision = 0, comment = "", course = run) =>
            rpc(who, "save_course_evaluation", course, role, kind, id, score, revision, comment);
        const comments = (who, role, kind, subject, cursor = null, course = run) =>
            rpc(who, "course_evaluation_comments", course, role, kind, subject, cursor);

        if (edition === "internal") {
            await assert.rejects(list(admin), denied);
            await rpc(admin, "set_company_premium", organisation, true, 0, randomUUID());
            await rpc(admin, "set_company_premium", foreignOrganisation, true, 0, randomUUID());
        }
        assert.deepEqual(await list(company, futureRun), {
            completed:false, writable:false, targets:[], mine:[], summaries:[],
        });
        await assert.rejects(save(teacher, "lecturer", "course", futureRun, 3, 0, "", futureRun), denied);
        await assert.rejects(list(withdrawn), denied);
        await assert.rejects(list(foreignCompany), denied);
        await assert.rejects(list(foreignTeacher), denied);
        await assert.rejects(list(learner, foreignRun), denied);
        assert.equal((await list(learner)).targets.length, 3, "A currently enrolled learner can review after the last session");
        assert.equal((await list(company)).targets.length, 2);
        assert.deepEqual(new Set((await list(teacher)).targets.map(({subject_id}) => subject_id)), new Set([run, organisation, classId]));
        await assert.rejects(save(learner, "company", "lecturer", teacher), denied);
        await assert.rejects(save(learner, "learner", "lecturer", foreignTeacher), denied);
        await assert.rejects(save(company, "company", "company", organisation), denied);
        await assert.rejects(save(teacher, "lecturer", "class", foreignClass), denied);
        await assert.rejects(save(teacher, "lecturer", "lecturer", colleague), denied);
        await assert.rejects(save(admin, "admin", "company", organisation), /22023/);
        await assert.rejects(save(learner, "learner", "lecturer", teacher, 6), /22023/);
        await assert.rejects(save(learner, "learner", "lecturer", teacher, 5, 0, "a".repeat(2001)), /22023/);

        assert.deepEqual(await save(learner, "learner", "lecturer", teacher, 5, 0, " Strong teaching "), {
            rater_role:"learner",subject_kind:"lecturer",subject_id:teacher,
            label:"Fictional instructor A",score:5,comment:"Strong teaching",version:1,
        });
        await save(learner, "learner", "company", organisation, 4, 0, "Helpful coordination");
        await save(peerLearner, "learner", "lecturer", teacher, 3, 0, "Clear slides");
        await save(company, "company", "lecturer", teacher, 4, 0, "Good delivery");
        await save(teacher, "lecturer", "course", run, 4, 0, "Advanced, at a good pace");
        await save(teacher, "lecturer", "company", organisation, 5, 0, "Prepared course environment");
        await save(teacher, "lecturer", "class", classId, 4, 0, "Ready for the next lab");
        assert.equal((await rpc(colleague,"save_course_evaluation",run,"lecturer","class",classId,5,0)).comment, "");
        await assert.rejects(save(learner,"learner","lecturer",teacher), /PT409/);
        const race = await Promise.allSettled([
            save(learner, "learner", "lecturer", teacher, 5, 1, "Strong teaching"),
            save(learner, "learner", "lecturer", teacher, 5, 1, "Strong teaching"),
        ]);
        assert.equal(race.filter(({status}) => status === "fulfilled").length, 1);
        assert.match(String(race.find(({status}) => status === "rejected").reason), /PT409/);
        assert.equal((await list(learner)).mine.find(({subject_id}) => subject_id === teacher).version, 2);

        const learnerView = await list(peerLearner);
        assert.deepEqual(learnerView.summaries.find(({rater_role}) => rater_role === "learner"), {
            rater_role:"learner",subject_kind:"lecturer",subject_id:teacher,label:"Fictional instructor A",
            count:2,average:4,can_read_comments:false,
        });
        assert.ok(learnerView.summaries.every(({subject_kind, can_read_comments}) => subject_kind === "lecturer" && !can_read_comments));
        assert.equal(learnerView.mine[0].comment, "Clear slides");
        assert.equal(JSON.stringify(learnerView).includes("Strong teaching"), false);
        assert.equal(JSON.stringify(learnerView).includes(learner), false);
        await assert.rejects(comments(peerLearner,"learner","lecturer",teacher), denied);

        const teacherProse = await comments(teacher,"learner","lecturer",teacher);
        assert.deepEqual(new Set(teacherProse.items.map(({comment}) => comment)), new Set(["Strong teaching","Clear slides"]));
        assert.deepEqual(Object.keys(teacherProse.items[0]).sort(), ["comment", "id"]);
        assert.deepEqual((await comments(teacher,"company","lecturer",teacher)).items.map(({comment}) => comment), ["Good delivery"]);
        assert.deepEqual((await comments(colleague,"lecturer","class",classId)).items.map(({comment}) => comment), ["Ready for the next lab"]);
        await assert.rejects(comments(colleague,"learner","lecturer",teacher), denied);
        await assert.rejects(comments(teacher,"learner","company",organisation), denied);
        const companyView = await list(company);
        assert.deepEqual(companyView.summaries.map(({rater_role,subject_kind,can_read_comments}) => [rater_role,subject_kind,can_read_comments]),
            [["learner","company",true]]);
        assert.equal((await comments(company,"learner","company",organisation)).items[0].comment, "Helpful coordination");
        await assert.rejects(comments(company,"lecturer","company",organisation), denied);
        assert.equal((await list(manager)).summaries.length, 6);
        assert.equal((await comments(admin,"learner","company",organisation)).items[0].comment, "Helpful coordination");
        assert.equal(await sql("select count(*) from private.course_evaluation_revisions"), "9");
        assert.equal(await sql("select count(*) from public.audit_events where action='course.evaluation_saved'"), "0");
        await assert.rejects(actor(admin, "select * from private.course_evaluation_revisions"), denied);
        console.log(`PASS ${edition} completed-run evaluation roles, version conflicts, author privacy and recipient-directed feedback`);

        await sql(`insert into private.course_feedback(run_id,user_id,kind,rating,comment)
          values(${q(run)},${q(learner)},'participant',5,'legacy private fixture prose')`);
        assert.equal(JSON.stringify(await list(admin)).includes("legacy private fixture prose"), false);
        assert.equal(JSON.stringify(await comments(teacher,"learner","lecturer",teacher)).includes("legacy private fixture prose"), false);
        await assert.rejects(actor(admin, "select * from private.course_evaluations"), denied);
        await assert.rejects(actor(peerLearner, gate("course_evaluations","GET") + command("course_evaluations",[run])), denied);
        await assert.rejects(actor(peerLearner, gate("course_evaluations","POST","private") + command("course_evaluations",[run])), denied);
        await assert.rejects(sql("begin;set local role anon;select public.course_evaluations(null);commit;"), denied);
        await sql(`insert into public.user_roles(user_id,role) values (${q(peerLearner)},'lecturer')`);
        assert.equal((await list(peerLearner)).targets.some(({rater_role}) => rater_role === "lecturer"), false);
        assert.equal((await save(peerLearner,"learner","company",organisation,4)).score, 4,
            "An additional teaching role preserves the verified learner relationship");
        await assert.rejects(save(peerLearner,"lecturer","course",run), denied);


        if (edition === "internal") {
            await sql(`
              create temp table many_evaluators as select gen_random_uuid() as user_id from generate_series(1, 25);
              insert into auth.users(id,email) select user_id,user_id::text || '@example.invalid' from many_evaluators;
              insert into private.course_evaluations(run_id,user_id,rater_role,subject_kind,subject_id,score,comment)
                select ${q(run)},user_id,'learner','lecturer',${q(teacher)},4,'Fictional paged remark' from many_evaluators;
            `);
            const first = await comments(teacher,"learner","lecturer",teacher);
            const second = await comments(teacher,"learner","lecturer",teacher,first.next);
            assert.equal(first.items.length, 25);
            assert.equal(second.items.length, 2);
            assert.equal(new Set([...first.items,...second.items].map(({id}) => id)).size, 27);
            assert.equal(second.next, null);
            await rpc(admin, "set_company_premium", organisation, false, 1, randomUUID());
            await assert.rejects(list(admin), denied);
            await assert.rejects(save(teacher,"lecturer","course",run,5,1), denied);
            await rpc(admin, "set_company_premium", organisation, true, 2, randomUUID());
        } else {
            const grace = {...terms, issued_at: date(-3), starts_at: date(-2), expires_at: date(-1)};
            await sql(`select private.apply_verified_installation_licence(${q(JSON.stringify(grace))}::jsonb)`);
            assert.equal((await list(learner)).writable, false);
            assert.equal((await comments(company,"learner","company",organisation)).items[0].comment, "Helpful coordination");
            await assert.rejects(save(teacher,"lecturer","course",run,5,1), denied);
            const renewed = {...terms, issued_at: date(-2), starts_at: date(-1)};
            await sql(`select private.apply_verified_installation_licence(${q(JSON.stringify(renewed))}::jsonb)`);
        }

        await sql(`update public.course_enrolments set status='removed' where user_id=${q(learner)} and course_run_id=${q(run)};
          update public.job_claims set status='cancelled' where lecturer_id=${q(teacher)}
            and job_id in (select id from public.jobs where course_run_id=${q(run)});`);
        await assert.rejects(list(learner), denied);
        await assert.rejects(list(teacher), denied);
        await assert.rejects(save(peerLearner,"learner","lecturer",teacher,4,1), denied);
        assert.ok((await list(peerLearner)).summaries.every(({subject_id}) => subject_id !== teacher));
        assert.ok((await list(manager)).summaries.some(({subject_id}) => subject_id === teacher));
        assert.ok((await comments(admin, "learner", "lecturer", teacher)).items.length > 0);

        console.log(`PASS ${edition} retained legacy privacy, exact POST gating, entitlement and revoked enrolment/assignment`);
    });
}
