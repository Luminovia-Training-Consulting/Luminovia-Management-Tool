import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

await withTestDatabase("course_workspace", async ({sql, actor}) => {
    const [admin, teacher, learner, second, third, client, foreign] = Array.from(
        {length: 7},
        randomUUID,
    );
    await sql(`insert into auth.users(id,email) values ${[admin, teacher, learner, second, third, client, foreign].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
  update auth.users
  set email_confirmed_at=now()
  where id in (${[learner, second, third].map(q).join(",")});
  insert into public.user_roles(user_id, role)
  values (${q(admin)}, 'admin'),
         (${q(teacher)}, 'lecturer'),
         (${q(learner)}, 'participant'),
         (${q(second)}, 'participant'),
         (${q(third)}, 'participant'),
         (${q(client)}, 'client'),
         (${q(foreign)}, 'lecturer');`);
    const [
        org,
        otherorg,
        template,
        run,
        current,
        session,
        currentSession,
        job,
        claim,
        contact,
        wrongcontact,
        membershipA,
        membershipB,
        membershipCurrent,
    ] = Array.from({length: 14}, randomUUID);
    await sql(`insert into public.organisations(id, name)
               values (${q(org)}, 'Fictional course customer'),
                      (${q(otherorg)}, 'Other private customer');
    insert into public.organisation_contacts(id, organisation_id, name, email, phone, notes)
    values (${q(contact)}, ${q(org)}, 'Fictional course contact', 'course@example.invalid', '+49 40 123', 'Never expose internal notes'),
           (${q(wrongcontact)}, ${q(otherorg)}, 'Foreign private contact', 'foreign@example.invalid', '', '');
    insert into public.client_organisation_memberships(user_id, organisation_id)
    values (${q(client)}, ${q(org)});
    insert into public.course_templates(id, title, syllabus)
    values (${q(template)}, 'Fictional practical Linux', 'Practise safe commands');
    insert into public.course_runs(id, template_id, organisation_id)
    values (${q(run)}, ${q(template)}, ${q(org)}),
           (${q(current)}, ${q(template)}, ${q(org)});
    update public.course_runs
    set venue='https://example.invalid/fictional-course'
    where id = ${q(run)};
    insert into public.course_sessions(id, course_run_id, starts_at, ends_at)
    values (${q(session)}, ${q(run)}, now() - interval '2 days 1 hour', now() - interval '2 days'),
           (${q(currentSession)}, ${q(current)}, now() - interval '30 minutes', now() + interval '30 minutes');
    insert into public.jobs(id, course_run_id, title, customer_name, delivery_type, status, amount, currency, rate_unit, total_amount, terms)
    values (${q(job)}, ${q(run)}, 'Fictional assigned course', 'Fictional customer', 'online', 'filled', 100, 'EUR', 'fixed_total', 100, 'Fictional terms');
    insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, amount, currency, rate_unit, total_amount, terms, terms_version)
    values (${q(claim)}, ${q(job)}, ${q(teacher)}, ${q(randomUUID())}, 100, 'EUR', 'fixed_total', 100, 'Fictional terms', 1);
    insert into public.course_enrolments(course_run_id, user_id, status, enrolled_by)
    values ${[learner, second, third].map((id) => `(${q(run)},${q(id)},'completed',${q(admin)})`).join(",")}, (${q(current)}, ${q(learner)}, 'enrolled', ${q(admin)});
    insert into private.company_participant_link_requests(id, organisation_id, requested_by, request_id, luminovia_user_id, target_user_id, status, expires_at)
    values ('${membershipA}', '${org}', '${admin}', '${randomUUID()}', (select luminovia_user_id from public.profiles where id = '${learner}'), '${learner}', 'accepted', now() + interval '14 days'),
           ('${membershipB}', '${org}', '${admin}', '${randomUUID()}', (select luminovia_user_id from public.profiles where id = '${second}'), '${second}', 'accepted', now() + interval '14 days'),
           ('${membershipCurrent}', '${org}', '${admin}', '${randomUUID()}', (select luminovia_user_id from public.profiles where id = '${third}'), '${third}', 'accepted', now() + interval '14 days');
    insert into private.company_participant_memberships(organisation_id, user_id, status, link_request_id, invited_by, joined_at, version)
    values ('${org}', '${learner}', 'active', '${membershipA}', '${admin}', now(), 1),
           ('${org}', '${second}', 'active', '${membershipB}', '${admin}', now(), 1),
           ('${org}', '${third}', 'active', '${membershipCurrent}', '${admin}', now(), 1);`);
    const rpc = async (who, name, args = []) =>
        JSON.parse(
            await actor(
                who,
                `select to_jsonb(public.${name}(${args.join(",")}))`,
                "aal1",
            ),
        );
    await rpc(admin, "set_company_premium", [
        q(org),
        "true",
        "0",
        q(randomUUID()),
    ]);
    const workspace = (who, course = run) =>
        rpc(who, "course_workspace", [q(course)]);
    const action = (who, name, payload = {}, version = 0, course = run) =>
        rpc(who, "course_workspace_action", [
            q(course),
            q(name),
            q(JSON.stringify(payload)),
            String(version),
        ]);
    let count = 0;
    const check = async (name, fn) => {
        await fn();
        console.log("PASS " + name);
        count++;
    };
    await check(
        "Exact course/org/enrolment rights and explicit administrator permission",
        async () => {
            const learnerWorkspace = await workspace(learner);
            assert.equal(learnerWorkspace.access.learner, true);
            assert.equal(
                learnerWorkspace.venue,
                "https://example.invalid/fictional-course",
            );
            assert.equal((await workspace(teacher)).access.teacher, true);
            assert.equal((await workspace(client)).access.client, true);
            await assert.rejects(workspace(foreign), /42501/);
            assert.equal((await workspace(admin)).access.manager, true);
            assert.equal((await rpc(foreign, "my_course_workspaces")).length, 0);
        },
    );
    await check("Company roster and PDFs only include current participants of that company", async () => {
        const completion = randomUUID();
        await sql(`insert into private.course_completion_records(id, run_id, user_id, snapshot)
          values (${q(completion)}, ${q(run)}, ${q(third)}, '{"participant":"Fictional learner"}')`);
        const coursePdf = (kind, id) => rpc(client, "course_document_access", [q(kind), q(id)]);
        assert.ok((await workspace(client)).roster.some(({user_id}) => user_id === third));
        assert.equal((await coursePdf("completion", completion)).id, completion);
        try {
            await sql(`update private.company_participant_memberships set status='removed', removed_at=now()
              where organisation_id=${q(org)} and user_id=${q(third)}`);
            assert.ok(!(await workspace(client)).roster.some(({user_id}) => user_id === third));
            assert.ok(!(await rpc(client, "course_enrolments", [q(run)])).some(({user_id}) => user_id === third));
            assert.ok(!(await coursePdf("attendance", run)).roster.some(({user_id}) => user_id === third));
            assert.ok(!(await rpc(client, "course_attendance_summary", [q(run)])).rows.some(({user_id}) => user_id === third));
            assert.ok(!(await rpc(client, "course_session_register", [q(run), q(session)])).rows.some(({user_id}) => user_id === third));
            assert.ok(!(await coursePdf("attendance_session", session)).roster.some(({user_id}) => user_id === third));
            await assert.rejects(rpc(client, "save_course_session_attendance", [q(run), q(session), q(third), q("absent"), "null", "null", q(""), q(""), "0"]), /42501/);
            assert.ok(!(await workspace(teacher)).roster.some(({user_id}) => user_id === third));
            await assert.rejects(coursePdf("completion", completion), /42501/);
            assert.ok((await workspace(admin)).roster.some(({user_id}) => user_id === third));
        } finally {
            await sql(`update private.company_participant_memberships set status='active', removed_at=null
              where organisation_id=${q(org)} and user_id=${q(third)};
              delete from private.course_completion_records where id=${q(completion)}`);
        }
    });
    await check("Concurrent spreadsheet retries commit exactly once and failed writes leave no receipt", async () => {
        const key = randomUUID();
        const title = "Fictional imported template";
        const args = [q(key), q("course-template"), "null", q(JSON.stringify({title}))];
        const importRow = (who, input = args) => rpc(who, "import_table_row", input);
        assert.deepEqual(await Promise.all([importRow(admin), importRow(admin)]), [true, true]);
        assert.equal(await sql(`select count(*) from public.course_templates where title=${q(title)}`), "1");
        await assert.rejects(importRow(admin, [...args.slice(0, 3), q('{"title":"Different template"}')]), /PT409/);
        await assert.rejects(importRow(foreign), /42501/);
        assert.equal(await sql(`select count(*) from private.table_import_receipts where row_key=${q(key)}`), "1");

        const retry = [q(randomUUID()), ...args.slice(1, 3)];
        await assert.rejects(importRow(admin, [...retry, q("{}")]), /22023/);
        assert.equal(await importRow(admin, [...retry, q('{"title":"Corrected template"}')]), true);
        assert.equal(await sql("select has_function_privilege('anon', 'public.import_table_row(uuid,text,uuid,jsonb)', 'execute')"), "f");
    });
    await check("An enrolment retry confirms the original write after the eligible candidate disappears", async () => {
        const participantId = await sql(`select luminovia_user_id from public.profiles where id=${q(second)}`);
        const args = [q(randomUUID()), q("enrolment"), q(current), q(JSON.stringify({id: participantId}))];
        const candidates = () => rpc(client, "course_enrolment_candidates", [q(current), q(participantId)]);
        assert.equal((await candidates())[0].user_id, second);
        assert.equal(await rpc(client, "import_table_row", args), true);
        assert.deepEqual(await candidates(), []);
        assert.equal(await rpc(client, "import_table_row", args), true);
        assert.equal(await sql(`select count(*) from public.audit_events
          where action='course.enrolment.changed' and resource_id=${q(current)} and details->>'user_id'=${q(second)}`), "1");
    });
    let preparation;
    await check(
        "Shared checklist is real CAS state; learner cannot write, client sees only selected rows",
        async () => {
            preparation = (
                await action(admin, "preparation_create", {
                    label: "Check lab account",
                    client_visible: true,
                })
            ).id;
            await action(admin, "preparation_create", {
                label: "Private teaching note",
                client_visible: false,
            });
            assert.equal((await workspace(client)).preparation.length, 1);
            assert.equal((await workspace(learner)).preparation.length, 0);
            await assert.rejects(
                action(
                    learner,
                    "preparation_toggle",
                    {id: preparation, done: true},
                    1,
                ),
                /42501/,
            );
            await action(
                teacher,
                "preparation_toggle",
                {id: preparation, done: true},
                1,
            );
            assert.equal((await workspace(client)).preparation[0].done, true);
            await assert.rejects(
                action(
                    teacher,
                    "preparation_toggle",
                    {id: preparation, done: false},
                    1,
                ),
                /40001/,
            );
        },
    );
    await check(
        "Course contact is explicitly selected from matching organisation without private notes",
        async () => {
            assert.equal((await workspace(learner)).contact, null);
            await assert.rejects(
                action(admin, "contact_select", {contact_id: wrongcontact}),
                /42501/,
            );
            await action(admin, "contact_select", {contact_id: contact});
            const shared = (await workspace(learner)).contact;
            assert.equal(shared.email, "course@example.invalid");
            assert.ok(!JSON.stringify(shared).includes("notes"));
        },
    );
    let resource, versionId;
    await check(
        "Exact clean material version grants and receipts do not widen normal document RLS",
        async () => {
            const doc = randomUUID();
            versionId = randomUUID();
            await sql(`insert into public.documents(id, owner_id, uploaded_by, scope, kind, original_name, mime_type, size_bytes, status, client_id)
                       values (${q(doc)}, ${q(admin)}, ${q(admin)}, 'personal', 'material', 'Agreed.pdf', 'application/pdf', 10, 'clean', ${q(randomUUID())});
            insert into public.document_versions(id, document_id, uploaded_by, client_id, version, object_path, original_name, mime_type, size_bytes, status, sha256)
            values (${q(versionId)}, ${q(doc)}, ${q(admin)}, ${q(randomUUID())}, 1, 'fictional/agreed.pdf', 'Agreed.pdf', 'application/pdf', 10, 'clean', ${q("a".repeat(64))});
            update public.documents
            set current_version_id=${q(versionId)}
            where id = ${q(doc)};`);
            resource = (
                await action(admin, "resource_share", {
                    version_id: versionId,
                    audience: "participants",
                    category: "material",
                })
            ).id;
            const materialSearch = (who, course = null, search = "AGREED", category = null, offset = 0) =>
                rpc(who, "search_course_materials", [
                    course ? q(course) : "null", q(search), category ? q(category) : "null", String(offset),
                ]);
            const match = {id: resource, course_id: run, name: "Agreed.pdf", version: 1, category: "material"};
            assert.deepEqual((await materialSearch(learner)).map(({id}) => id), [resource]);
            assert.deepEqual(await materialSearch(learner), [{
                ...match, course_title: "Fictional practical Linux", organisation_name: "Fictional course customer", can_upload: false,
                can_edit_metadata: false, metadata: null, metadata_revision: 0,
            }]);
            assert.equal((await materialSearch(admin, run))[0].can_upload, true);
            assert.equal((await materialSearch(teacher, run))[0].can_upload, true);
            assert.deepEqual(await materialSearch(learner, current), []);
            assert.deepEqual(await materialSearch(learner, run, "%"), []);
            assert.deepEqual(await materialSearch(learner, run, "AGREED", "report"), []);
            assert.deepEqual(await materialSearch(learner, run, "AGREED", "material", 1), []);
            assert.deepEqual(await materialSearch(client, run), []);
            assert.deepEqual(await materialSearch(foreign), []);
            const metadata = { title: "  Fictional workbook  ", description: "Course handout", subject: "Local storage", licence: "CC BY 4.0", language: "en", tags: ["filesystems"] };
            const revise = (who, expected, content = metadata, id = resource) =>
                rpc(who, "set_course_material_metadata", [q(id), expected, `${q(JSON.stringify(content))}::jsonb`]);
            assert.equal((await materialSearch(admin, run))[0].can_edit_metadata, true);
            assert.equal((await materialSearch(teacher, run))[0].can_edit_metadata, false);
            for (const who of [learner, teacher, client, foreign]) {
                await assert.rejects(revise(who, 0), /42501/);
            }
            await assert.rejects(revise(admin, 0, { ...metadata, tags: ["Alpha", "alpha"] }), /22023/);
            assert.equal(await revise(admin, 0), 1);
            assert.equal(await revise(admin, 0), 1);
            const revised = await Promise.allSettled([
                revise(admin, 1, { ...metadata, description: "Edited concurrently A" }),
                revise(admin, 1, { ...metadata, description: "Edited concurrently B" }),
            ]);
            assert.equal(revised.filter(({status}) => status === "fulfilled").length, 1);
            assert.match(revised.find(({status}) => status === "rejected").reason.message, /PT409/);
            const rows = await materialSearch(learner, run, "FILESYSTEMS");
            assert.equal(rows.length, 1);
            assert.deepEqual(rows[0].metadata, { ...metadata, title: "Fictional workbook", description: rows[0].metadata.description });
            assert.match(rows[0].metadata.description, /^Edited concurrently [AB]$/);
            assert.equal(rows[0].metadata_revision, 2);
            assert.deepEqual(await materialSearch(foreign, run, "filesystems"), []);
            assert.equal(await sql(`select content->>'description' from private.course_material_metadata_revisions where resource_id=${q(resource)} and revision=1`), "Course handout");
            assert.equal(await sql(`select count(*) from public.audit_events where resource_id=${q(resource)} and action='course.material_metadata_revised'`), "2");
            await actor(learner, `set local request.path='/rpc/search_course_materials';
              set local request.method='POST';select public.require_portal_access()`);
            assert.equal((await workspace(client)).resources.length, 0);
            assert.equal(
                (await workspace(learner)).resources[0].version_id,
                versionId,
            );
            assert.equal(
                await actor(
                    learner,
                    `select count(*) from public.documents where id=${q(doc)}`,
                ),
                "0",
            );
            assert.equal(
                (
                    await rpc(learner, "course_document_access", [
                        q("resource"),
                        q(resource),
                    ])
                ).id,
                versionId,
            );
            await assert.rejects(
                rpc(client, "course_document_access", [q("resource"), q(resource)]),
                /42501/,
            );
            await action(learner, "resource_acknowledge", {id: resource});
            assert.equal((await workspace(learner)).resources[0].acknowledged, true);
            await action(admin, "resource_remove", {id: resource});
            const acknowledgedPlan = await rpc(admin, "deletion_preview", [q("document"), q(doc)]);
            assert.equal(acknowledgedPlan.can_confirm, false);
            assert.ok(acknowledgedPlan.blockers.some(({kind}) => kind === "private.course_resources"));
            assert.deepEqual(await materialSearch(learner), []);
            assert.deepEqual(await materialSearch(learner, run, "filesystems"), []);
            await assert.rejects(revise(admin, 2), /42501/);
            await assert.rejects(
                rpc(learner, "course_document_access", [q("resource"), q(resource)]),
                /42501/,
            );
        },
    );
    await check("Course files follow exact download and removal authority by audience and current role", async () => {
        const [manager, otherClient] = Array.from({length: 2}, randomUUID);
        await sql(`insert into auth.users(id,email) values
                    (${q(manager)},${q(manager + "@example.invalid")}),
                    (${q(otherClient)},${q(otherClient + "@example.invalid")});
                   insert into public.user_roles(user_id,role) values
                    (${q(manager)},'management'),(${q(otherClient)},'client');
                   insert into public.client_organisation_memberships(user_id,organisation_id)
                    values (${q(otherClient)},${q(otherorg)});`);
        const addMaterial = async (owner, name) => {
            const document = randomUUID(), version = randomUUID();
            const objectPath = `fictional/${name}`, sha256 = "a".repeat(64);
            await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id)
                       values (${q(document)},${q(owner)},${q(owner)},'personal','material',${q(name)},'application/pdf',10,'clean',${q(randomUUID())});
                       insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,status,sha256)
                       values (${q(version)},${q(document)},${q(owner)},${q(randomUUID())},1,${q(objectPath)},${q(name)},'application/pdf',10,'clean',${q(sha256)});
                       update public.documents set current_version_id=${q(version)} where id=${q(document)};`);
            return {document, version, objectPath, sha256};
        };
        const share = async (who, material, audience, category = "material") =>
            (await action(who, "resource_share", {version_id: material.version, audience, category})).id;
        const remove = (who, id, course = run) => action(who, "resource_remove", {id}, 0, course);
        const download = (who, id) => rpc(who, "course_document_access", [q("resource"), q(id)]);
        const deletionPlan = (who, document) => rpc(who, "deletion_preview", [q("document"), q(document)]);
        const confirmDeletion = (who, plan) =>
            rpc(who, "deletion_confirm", [q(plan.plan_id), q(randomUUID()), q("DELETE")]);
        const staffFile = await addMaterial(admin, "Staff.pdf");
        const lecturerFile = await addMaterial(teacher, "Lecturer.pdf");
        const companyFile = await addMaterial(client, "Company.pdf");
        const staffLink = await share(admin, staffFile, "all");
        const staffPrivateLink = await share(admin, staffFile, "staff");
        const participantLink = await share(admin, staffFile, "participants");
        const lecturerLink = await share(teacher, lecturerFile, "all");
        const clientReport = await share(teacher, lecturerFile, "client", "report");
        const companyLink = await share(client, companyFile, "all");

        await assert.rejects(share(teacher, companyFile, "staff"), /42501/);
        await assert.rejects(share(client, lecturerFile, "staff"), /42501/);
        await assert.rejects(share(learner, lecturerFile, "staff"), /42501/);
        const teachingView = (await workspace(teacher)).resources;
        assert.equal(teachingView.find((row) => row.id === staffLink).can_remove, false);
        assert.equal(teachingView.find((row) => row.id === companyLink).ownership_kind, "company");
        assert.equal(teachingView.find((row) => row.id === lecturerLink).can_remove, true);
        const companyView = (await workspace(client)).resources;
        for (const link of [staffLink, lecturerLink, clientReport, companyLink]) {
            assert.equal(companyView.find((row) => row.id === link).can_remove, true);
        }
        const learnerView = (await workspace(learner)).resources;
        assert.equal(learnerView.find((row) => row.id === companyLink).can_remove, false);
        const managerView = (await workspace(manager)).resources;
        for (const link of [staffLink, staffPrivateLink, participantLink, lecturerLink, clientReport, companyLink]) {
            assert.equal(managerView.find((row) => row.id === link).can_remove, true);
        }

        for (const [who, id, material] of [
            [teacher, companyLink, companyFile],
            [client, staffLink, staffFile],
            [client, clientReport, lecturerFile],
            [learner, lecturerLink, lecturerFile],
            [manager, staffPrivateLink, staffFile],
        ]) {
            const receipt = await download(who, id);
            assert.equal(receipt.id, material.version);
            assert.equal(receipt.object_path, material.objectPath);
            assert.equal(receipt.sha256, material.sha256);
        }
        for (const id of [staffPrivateLink, participantLink]) {
            assert.equal(companyView.some((row) => row.id === id), false);
            await assert.rejects(remove(client, id), /42501/);
            await assert.rejects(download(client, id), /42501/);
        }
        await assert.rejects(workspace(otherClient), /42501/);
        await assert.rejects(remove(otherClient, staffLink), /42501/);
        await assert.rejects(download(otherClient, staffLink), /42501/);
        await assert.rejects(remove(client, staffLink, current), /42501/);
        for (const id of [staffLink, companyLink]) await assert.rejects(remove(teacher, id), /42501/);
        await assert.rejects(remove(learner, lecturerLink), /42501/);
        await assert.rejects(sql(`update private.course_resources set ownership_kind='lecturer' where id=${q(companyLink)}`), /42501/);

        await sql(`update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)} and organisation_id=${q(org)}`);
        await assert.rejects(remove(client, staffLink), /42501/);
        await assert.rejects(download(client, staffLink), /42501/);
        await sql(`update public.client_organisation_memberships set removed_at=null where user_id=${q(client)} and organisation_id=${q(org)}`);
        await rpc(admin, "set_company_premium", [q(org), "false", "1", q(randomUUID())]);
        await assert.rejects(share(teacher, lecturerFile, "staff"), /42501/);
        await assert.rejects(remove(client, companyLink), /42501/);
        await rpc(admin, "set_company_premium", [q(org), "true", "2", q(randomUUID())]);

        await remove(teacher, lecturerLink);
        const activeReportPlan = await deletionPlan(teacher, lecturerFile.document);
        assert.equal(activeReportPlan.can_confirm, false);
        assert.ok(activeReportPlan.blockers.some(({kind}) => kind === "private.course_resources"));
        await remove(client, clientReport);
        await remove(client, staffLink);
        await remove(client, companyLink);
        assert.equal(await share(client, companyFile, "all"), companyLink);
        assert.equal((await workspace(client)).resources.find((row) => row.id === companyLink).ownership_kind, "company");
        await remove(client, companyLink);
        await remove(manager, staffPrivateLink);
        await remove(admin, participantLink);
        await assert.rejects(remove(client, staffLink), /42501/);
        await assert.rejects(download(client, staffLink), /42501/);
        await assert.rejects(download(learner, lecturerLink), /42501/);
        assert.deepEqual((await workspace(learner)).resources, []);
        assert.equal(await sql(`select count(*) from public.documents where id = ${q(lecturerFile.document)}`), "1");
        await assert.rejects(deletionPlan(client, lecturerFile.document), /42501/);
        await assert.rejects(deletionPlan(admin, lecturerFile.document), /42501/);

        const ownPlan = await deletionPlan(teacher, lecturerFile.document);
        assert.equal(ownPlan.can_confirm, true);
        assert.equal(ownPlan.counts["private.course_resources"], 2);
        await assert.rejects(confirmDeletion(teacher, activeReportPlan), /40001/);
        const ownCompanyPlan = await deletionPlan(client, companyFile.document);
        assert.equal(ownCompanyPlan.can_confirm, true);
        assert.equal(ownCompanyPlan.counts["private.course_resources"], 1);
        const operation = await confirmDeletion(teacher, ownPlan);
        await assert.rejects(share(teacher, lecturerFile, "all"), /42501/);
        const execution = await rpc(teacher, "deletion_execution", [q(operation.operation_id)]);
        await sql(`begin;set local role service_role;set local request.jwt.claims='{"role":"service_role"}';
                   select public._deletion_apply(${q(operation.operation_id)},${q(execution.permit_id)});commit;`);
        assert.equal(await sql(`select count(*) from public.documents where id = ${q(lecturerFile.document)}`), "0");
        assert.equal(await sql(`select count(*) from private.course_resources where id in (${q(lecturerLink)},${q(clientReport)})`), "0");
        assert.equal(await sql(`select count(*) from public.documents where id = ${q(companyFile.document)}`), "1");
        assert.equal(await sql(`select count(*) from public.audit_events where action = 'course.resource_remove' and resource_id = ${q(clientReport)}`), "1");
        const attendanceFile = await addMaterial(teacher, "Retained-attendance.pdf");
        const attendanceLink = await share(teacher, attendanceFile, "staff");
        await sql(`insert into private.course_attendance_evidence(session_id,resource_id,version_id,attached_by)
                   values (${q(session)},${q(attendanceLink)},${q(attendanceFile.version)},${q(teacher)})`);
        for (const who of [admin, manager, teacher]) {
            assert.equal((await workspace(who)).resources.find(({id}) => id === attendanceLink).can_remove, false);
            await assert.rejects(remove(who, attendanceLink), /23503/);
        }
        const attendancePlan = await deletionPlan(teacher, attendanceFile.document);
        assert.equal(attendancePlan.can_confirm, false);
        assert.ok(attendancePlan.blockers.some(({kind}) => kind === "private.course_attendance_evidence"));
        assert.equal((await download(teacher, attendanceLink)).id, attendanceFile.version);
    });
    await check(
        "Personal notebook is owner-only while course Q&A admits enrolled learners and assigned teachers",
        async () => {
            await action(learner, "notebook", {body: "My private draft"});
            assert.equal(
                (await workspace(learner)).notebook.body,
                "My private draft",
            );
            assert.equal((await workspace(admin)).notebook.body, "");
            const question = (
                await action(learner, "question", {body: "How do permissions work?"})
            ).id;
            await action(
                teacher,
                "answer",
                {id: question, answer: "Use least privilege."},
                1,
            );
            assert.equal(
                (await workspace(second)).questions[0].answer,
                "Use least privilege.",
            );
            assert.equal((await workspace(client)).questions.length, 0);
        },
    );
    await check(
        "Check-in is only self-reported within the actual session window; staff verification is audited and corrected by CAS",
        async () => {
            await action(
                learner,
                "attendance_report",
                {session_id: currentSession},
                0,
                current,
            );
            assert.equal(
                (await workspace(learner, current)).sessions[0].attendance,
                "reported",
            );
            await assert.rejects(
                action(learner, "attendance_report", {session_id: session}),
                /22023/,
            );
            await assert.rejects(
                action(learner, "attendance_verify", {
                    session_id: session,
                    user_id: learner,
                    state: "attended",
                    minutes: 60,
                    reason: "Self approval",
                }),
                /42501/,
            );
            await action(teacher, "attendance_verify", {
                session_id: session,
                user_id: learner,
                state: "absent",
                minutes: 0,
                reason: "Initial roll call",
            });
            await action(
                teacher,
                "attendance_verify",
                {
                    session_id: session,
                    user_id: learner,
                    state: "attended",
                    minutes: 60,
                    reason: "Corrected after signed register check",
                },
                1,
            );
            const state = await workspace(teacher);
            assert.equal(state.attendance_history.length, 2);
            assert.equal(
                state.roster.find((r) => r.user_id === learner).sessions[0].version,
                2,
            );
            assert.equal((await workspace(client)).attendance_history.length, 0);
        },
    );
    await check(
        "Post-course feedback hides author identity and withholds ordinary summaries until three responses",
        async () => {
            await action(learner, "feedback", {
                rating: 5,
                comment: "Useful practical work",
            });
            assert.equal((await workspace(teacher)).feedback_summary.average, null);
            await action(second, "feedback", {
                rating: 4,
                comment: "Helpful examples",
            });
            await action(third, "feedback", {
                rating: 3,
                comment: "More time for practice",
            });
            const summary = (await workspace(teacher)).feedback_summary;
            assert.equal(summary.count, 3);
            assert.equal(Number(summary.average), 4);
            assert.ok(!JSON.stringify(summary).includes(learner));
            await assert.rejects(
                action(
                    learner,
                    "feedback",
                    {rating: 5, comment: "Before completion"},
                    0,
                    current,
                ),
                /42501/,
            );
        },
    );
    await check(
        "Published mini-quiz withholds answers, caps attempts and makes accepted retries idempotent",
        async () => {
            await action(teacher, "quiz_config", {
                questions: [
                    {prompt: "Read a directory?", options: ["ls", "rm"], correct: 0},
                ],
                pass_percent: 80,
                max_attempts: 2,
                published: true,
            });
            assert.ok(
                !Object.hasOwn((await workspace(learner)).quiz.questions[0], "correct"),
            );
            const request = randomUUID();
            assert.equal(
                (
                    await action(
                        learner,
                        "quiz_attempt",
                        {answers: [1], request_id: request},
                        1,
                    )
                ).passed,
                false,
            );
            assert.equal(
                (
                    await action(
                        learner,
                        "quiz_attempt",
                        {answers: [1], request_id: request},
                        1,
                    )
                ).passed,
                false,
            );
            assert.equal(
                (
                    await action(
                        learner,
                        "quiz_attempt",
                        {answers: [0], request_id: randomUUID()},
                        1,
                    )
                ).passed,
                true,
            );
            await assert.rejects(
                action(
                    learner,
                    "quiz_attempt",
                    {answers: [0], request_id: randomUUID()},
                    1,
                ),
                /22023/,
            );
        },
    );
    let completion;
    await check(
        "Completion requires verified attendance, completed enrolment and quiz pass, then preserves immutable facts",
        async () => {
            await assert.rejects(action(second, "completion_issue"), /22023/);
            completion = (await action(learner, "completion_issue")).id;
            assert.equal((await action(learner, "completion_issue")).id, completion);
            const document = await rpc(learner, "course_document_access", [
                q("completion"),
                q(completion),
            ]);
            assert.equal(document.course, "Fictional practical Linux");
            assert.equal(document.verified_minutes, 60);
            assert.equal(document.quiz_passed, true);
            await assert.rejects(
                rpc(second, "course_document_access", [q("completion"), q(completion)]),
                /42501/,
            );
            await assert.rejects(
                action(
                    teacher,
                    "attendance_verify",
                    {
                        session_id: session,
                        user_id: learner,
                        state: "absent",
                        minutes: 0,
                        reason: "Correction after issue",
                    },
                    2,
                ),
                /22023/,
            );
            await action(teacher, "completion_revoke", {
                id: completion,
                reason: "Attendance evidence requires correction",
            });
            await assert.rejects(action(learner, "completion_issue"), /22023/);
            await assert.rejects(
                rpc(learner, "course_document_access", [
                    q("completion"),
                    q(completion),
                ]),
                /42501/,
            );
            await action(
                teacher,
                "attendance_verify",
                {
                    session_id: session,
                    user_id: learner,
                    state: "absent",
                    minutes: 0,
                    reason: "Corrected attendance evidence",
                },
                2,
            );
            await assert.rejects(action(learner, "completion_issue"), /22023/);
            await action(
                teacher,
                "attendance_verify",
                {
                    session_id: session,
                    user_id: learner,
                    state: "attended",
                    minutes: 60,
                    reason: "New documented verification after correction",
                },
                3,
            );
            const replacement = (await action(learner, "completion_issue")).id;
            assert.notEqual(replacement, completion);
        },
    );
    await check(
        "Client repeat booking creates only a fresh idempotent request with future dates and retained quote",
        async () => {
            const original = randomUUID(),
                key = randomUUID();
            const payload = {
                title: "Delivered fictional request",
                description: "Original scope",
                delivery_type: "online",
                location: "https://example.invalid/class",
                time_zone: "Europe/Berlin",
                sessions: [],
                topic_ids: [],
                gross_amount: 100,
                gross_total_amount: 100,
                currency: "EUR",
                rate_unit: "fixed_total",
            };
            await sql(
                `insert into public.job_sessions(job_id, starts_at, ends_at)
                 values (${q(job)}, now() - interval '2 days 1 hour', now() - interval '2 days');
                insert into private.client_course_requests(id, organisation_id, requested_by, client_id, payload, status, job_id)
                values (${q(original)}, ${q(org)}, ${q(client)}, ${q(randomUUID())}, ${q(JSON.stringify(payload))}, 'published', ${q(job)});`,
            );
            const sessions = [
                {
                    starts_at: new Date(Date.now() + 7 * 86400000).toISOString(),
                    ends_at: new Date(Date.now() + 7 * 86400000 + 3600000).toISOString(),
                },
            ];
            const operation = portalOpenApi("https://portal.example.invalid").paths[
                "/rest/v1/rpc/repeat_client_request"
            ].post;
            const request = z.fromJSONSchema(operation.requestBody.content["application/json"].schema);
            const response = z.fromJSONSchema(operation.responses["200"].content["application/json"].schema);
            request.parse({p_request_id: original, p_sessions: sessions, p_client_id: key});
            const created = response.parse(await rpc(client, "repeat_client_request", [
                q(original),
                q(JSON.stringify(sessions)),
                q(key),
            ]));
            assert.equal(
                await rpc(client, "repeat_client_request", [
                    q(original),
                    q(JSON.stringify(sessions)),
                    q(key),
                ]),
                created,
            );
            const record = JSON.parse(
                await sql(
                    `select jsonb_build_object('status',status,'job_id',job_id,'payload',payload)from private.client_course_requests where id=${q(created)}`,
                ),
            );
            assert.equal(record.status, "submitted");
            assert.equal(record.job_id, null);
            assert.equal(record.payload.gross_total_amount, 100);
            assert.equal(record.payload.title, payload.title);
            await assert.rejects(
                rpc(foreign, "repeat_client_request", [
                    q(original),
                    q(JSON.stringify(sessions)),
                    q(randomUUID()),
                ]),
                /42501/,
            );
        },
    );
    await check(
        "Membership and account revocation remove course documents with existing identities",
        async () => {
            await sql(
                `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)};update public.course_enrolments set status='removed' where user_id=${q(learner)};`,
            );
            await assert.rejects(workspace(client), /42501/);
            await assert.rejects(workspace(learner), /42501/);
            await sql(
                `update public.profiles set active=false where id=${q(teacher)}`,
            );
            await assert.rejects(workspace(teacher), /42501/);
        },
    );
    console.log(`Passed ${count} real course workspace PostgreSQL groups.`);
});
