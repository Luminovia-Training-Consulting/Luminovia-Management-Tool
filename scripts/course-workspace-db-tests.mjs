/** Exercise course workspace RPCs with fictional actors in an isolated database. */
import assert from "node:assert/strict";
import {generateKeyPairSync, randomUUID} from "node:crypto";
import {z} from "zod";
import {courseXapiArchiveSchema} from "../src/features/learning/xapi-schema.ts";
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
    const gradebook = (who, course = run, offset = 0, limit = 20) =>
        rpc(who, "course_gradebook", [q(course), String(offset), String(limit)]);
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
                can_edit_metadata: false, can_read_metadata_history: false, can_reuse: false, metadata: null, metadata_revision: 0,
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
            const history = (who, before = "null") => rpc(who, "course_material_metadata_history", [q(resource), before]);
            for (const who of [learner, client, foreign]) {
                await assert.rejects(history(who), /42501/);
            }
            assert.equal((await history(teacher)).length, 2);
            assert.equal((await history(admin, 2))[0].revision, 1);
            assert.equal((await materialSearch(admin, run))[0].can_read_metadata_history, true);
            assert.equal(rows[0].can_read_metadata_history, false);
            await assert.rejects(revise(admin, 2, { ...metadata, review_on: "2027-02-29" }), /22023/);
            const reviewed = { ...metadata, review_on: "2028-02-29", learning_objectives: "Explain persistent volumes" };
            assert.equal(await revise(admin, 2, reviewed), 3);
            assert.equal((await materialSearch(learner, run, "persistent volumes"))[0].id, resource);
            assert.equal(await revise(admin, 3, { ...metadata, description: "Older editor update" }), 4);
            assert.equal((await history(admin))[0].content.review_on, reviewed.review_on);
            assert.equal((await history(admin))[0].content.learning_objectives, reviewed.learning_objectives);
            assert.equal(await revise(admin, 4, { ...metadata, review_on: "", learning_objectives: "" }), 5);
            assert.equal((await history(admin))[0].content.review_on, undefined);
            assert.equal((await history(admin))[0].content.learning_objectives, undefined);
            const targets = (who) => rpc(who, "course_material_reuse_targets", [q(resource), q("")]);
            const reuse = (who, destination) => rpc(who, "reuse_course_material", [q(resource), q(destination), "true"]);
            const foreignRun = randomUUID();
            await sql(`insert into public.course_runs(id, template_id, organisation_id)
              values (${q(foreignRun)},${q(template)},${q(otherorg)});`);
            assert.equal((await materialSearch(admin, run))[0].can_reuse, true);
            await assert.rejects(targets(teacher), /42501/);
            await assert.rejects(reuse(learner, current), /42501/);
            await assert.rejects(reuse(admin, foreignRun), /42501/);
            assert.deepEqual((await targets(admin)).map(({id, shared}) => [id, shared]), [[current, false]]);
            const [reused, retried] = await Promise.all([reuse(admin, current), reuse(admin, current)]);
            assert.equal(reused, retried);
            assert.notEqual(reused, resource);
            assert.equal((await workspace(learner, current)).resources[0].version_id, versionId);
            assert.equal((await materialSearch(admin, current))[0].metadata.description, metadata.description);
            assert.deepEqual((await targets(admin)).map(({id, shared}) => [id, shared]), [[current, true]]);
            await revise(admin, 1, { ...metadata, title: "Destination-only title" }, reused);
            assert.equal((await materialSearch(admin, run))[0].metadata.title, "Fictional workbook");
            assert.equal(await reuse(admin, current), reused);
            assert.equal((await materialSearch(admin, current))[0].metadata.title, "Destination-only title");
            await action(admin, "resource_remove", { id: reused }, 0, current);
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
            const completionStatus = (who, target = null, scope = run) =>
                rpc(who, "course_completion_status", [q(scope), target === null ? "null" : q(target)]);
            const ready = await completionStatus(learner);
            assert.deepEqual(ready, {
                enrolment_completed: true, session_count: 1, ended_count: 1, verified_count: 1,
                ends_at: ready.ends_at, quiz_version: 1, quiz_passed: true, reverify_required: false,
                rule_version: 1, state: "ready",
            });
            assert.ok(Date.parse(ready.ends_at) < Date.now());
            assert.deepEqual(await completionStatus(teacher, learner), ready);
            const missing = await completionStatus(second);
            assert.equal(missing.state, "pending");
            assert.equal(missing.verified_count, 0);
            assert.equal(missing.quiz_passed, false);
            await assert.rejects(completionStatus(second, learner), /42501/);
            await assert.rejects(completionStatus(client, learner), /42501/);
            await assert.rejects(completionStatus(foreign, learner), /42501/);
            await assert.rejects(completionStatus(learner, null, randomUUID()), /42501/);
            await assert.rejects(action(second, "completion_issue"), /22023/);
            completion = (await action(learner, "completion_issue")).id;
            assert.equal((await action(learner, "completion_issue")).id, completion);
            assert.equal((await completionStatus(learner)).state, "issued");
            const future = randomUUID();
            await sql(`insert into public.course_sessions(id, course_run_id, starts_at, ends_at)
              values (${q(future)}, ${q(run)}, now() + interval '1 day', now() + interval '25 hours')`);
            assert.equal((await completionStatus(learner)).state, "issued");
            const futureMissing = await completionStatus(second);
            assert.equal(futureMissing.session_count, 2);
            assert.equal(futureMissing.ended_count, 1);
            assert.ok(Date.parse(futureMissing.ends_at) > Date.now());
            await sql(`delete from public.course_sessions where id=${q(future)}`);
            const xapi = (who, from, until) => rpc(who, "course_xapi_statements", [
                q(run), q(from ?? new Date(Date.now() - 86_400_000).toISOString()),
                q(until ?? new Date(Date.now() + 86_400_000).toISOString()),
            ]);
            for (const who of [learner, teacher, client, foreign]) {
                await assert.rejects(xapi(who), /42501/);
            }
            await assert.rejects(xapi(admin, "2020-01-01T00:00:00Z", "2026-01-01T00:00:00Z"), /22023/);
            const archive = courseXapiArchiveSchema.parse(await xapi(admin));
            assert.deepEqual(await xapi(admin), archive);
            const completedStatement = archive.statements.find((entry) => entry.verb.id.endsWith("/completed"));
            const attemptedStatement = archive.statements.find((entry) => entry.verb.id.endsWith("/attempted"));
            assert.ok(completedStatement && attemptedStatement);
            assert.deepEqual(completedStatement.actor, attemptedStatement.actor);
            assert.notEqual(completedStatement.actor.account.name, learner);
            assert.ok(!JSON.stringify(archive).includes(learner));
            assert.ok(!JSON.stringify(archive).includes("Fictional practical Linux"));
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
            const revoked = courseXapiArchiveSchema.parse(await xapi(admin)).statements.find((entry) => entry.verb.id.endsWith("/voided"));
            assert.equal(revoked.object.id, completedStatement.id);
            assert.notDeepEqual(revoked.actor, completedStatement.actor);
            assert.equal((await completionStatus(learner)).reverify_required, true);
            assert.equal((await completionStatus(learner)).state, "pending");
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
            const reverifiedAbsent = await completionStatus(learner);
            assert.equal(reverifiedAbsent.reverify_required, false);
            assert.equal(reverifiedAbsent.verified_count, 0);
            assert.equal(reverifiedAbsent.state, "pending");
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
            assert.deepEqual(await completionStatus(learner), ready);
            const replacement = (await action(learner, "completion_issue")).id;
            assert.notEqual(replacement, completion);
        },
    );
    await check("Gradebook scopes previews and publishes and corrects a learner's grade by policy and revision", async () => {
        // Reuse the mini-quiz's two attempts and give the peer a separate attempt to check learner scope.
        const peerAttempt = await action(second, "quiz_attempt", {answers: [1], request_id: randomUUID()}, 1);
        const initial = await gradebook(teacher);
        const learnerRow = (page) => page.learners.find(({user_id}) => user_id === learner);
        const readLearnerRow = async () => learnerRow(await gradebook(teacher));
        const own = () => gradebook(learner);
        const best = learnerRow(initial).best_attempt;
        const peerRow = initial.learners.find(({user_id}) => user_id === second);
        assert.equal(initial.can_manage, true);
        assert.equal(initial.policy, null);
        assert.equal(initial.own_grade, null);
        assert.equal(best.quiz_version, 1);
        assert.equal(best.score, 100);
        assert.equal(best.passed, true);
        assert.equal(peerRow.best_attempt.id, peerAttempt.id);
        assert.equal(peerRow.best_attempt.score, 0);
        assert.equal(learnerRow(initial).preview, null);
        assert.equal(learnerRow(initial).grade, null);
        const page = await gradebook(teacher, run, 1, 1);
        assert.equal(page.total, 3);
        assert.equal(page.offset, 1);
        assert.equal(page.limit, 1);
        assert.deepEqual(page.learners, initial.learners.slice(1, 2));

        const bandPolicy = {scheme: "bands", bands: [{minimum: 80, label: "Pass"}, {minimum: 0, label: "Review"}]};
        const percentPolicy = {scheme: "percentage", bands: []};
        const publish = {user_id: learner, attempt_id: best.id, expected_revision: 0, reason: ""};
        for (const who of [foreign, client]) await assert.rejects(gradebook(who), /42501/);
        await assert.rejects(gradebook(teacher, current), /42501/);
        await assert.rejects(action(teacher, "gradebook_policy", bandPolicy, 0, current), /42501/);
        for (const who of [foreign, client, learner]) {
            await assert.rejects(action(who, "gradebook_policy", bandPolicy), /42501/);
        }
        assert.equal((await action(teacher, "gradebook_policy", bandPolicy)).version, 1);
        const bandPage = await gradebook(teacher);
        const {version, scheme, bands} = bandPage.policy;
        assert.deepEqual({version, scheme, bands}, {version: 1, ...bandPolicy});
        assert.deepEqual(learnerRow(bandPage).preview, {grade_percent: null, grade_label: "Pass"});
        assert.deepEqual(await own(), {
            can_manage: false, policy: null, learners: [], own_grade: null, total: 0, offset: 0, limit: 20,
        });

        await assert.rejects(action(learner, "gradebook_publish", publish, 1), /42501/);
        await assert.rejects(action(teacher, "gradebook_publish", {...publish, user_id: foreign}, 1), /42501/);
        await assert.rejects(action(teacher, "gradebook_publish", {...publish, attempt_id: peerAttempt.id}, 1), /PT409/);
        await assert.rejects(action(teacher, "gradebook_publish", publish, 0), /PT409/);
        assert.equal((await action(teacher, "gradebook_publish", publish, 1)).revision, 1);
        const {reason: initialReason, ...publishedGrade} = (await readLearnerRow()).grade;
        const source = {attempt_id: best.id, quiz_version: 1, score: 100, passed: true};
        assert.equal(initialReason, null);
        assert.ok(Number.isFinite(Date.parse(publishedGrade.published_at)));
        assert.deepEqual(publishedGrade, {
            ...source, revision: 1, policy_version: 1, grade_percent: null, grade_label: "Pass",
            corrected: false, published_at: publishedGrade.published_at,
        });
        assert.deepEqual((await own()).own_grade, publishedGrade);
        assert.deepEqual(await gradebook(second), {
            can_manage: false, policy: null, learners: [], own_grade: null, total: 0, offset: 0, limit: 20,
        });

        // Publishing a policy changes the preview, not the stored grade. Corrections use both CAS versions.
        await assert.rejects(action(admin, "gradebook_policy", percentPolicy, 0), /PT409/);
        assert.equal((await action(admin, "gradebook_policy", percentPolicy, 1)).version, 2);
        assert.deepEqual((await readLearnerRow()).preview, {grade_percent: 100, grade_label: null});
        assert.deepEqual((await own()).own_grade, publishedGrade);
        const correct = {user_id: learner, grade_value: "85", expected_revision: 1, reason: "Reviewed fictional assessment"};
        await assert.rejects(action(learner, "gradebook_correct", correct, 2), /42501/);
        await assert.rejects(action(teacher, "gradebook_correct", correct, 1), /PT409/);
        await assert.rejects(action(teacher, "gradebook_correct", {...correct, expected_revision: 0}, 2), /PT409/);
        await assert.rejects(action(teacher, "gradebook_correct", {...correct, reason: ""}, 2), /22023/);
        assert.equal((await action(teacher, "gradebook_correct", correct, 2)).revision, 2);
        await assert.rejects(action(teacher, "gradebook_correct", correct, 2), /PT409/);
        const {reason, ...correctedGrade} = (await readLearnerRow()).grade;
        assert.equal(reason, correct.reason);
        assert.ok(Number.isFinite(Date.parse(correctedGrade.published_at)));
        assert.deepEqual(correctedGrade, {
            ...source, revision: 2, policy_version: 2, grade_percent: 85, grade_label: null,
            corrected: true, published_at: correctedGrade.published_at,
        });
        const learnerPage = await own();
        assert.deepEqual(learnerPage, {
            can_manage: false, policy: null, learners: [], own_grade: correctedGrade, total: 0, offset: 0, limit: 20,
        });

        // A replacement quiz supplies a new preview, but cannot rewrite either retained grade revision.
        await action(teacher, "quiz_config", {
            questions: [{prompt: "Read a parent directory?", options: ["ls ..", "pwd"], correct: 0}],
            pass_percent: 80, max_attempts: 2, published: true,
        }, 1);
        assert.equal((await readLearnerRow()).best_attempt, null);
        const newAttempt = await action(learner, "quiz_attempt", {answers: [1], request_id: randomUUID()}, 2);
        const replacementRow = await readLearnerRow();
        assert.equal(replacementRow.best_attempt.id, newAttempt.id);
        assert.equal(replacementRow.best_attempt.quiz_version, 2);
        assert.deepEqual(replacementRow.preview, {grade_percent: 0, grade_label: null});
        await assert.rejects(action(teacher, "gradebook_publish", {...publish, expected_revision: 2, reason}, 2), /PT409/);
        assert.deepEqual(replacementRow.grade, {...correctedGrade, reason});
        assert.deepEqual(await own(), learnerPage);
        const readHistory = (who, user = learner, before = null, limit = 20, course = run) =>
            actor(who, `select public.course_gradebook_history(${q(course)},
              ${user === null ? "null" : q(user)}, ${before ?? "null"}, ${limit})`).then(JSON.parse);
        const exportGrades = (who, course = run) =>
            actor(who, `select public.course_gradebook_export(${q(course)})`).then(JSON.parse);
        const original = { ...publishedGrade, reason: null };
        const corrected = { ...correctedGrade, reason };
        assert.deepEqual(await readHistory(teacher, learner, null, 1), {
            revisions: [corrected], next_before: 2,
        });
        assert.deepEqual(await readHistory(teacher, learner, 2, 1), {
            revisions: [original], next_before: null,
        });
        assert.deepEqual(await readHistory(learner, null), {
            revisions: [correctedGrade, publishedGrade], next_before: null,
        });
        await assert.rejects(readHistory(second), /42501/);
        await assert.rejects(readHistory(client), /42501/);
        await assert.rejects(readHistory(teacher, learner, null, 0), /22023/);
        await assert.rejects(readHistory(teacher, learner, null, 20, current), /42501/);
        await assert.rejects(exportGrades(learner), /42501/);
        await assert.rejects(exportGrades(client), /42501/);
        assert.deepEqual((await exportGrades(teacher)).map(({user_id, grade}) => ({user_id, grade})), [
            {user_id: learner, grade: correctedGrade},
        ]);

        // Competing releases of the replacement quiz append exactly one revision.
        const replace = {...publish, attempt_id: newAttempt.id, expected_revision: 2, reason: "New quiz attempt reviewed"};
        const concurrentReleases = await Promise.allSettled([
            action(teacher, "gradebook_publish", replace, 2),
            action(admin, "gradebook_publish", replace, 2),
        ]);
        assert.deepEqual(concurrentReleases.filter(({status}) => status === "fulfilled").map(({value}) => value), [{revision: 3}]);
        assert.match(concurrentReleases.find(({status}) => status === "rejected").reason.message, /PT409/);
        const replacementGrade = (await own()).own_grade;
        assert.equal(replacementGrade.attempt_id, newAttempt.id);
        assert.equal(replacementGrade.quiz_version, 2);
        assert.equal(replacementGrade.grade_percent, 0);
        assert.equal(replacementGrade.passed, false);
        assert.deepEqual(await readHistory(teacher), {
            revisions: [{...replacementGrade, reason: replace.reason}, corrected, original],
            next_before: null,
        });
        assert.deepEqual((await exportGrades(teacher)).map(({grade}) => grade), [replacementGrade]);
    });
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
    await check("Portfolio entries are private and named shares provide exactly one immutable revision", async () => {
        const id = randomUUID();
        const read = (who, course = null, entry = null, full = false) =>
            rpc(who, "learning_portfolio", [course ? q(course) : "null", entry ? q(entry) : "null", full]);
        const edit = (who, name, payload, version) =>
            rpc(who, "learning_portfolio_command", [q(id), q(name), q(JSON.stringify(payload)), version]);
        const first = {title: "Fictional learning reflection", body: "Revision one notes"};
        assert.equal((await edit(learner, "save", first, 0)).revision, 1);
        assert.equal((await edit(learner, "save", first, 0)).revision, 1);
        assert.equal((await read(learner)).entries[0].history, null);
        assert.ok((await read(learner)).targets.some(({course_id, teacher_id}) => course_id === run && teacher_id === teacher));
        for (const who of [admin, teacher, second, client]) {
            assert.deepEqual((await read(who)).entries, []);
            await assert.rejects(read(who, null, id), /42501/);
            await assert.rejects(edit(who, "save", first, 1), /42501/);
        }
        assert.deepEqual((await read(teacher, run)).shares, []);
        await assert.rejects(read(admin, run), /42501/);
        await assert.rejects(edit(learner, "share", {course_id: run, teacher_id: admin}, 1), /42501/);
        const recipient = {course_id: run, teacher_id: teacher};
        const receipt = (await edit(learner, "share", recipient, 1)).share_id;
        assert.equal((await edit(learner, "share", recipient, 1)).share_id, receipt);
        const secondRevision = {title: "New private title", body: "Revision two remains private"};
        assert.equal((await edit(learner, "save", secondRevision, 1)).revision, 2);
        await assert.rejects(edit(learner, "save", first, 1), /PT409/);
        await assert.rejects(edit(learner, "share", recipient, 1), /PT409/);
        const shared = (await read(teacher, run)).shares;
        assert.equal(shared.length, 1);
        assert.equal(shared[0].id, receipt);
        assert.equal(shared[0].revision, 1);
        assert.equal(shared[0].body, first.body);
        assert.equal(shared[0].title, first.title);
        const exportEntry = (await read(learner, null, null, true)).entries[0];
        assert.deepEqual(exportEntry.history.map(({body}) => body), [secondRevision.body, first.body]);
        await assert.rejects(edit(admin, "revoke", {share_id: receipt}, 0), /42501/);
        await edit(learner, "revoke", {share_id: receipt}, 0);
        assert.deepEqual((await read(teacher, run)).shares, []);
        assert.ok((await read(learner, null, id)).entries[0].shares[0].revoked_at);
        await edit(learner, "share", recipient, 2);
        assert.equal((await read(teacher, run)).shares[0].revision, 2);
        await assert.rejects(edit(admin, "archive", {state_revision: 0}, 2), /42501/);
        await assert.rejects(edit(learner, "archive", {state_revision: 0}, 1), /PT409/);
        await assert.rejects(edit(learner, "delete", {state_revision: 0, title: secondRevision.title}, 2), /22023/);
        await Promise.all([
            edit(learner, "archive", {state_revision: 0}, 2),
            edit(learner, "archive", {state_revision: 0}, 2),
        ]);
        const archived = (await read(learner, null, id)).entries[0];
        assert.equal(archived.state_revision, 1);
        assert.ok(archived.archived_at && archived.shares.every((share) => share.revoked_at));
        assert.deepEqual((await read(teacher, run)).shares, []);
        await assert.rejects(edit(learner, "share", recipient, 2), /PT409/);
        await assert.rejects(edit(learner, "save", first, 2), /PT409/);
        await assert.rejects(edit(learner, "restore", {state_revision: 0}, 2), /PT409/);
        await edit(learner, "restore", {state_revision: 1}, 2);
        assert.equal((await read(learner, null, id)).entries[0].archived_at, null);
        assert.deepEqual((await read(teacher, run)).shares, []);
        await edit(learner, "archive", {state_revision: 2}, 2);
        await assert.rejects(edit(learner, "delete", {state_revision: 3, title: "Wrong title"}, 2), /22023/);
        const erase = {state_revision: 3, title: secondRevision.title};
        assert.deepEqual(await edit(learner, "delete", erase, 2), {deleted: true});
        assert.deepEqual(await edit(learner, "delete", erase, 2), {deleted: true});
        assert.deepEqual((await read(learner, null, null, true)).entries, []);
        await assert.rejects(read(learner, null, id), /42501/);
        await assert.rejects(edit(learner, "save", first, 0), /42501/);
        assert.equal(await sql(`select count(*) from private.learning_portfolio_revisions where entry_id=${q(id)};`), "0");
        assert.equal(await sql(`select count(*) from private.learning_portfolio_shares where entry_id=${q(id)};`), "0");
    });
    await check("Scanned portfolio files require both a matching version and a current named share", async () => {
        const id = randomUUID(), clientId = randomUUID(), hash = "b".repeat(64), filename = "reflection.txt";
        const edit = (who, action, payload, revision) =>
            rpc(who, "learning_portfolio_command", [q(id), q(action), q(JSON.stringify(payload)), revision]);
        const reserve = (who, checksum = hash) => rpc(who, "reserve_learning_portfolio_evidence",
            [q(filename), q("text/plain"), 26, q(clientId), q(checksum)]);
        const readFile = (who, target, revision, shared, version) =>
            rpc(who, "learning_portfolio_evidence_access", [q(target), revision, shared, q(version)]);
        const view = (who, course) => rpc(who, "learning_portfolio", [course ? q(course) : "null"]);
        const file = await reserve(learner);
        const other = await reserve(second);
        assert.deepEqual(await reserve(learner), file);
        await assert.rejects(reserve(learner, "a".repeat(64)), /PT409/);
        assert.equal(await actor(learner, `select count(*) from public.documents where id=${q(file.document_id)}`), "0");
        assert.equal(await actor(learner, `select count(*) from public.document_versions where id=${q(file.version_id)}`), "0");
        assert.equal(await actor(second, `select public.learning_portfolio_evidence_upload_status(${q(file.document_id)},${q(file.version_id)}) is null`), "t");
        await assert.rejects(rpc(admin, "reserve_document", [q(filename), q("text/plain"), 26, q("personal"), q("portfolio_evidence"), "null", "null", q(randomUUID())]), /42501/);

        const text = {title: "Evidence entry", body: "Own notes"};
        await edit(learner, "save", text, 0);
        await assert.rejects(edit(learner, "link", {version_id: file.version_id}, 1), /42501/);
        const lease = await sql(`begin; set local role service_role; select public.deletion_upload_begin(${q(file.document_id)},${q(file.version_id)}); commit`);
        await sql(`update public.documents set status='scanning' where id=${q(file.document_id)};
            update public.document_versions set status='scanning' where id=${q(file.version_id)};`);
        const verdict = (checksum) => sql(`begin; set local role service_role;
            select public.complete_document_upload(${q(file.document_id)},${q(file.version_id)},${q(lease)},${q(checksum)},'ClamAV fictional scanner');
            commit`);
        await assert.rejects(verdict("a".repeat(64)), /22023/);
        await verdict(hash);
        await sql(`begin; set local role service_role; select public.deletion_upload_end(${q(lease)}); commit`);

        const version = {version_id: file.version_id};
        assert.deepEqual(await edit(learner, "link", version, 1), {revision: 2});
        assert.deepEqual(await edit(learner, "link", version, 1), {revision: 2});
        await assert.rejects(edit(second, "link", version, 2), /42501/);
        await assert.rejects(edit(learner, "link", {version_id: other.version_id}, 2), /42501/);
        assert.equal((await readFile(learner, id, 2, false, file.version_id)).name, filename);
        await assert.rejects(readFile(teacher, id, 2, false, file.version_id), /42501/);
        await assert.rejects(readFile(learner, id, 1, false, file.version_id), /42501/);
        const recipient = {course_id: run, teacher_id: teacher};
        const share = (await edit(learner, "share", recipient, 2)).share_id;
        const expected = {name: filename, version_id: file.version_id};
        assert.deepEqual((await view(teacher, run)).shares.find((item) => item.id === share).evidence, [expected]);
        assert.equal((await readFile(teacher, share, 2, true, file.version_id)).sha256, hash);
        for (const who of [admin, client, second]) {
            await assert.rejects(readFile(who, share, 2, true, file.version_id), /42501/);
        }
        await assert.rejects(readFile(teacher, share, 1, true, file.version_id), /42501/);
        await assert.rejects(readFile(teacher, share, 2, true, other.version_id), /42501/);

        await edit(learner, "save", {...text, body: "Edited text retains evidence"}, 2);
        assert.equal((await readFile(learner, id, 3, false, file.version_id)).name, filename);
        await edit(learner, "unlink", version, 3);
        await assert.rejects(readFile(learner, id, 4, false, file.version_id), /42501/);
        assert.equal((await readFile(teacher, share, 2, true, file.version_id)).name, filename);
        await edit(learner, "revoke", {share_id: share}, 0);
        await assert.rejects(readFile(teacher, share, 2, true, file.version_id), /42501/);
        await edit(learner, "link", version, 4);
        const nextShare = (await edit(learner, "share", recipient, 5)).share_id;
        await edit(learner, "archive", {state_revision: 0}, 5);
        await assert.rejects(readFile(teacher, nextShare, 5, true, file.version_id), /42501/);
        await assert.rejects(readFile(learner, id, 5, false, file.version_id), /42501/);
        await edit(learner, "restore", {state_revision: 1}, 5);
        assert.equal((await readFile(learner, id, 5, false, file.version_id)).name, filename);
        await assert.rejects(readFile(teacher, nextShare, 5, true, file.version_id), /42501/);
        await edit(learner, "archive", {state_revision: 2}, 5);
        await edit(learner, "delete", {state_revision: 3, title: text.title}, 5);
        assert.equal(await sql(`select count(*) from private.learning_portfolio_evidence where entry_id=${q(id)}`), "0");
    });
    await check("LTI tool registration and launch bind current course roles, Auth sessions and one-time proof", async () => {
        const deployment = randomUUID();
        const managerSession = randomUUID();
        const learnerSession = randomUUID();
        const otherSession = randomUUID();
        const teacherSession = randomUUID();
        const proof = randomUUID();
        const login = "https://lti-fixture.example.invalid/login";
        const target = "https://lti-fixture.example.invalid/resource";
        const redirect = "https://lti-fixture.example.invalid/receive";
        const clientId = "fictional-lti-tool";
        // The replay harness emulates native Auth only for permission checks.
        await sql(`create table if not exists auth.sessions(id uuid primary key, user_id uuid, not_after timestamptz);
          insert into auth.sessions(id,user_id) values
            (${q(managerSession)},${q(admin)}),(${q(learnerSession)},${q(learner)}),
            (${q(otherSession)},${q(learner)}),(${q(teacherSession)},${q(teacher)});`);
        const invoke = async (who, session, name, args) => JSON.parse(await sql(`
          begin; set local role authenticated;
          set local request.jwt.claims=${q(JSON.stringify({sub: who, role: "authenticated", aal: "aal1", session_id: session}))};
          set local request.path=${q("/rpc/" + name)}; set local request.method='POST';
          set local request.headers='{}'; select public.require_portal_access();
          select to_jsonb(public.${name}(${args.join(",")})); commit;
        `));
        const register = (who, session, version = 0, actuallyLogin = login, active = true) =>
            invoke(who, session, "save_course_lti_tool", [
                q(deployment), q(run), q("Fictional LTI resource"), q(clientId), q(actuallyLogin),
                q(redirect), q(target), active, version,
            ]);
        const start = (who, session) =>
            invoke(who, session, "prepare_lti_launch", [q(deployment), q(proof)]);
        const finish = (who, session, ready, {browser = proof, destination = redirect, nonce = "fixture-nonce", state = "fixture-state"} = {}) =>
            invoke(who, session, "consume_lti_launch", [
                q(ready.login_hint), q(ready.message_hint), q(browser), q(clientId), q(destination), q(nonce), q(state),
            ]);
        await assert.rejects(register(learner, learnerSession), /42501/);
        await assert.rejects(register(admin, managerSession, 0, "https://other-invalid.example@fixture.example.invalid/login"), /22023/);
        assert.equal(await register(admin, managerSession), 1);
        await assert.rejects(register(admin, managerSession), /PT409/);
        const learnerTools = await invoke(learner, learnerSession, "course_lti_tools", [q(run)]);
        assert.equal(learnerTools.can_manage, false);
        assert.equal(learnerTools.can_launch, true);
        assert.ok(!Object.hasOwn(learnerTools.tools[0], "redirect_uri"));
        await assert.rejects(start(admin, managerSession), /42501/);
        const ready = await start(learner, learnerSession);
        assert.equal(ready.target_uri, target);
        await assert.rejects(finish(learner, otherSession, ready), /42501/);
        await assert.rejects(finish(teacher, teacherSession, ready), /42501/);
        await assert.rejects(finish(learner, learnerSession, ready, {browser: randomUUID()}), /42501/);
        await assert.rejects(finish(learner, learnerSession, ready, {destination: target}), /42501/);
        const submitted = await Promise.allSettled([
            finish(learner, learnerSession, ready),
            finish(learner, learnerSession, ready),
        ]);
        assert.equal(submitted.filter(({status}) => status === "fulfilled").length, 1);
        const launched = submitted.find(({status}) => status === "fulfilled").value;
        assert.equal(launched.role, "Learner");
        assert.notEqual(launched.subject, learner);
        assert.notEqual(launched.context_id, run);
        const next = await start(learner, learnerSession);
        await assert.rejects(finish(learner, learnerSession, next), /PT409/);
        await assert.rejects(finish(learner, learnerSession, next, { nonce: "fresh-nonce" }), /PT409/);
        const fresh = await finish(learner, learnerSession, next, {nonce: "fresh-nonce", state: "fresh-state"});
        assert.equal(fresh.subject, launched.subject);
        // An explicitly enabled roster uses the launch pseudonym and never
        // returns account UUIDs, customer data or private contact information.
        const {publicKey} = generateKeyPairSync("rsa", {modulusLength: 2048});
        const key = {...publicKey.export({format: "jwk"}), kid: "fictional-lti-key"};
        const configure = (who, session, version, publicKey, nrps) =>
            invoke(who, session, "configure_course_lti_advantage", [
                q(deployment), version, publicKey ? q(JSON.stringify(publicKey)) : "null", nrps,
            ]);
        const rosterScope = "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
        const toolRpc = (name, args) => sql(`
          begin; set local role service_role;
          set local request.path=${q("/rpc/" + name)}; set local request.method='POST';
          set local request.headers='{}'; select public.require_portal_access();
          select coalesce(to_jsonb(public.${name}(${args.join(",")})),'null'::jsonb); commit;
        `).then(JSON.parse);
        const issue = (assertion, scopes = rosterScope) =>
            toolRpc("lti_issue_service_token", [
                q(deployment), 2, q(assertion), "now()+interval '4 minutes'", `array[${q(scopes)}]`,
            ]);
        const roster = (token, id = deployment, role = null, after = null, limit = 100) =>
            toolRpc("lti_course_memberships", [
                q(id), q(token), role ? q(role) : "null", after ? q(after) : "null", limit,
            ]);
        await assert.rejects(configure(learner, learnerSession, 1, key, true), /42501/);
        await assert.rejects(configure(admin, managerSession, 1, {...key, d: "private-parameter"}, true), /22023/);
        assert.equal(await configure(admin, managerSession, 1, key, true), 2);
        await assert.rejects(configure(admin, managerSession, 1, key, true), /PT409/);
        assert.ok(!Object.hasOwn((await invoke(learner, learnerSession, "course_lti_tools", [q(run)])).tools[0], "tool_public_key"));
        const enabled = await start(learner, learnerSession);
        const rosterLaunch = await finish(learner, learnerSession, enabled, {nonce: "roster-nonce", state: "roster-state"});
        assert.equal(rosterLaunch.nrps_enabled, true);
        assert.equal(rosterLaunch.subject, launched.subject);
        assert.deepEqual(await toolRpc("lti_service_registration", [q(clientId), "null"]), {
            id: deployment, version: 2, key,
        });
        await assert.rejects(invoke(admin, managerSession, "lti_service_registration", [q(clientId), q(deployment)]), /42501/);
        await assert.rejects(issue("wrong-scope", "fictional.scope"), /22023/);
        const token = await issue("fixture-assertion");
        assert.match(token, /^[0-9a-f]{64}$/);
        await assert.rejects(issue("fixture-assertion"), /42501/);
        await assert.rejects(roster(token, randomUUID()), /42501/);
        await assert.rejects(roster("0".repeat(64)), /42501/);
        const membership = await roster(token);
        assert.equal(membership.context_id, launched.context_id);
        assert.equal(membership.members.length, 4);
        assert.ok(membership.members.some(({user_id}) => user_id === launched.subject));
        assert.ok(membership.members.every((member) => Object.keys(member).sort().join(",") === "roles,status,user_id"));
        assert.ok(!JSON.stringify(membership).includes(learner));
        assert.equal((await roster(token, deployment, "Instructor")).members.length, 1);
        const firstPage = await roster(token, deployment, "Learner", null, 1);
        assert.equal(firstPage.members.length, 2); // one page plus next-page marker row
        const secondPage = await roster(token, deployment, "Learner", firstPage.members[0].user_id, 1);
        assert.equal(secondPage.members[0].user_id, firstPage.members[1].user_id);
        await sql(`update private.lti_service_tokens set expires_at=now()-interval '1 minute'
            where token_hash=extensions.digest(${q(token)},'sha256')`);
        await assert.rejects(roster(token), /42501/);
        const beforeRevision = await issue("before-revision");
        const picker = "https://lti-fixture.example.invalid/select";
        const configurePicker = (who, session, version, uri) =>
            invoke(who, session, "configure_course_lti_deep_link", [
                q(deployment), version, uri ? q(uri) : "null",
            ]);
        const prepare = (who, session, resource, origin) =>
            invoke(who, session, "prepare_lti_placement", [
                q(deployment), q(proof), resource ? q(resource) : "null",
                origin ? q(origin) : "null",
            ]);
        const applyLink = (who, session, id, action) =>
            invoke(who, session, "lti_deep_link_review", [q(id), q(action)]);
        const returnSelection = (choice, item) =>
            toolRpc("receive_lti_deep_link", [q(deployment), 3, q(choice.deep_link_data),
                item ? q(JSON.stringify(item)) : "null",
            ]);
        const portalOrigin = "https://fixture-portal.example.invalid";
        await assert.rejects(configurePicker(learner, learnerSession, 2, picker), /42501/);
        await assert.rejects(configurePicker(admin, managerSession, 2, "http://fixture.invalid/select"), /22023/);
        assert.equal(await configurePicker(admin, managerSession, 2, picker), 3);
        await assert.rejects(prepare(learner, learnerSession, null, portalOrigin), /42501/);
        const selection = await prepare(teacher, teacherSession, null, portalOrigin);
        assert.equal(selection.target_uri, picker);
        const choice = await finish(teacher, teacherSession, selection, {nonce: "pick-content",state: "pick-content"});
        assert.equal(choice.role, "Instructor");
        assert.match(choice.deep_link_data, /^[a-f0-9]{64}$/);
        assert.equal(choice.target_uri, picker);
        const link = {
            title: "Fictional selected activity",
            url: "https://lti-fixture.example.invalid/activities/unit-2",
            custom: {chapter:"2"},
        };
        await assert.rejects(returnSelection(choice,{...link,url:"https://foreign.example.invalid/activity"}), /22023/);
        await assert.rejects(returnSelection(choice,{...link,custom:{invalid:42}}), /22023/);
        const received = await returnSelection(choice,link);
        assert.equal(received.origin, portalOrigin);
        await assert.rejects(returnSelection(choice,link), /42501/);
        await assert.rejects(applyLink(learner,learnerSession,received.id,"read"), /42501/);
        await assert.rejects(applyLink(admin,managerSession,received.id,"publish"), /42501/);
        await assert.rejects(prepare(learner,learnerSession,received.id,null), /42501/);
        const draftLink = await applyLink(teacher,teacherSession,received.id,"read");
        assert.equal(draftLink.title,link.title);
        assert.equal(draftLink.published,false);
        assert.equal((await applyLink(teacher,teacherSession,received.id,"publish")).published,true);
        assert.equal((await applyLink(teacher,teacherSession,received.id,"publish")).published,true);
        const available = await invoke(learner,learnerSession,"course_lti_tools",[q(run)]);
        assert.deepEqual(available.tools[0].links,[{id:received.id,title:link.title}]);
        assert.equal(available.tools[0].can_select,false);
        const linkHint = await prepare(learner,learnerSession,received.id,null);
        assert.equal(linkHint.target_uri,link.url);
        const openedLink = await finish(learner,learnerSession,linkHint,{nonce:"use-link",state:"use-link"});
        assert.equal(openedLink.target_uri,link.url);
        assert.equal(openedLink.id,deployment);
        assert.equal(openedLink.resource_link_id,received.id);
        assert.equal(openedLink.subject,launched.subject);
        assert.deepEqual(openedLink.resource_custom,link.custom);
        const resourceToken = await toolRpc("lti_issue_service_token", [
            q(deployment), 3, q("bound-resource"), "now()+interval '4 minutes'", `array[${q(rosterScope)}]`,
        ]);
        const linkRoster = (linkId) => toolRpc("lti_resource_memberships", [
            q(deployment), q(resourceToken), "null", "null", 100, q(linkId),
        ]);
        assert.deepEqual((await linkRoster(received.id)).resource_custom,link.custom);
        assert.equal(await linkRoster(randomUUID()),null);
        const withdrawnLinkHint = await prepare(learner,learnerSession,received.id,null);
        const withdrawn = await applyLink(teacher,teacherSession,received.id,"withdraw");
        assert.equal(withdrawn.run_id,run);
        assert.equal(await linkRoster(received.id),null);
        await assert.rejects(finish(learner,learnerSession,withdrawnLinkHint,{nonce:"withdrawn",state:"withdrawn"}),/42501/);
        await assert.rejects(prepare(learner,learnerSession,received.id,null),/42501/);
        const withheld = await start(learner, learnerSession);
        assert.equal(await register(admin, managerSession, 3, login, false), 4);
        await assert.rejects(roster(beforeRevision), /42501/);
        await assert.rejects(finish(learner, learnerSession, withheld), /42501/);
        await assert.rejects(start(learner, learnerSession), /42501/);
        // Signup/session entitlement is rechecked, even while the profile stays active.
        assert.equal(await register(admin, managerSession, 4), 5);
        await assert.rejects(roster(beforeRevision), /42501/);
        const enableGrades = (who, session, revision, enabled) =>
            invoke(who, session, "configure_course_lti_ags", [q(deployment), revision, enabled]);
        const gradeScope = (scope) => `https://purl.imsglobal.org/spec/lti-ags/scope/${scope}`;
        const issueGrades = (scopes, revision) =>
            toolRpc("lti_issue_service_token", [
                q(deployment), revision, q(randomUUID()), "now()+interval '4 minutes'",
                `array[${scopes.map((scope) => q(gradeScope(scope))).join(",")}]`,
            ]);
        const grades = (credential, command, item, input = {}, id = deployment) =>
            toolRpc("lti_ags_service", [
                q(id), q(credential), q(command), item ? q(item) : "null", q(JSON.stringify(input)),
            ]);
        const readLedger = (who, session) => invoke(who, session, "course_lti_ags_grades", [
            q(deployment), "null", 10,
        ]);
        await assert.rejects(issueGrades(["lineitem"], 4), /42501/);
        await assert.rejects(enableGrades(learner, learnerSession, 4, true), /42501/);
        assert.equal(await enableGrades(admin, managerSession, 4, true), 5);
        await assert.rejects(enableGrades(admin, managerSession, 4, false), /PT409/);
        const gradeToken = await issueGrades(["lineitem", "result.readonly", "score"], 5);
        const readToken = await issueGrades(["lineitem.readonly"], 5);
        await assert.rejects(grades(readToken,"create",null,{label: "Denied", scoreMaximum: 5}),/42501/);
        await assert.rejects(grades(gradeToken,"list",null,{},randomUUID()),/42501/);
        await assert.rejects(grades(gradeToken,"create",null,{
            label: "Foreign link", scoreMaximum: 10, resourceLinkId: randomUUID(),
        }),/PT404/);
        const item = await grades(gradeToken,"create",null,{
            label: "Fictional skills check", scoreMaximum: 20, resourceLinkId: deployment, resourceId: "worksheet",
            tag: "lab",
        });
        assert.equal((await grades(readToken,"read",item.id)).label,"Fictional skills check");
        assert.deepEqual(await grades(readToken,"list",null,{resource_id: "worksheet", tag: "lab"}),[item]);
        const withGrades = await start(learner, learnerSession);
        const gradeLaunch = await finish(learner, learnerSession, withGrades,{
            nonce: "ags-launch-nonce", state: "ags-launch-state",
        });
        assert.equal(gradeLaunch.ags_enabled,true);
        assert.equal(gradeLaunch.ags_lineitem,item.id);
        assert.equal((await invoke(teacher,teacherSession,"course_lti_tools",[q(run)])).tools[0].view_grades,true);
        assert.equal((await invoke(learner,learnerSession,"course_lti_tools",[q(run)])).tools[0].view_grades,false);
        const timestamp = Date.now() - 20_000;
        const submission = (offset,extra = {}) => ({
            timestamp: new Date(timestamp + offset).toISOString(), userId: launched.subject,
            activityProgress: "Completed", gradingProgress: "FullyGraded", scoreGiven: 12, scoreMaximum: 10,
            ...extra,
        });
        await assert.rejects(grades(readToken,"score",item.id,submission(1000)),/42501/);
        await assert.rejects(grades(gradeToken,"score",item.id,submission(1000,{userId: randomUUID()})),/PT404/);
        assert.equal(await grades(gradeToken,"score",item.id,submission(1000)),true);
        assert.equal(await grades(gradeToken,"score",item.id,submission(500,{scoreGiven: 1})),true);
        assert.equal(await grades(gradeToken,"score",item.id,submission(2000,{gradingProgress: "PendingManual", scoreGiven: 1})),true);
        assert.deepEqual(await grades(gradeToken,"results",item.id,{user_id:launched.subject}),[
            {userId:launched.subject,resultScore:24,resultMaximum:20},
        ]);
        assert.equal((await grades(gradeToken,"update",item.id,{
            label: "Fictional skills check",scoreMaximum: 25,resourceId: "worksheet",tag: "lab",
        })).scoreMaximum,25);
        assert.equal((await grades(gradeToken,"results",item.id))[0].resultScore,30);
        assert.equal((await readLedger(teacher,teacherSession))[0].results[0].score,30);
        await assert.rejects(readLedger(learner,learnerSession),/42501/);
        assert.equal(await grades(gradeToken,"score",item.id,submission(3000,{scoreGiven:null,scoreMaximum:null})),true);
        assert.deepEqual(await grades(gradeToken,"results",item.id),[]);
        assert.equal(await grades(gradeToken,"delete",item.id),true);
        await assert.rejects(grades(gradeToken,"read",item.id),/PT404/);
        assert.equal(await enableGrades(admin,managerSession,5,false),6);
        await assert.rejects(grades(gradeToken,"list",null),/42501/);

        const staleSession = await start(learner, learnerSession);
        await sql(`delete from auth.sessions where id=${q(learnerSession)}`);
        await assert.rejects(finish(learner, learnerSession, staleSession), /42501/);
    });
    await check("Weighted course grades hold current assessment evidence and versioned review and release rules", async () => {
        const assignment = randomUUID(), bonus = randomUUID(), mainAttempt = randomUUID(), bonusAttempt = randomUUID();
        // Set up fictional source facts with their exact rubric and review versions.
        const rubric = JSON.stringify([{label: "Fictional score", levels: [0, 5, 8, 9, 10].map((points) => ({label: String(points), points}))}]);
        await sql(`
          insert into private.course_assignments(id,run_id,current_version,published_version)
            values (${q(assignment)},${q(run)},1,1),(${q(bonus)},${q(run)},1,1);
          insert into private.course_assignment_definitions(assignment_id,version,title,instructions,due_at,max_attempts,rubric)
            values (${q(assignment)},1,'Fictional graded work','Instructions',now(),2,${q(rubric)}),
                   (${q(bonus)},1,'Fictional bonus work','Instructions',now(),2,${q(rubric)});
          insert into private.course_assignment_attempts(id,assignment_id,assignment_version,user_id,attempt_no,file_name)
            values (${q(mainAttempt)},${q(assignment)},1,${q(learner)},1,'fictional.pdf'),
                   (${q(bonusAttempt)},${q(bonus)},1,${q(learner)},1,'bonus.pdf');
          insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
            values (${q(mainAttempt)},1,'released','[9]','','private feedback'),
                   (${q(mainAttempt)},2,'draft','[5]','','private draft'),
                   (${q(bonusAttempt)},1,'released','[5]','','private bonus feedback');
          insert into private.course_timed_exams(run_id,title,visible_from,starts_at,ends_at,pass_percent)
            values (${q(run)},'Fictional numeric exam',now()-interval '3 days',now()-interval '2 days',now()-interval '1 day',60);
          insert into private.course_exam_results(run_id,participant_id,score) values (${q(run)},${q(learner)},80);
        `);
        const readWeighted = (who, target = null, before = null) => rpc(who, "course_weighted_gradebook", [
            q(run), target === null ? "null" : q(target), before ?? "null",
        ]);
        const changeWeighted = (who, actionName, version, payload) => rpc(who, "course_weighted_gradebook_command", [
            q(run), q(actionName), q(JSON.stringify(payload)), version,
        ]);
        const items = [
            {key: "quiz", weight: 40, treatment: "required"},
            {key: assignment, weight: 35, treatment: "required"},
            {key: "exam", weight: 25, treatment: "required"},
            {key: bonus, weight: 10, treatment: "bonus"},
        ];
        const policy = {threshold: 47, missing_required: "block", separate_reviewer: true, items};
        await assert.rejects(changeWeighted(learner, "policy", 0, policy), /42501/);
        await assert.rejects(readWeighted(client, learner), /42501/);
        await assert.rejects(readWeighted(second, learner), /42501/);
        await assert.rejects(changeWeighted(teacher, "policy", 0, {...policy, items: [...items, items[0]]}), /22023/);
        await assert.rejects(changeWeighted(teacher, "policy", 0, {...policy, items: items.slice(0, 2)}), /22023/);
        assert.deepEqual(await changeWeighted(teacher, "policy", 0, policy), {version: 1});
        await assert.rejects(changeWeighted(admin, "policy", 0, policy), /PT409/);
        const staffView = await readWeighted(teacher, learner);
        assert.equal(staffView.preview.percent, null); // saved, unpublished exam
        assert.equal(staffView.preview.components.find(({key}) => key === assignment).score, 90);
        assert.equal(staffView.preview.components.find(({key}) => key === "exam").status, "missing");
        const exempt = {user_id: learner, key: "exam", excused: true, reason: "Fictional approved exemption", expected_exemption: 0};
        assert.deepEqual(await changeWeighted(teacher, "exempt", 1, exempt), {version: 1});
        await assert.rejects(changeWeighted(teacher, "exempt", 1, exempt), /PT409/);
        const proposed = await readWeighted(teacher, learner);
        const quiz = proposed.preview.components.find(({key}) => key === "quiz").score;
        assert.ok(Number.isInteger(quiz));
        const initialPercent = Number(((quiz*40 + 90*35)/75 + 5).toFixed(2));
        assert.equal(proposed.preview.percent, initialPercent);
        assert.equal(proposed.preview.passed, initialPercent >= 47);
        assert.equal(proposed.preview.components.find(({key}) => key === "exam").status, "excused");
        const reviewed = {user_id: learner, expected_review: 0, expected_release: 0, fingerprint: proposed.fingerprint, reason: ""};
        await assert.rejects(changeWeighted(teacher,"review",1,{...reviewed,fingerprint:"0".repeat(64)}), /PT409/);
        assert.deepEqual(await changeWeighted(teacher,"review",1,reviewed), {version: 1});
        const release = {user_id: learner, expected_review: 1, expected_release: 0};
        assert.deepEqual((await readWeighted(learner)).history, []);
        assert.equal((await readWeighted(learner)).review,null);
        await assert.rejects(changeWeighted(teacher,"release",1,release), /42501/);
        // A newly released grade invalidates the reviewed preview without disclosing the draft.
        await sql(`insert into private.course_assignment_reviews(attempt_id,version,state,scores,feedback,private_note)
          values (${q(mainAttempt)},3,'released','[8]','','private correction')`);
        await assert.rejects(changeWeighted(admin,"release",1,release), /PT409/);
        const corrected = await readWeighted(teacher, learner);
        assert.equal(corrected.preview.percent, Number(((quiz*40 + 80*35)/75 + 5).toFixed(2)));
        await changeWeighted(teacher,"review",1,{...reviewed,expected_review:1,fingerprint:corrected.fingerprint});
        const published = await Promise.allSettled([
            changeWeighted(admin,"release",1,{...release,expected_review:2}),
            changeWeighted(admin,"release",1,{...release,expected_review:2}),
        ]);
        assert.deepEqual(published.filter(({status}) => status === "fulfilled").map(({value}) => value), [{version:1}]);
        assert.match(published.find(({status}) => status === "rejected").reason.message, /PT409/);
        const firstRelease = (await readWeighted(learner)).history[0];
        assert.equal(firstRelease.result.percent, corrected.preview.percent);
        assert.equal(firstRelease.reason,null);
        assert.ok(!Object.hasOwn(firstRelease.result,"basis"));
        assert.deepEqual((await readWeighted(second)).history, []);
        assert.deepEqual(await changeWeighted(teacher,"policy",1,{...policy,missing_required:"zero",separate_reviewer:false}),{version:2});
        const zeroPreview = (await readWeighted(teacher, learner)).preview;
        assert.equal(zeroPreview.components.find(({key}) => key === "exam").status,"zero");
        assert.equal(zeroPreview.percent, Number(((quiz*40 + 80*35)/100 + 5).toFixed(2)));
        await sql(`update private.course_timed_exams set version=2,published_at=clock_timestamp() where run_id=${q(run)}`);
        const examPreview = await readWeighted(teacher, learner);
        const secondPercent = Number(((quiz*40 + 80*35 + 80*25)/100 + 5).toFixed(2));
        assert.equal(examPreview.preview.percent, secondPercent);
        assert.equal(examPreview.preview.components.find(({key}) => key === "exam").score,80);
        assert.deepEqual((await readWeighted(learner)).history,[firstRelease]);
        const replacement = {user_id: learner, expected_review:2, expected_release:1,
            fingerprint: examPreview.fingerprint, reason:""};
        await assert.rejects(changeWeighted(teacher,"review",2,replacement), /22023/);
        await changeWeighted(teacher,"review",2,{...replacement,reason:"Fictional numeric exam released"});
        await changeWeighted(teacher,"release",2,{user_id:learner,expected_review:3,expected_release:1});
        const official = (await readWeighted(learner)).history;
        assert.equal(official[0].result.percent,secondPercent);
        assert.equal(official[0].reason,null);
        assert.deepEqual(await readWeighted(learner,null,2).then(({history}) => history),[firstRelease]);
        assert.equal((await readWeighted(teacher,learner)).history[0].reason,"Fictional numeric exam released");
        const xapi = async () => courseXapiArchiveSchema.parse(await rpc(admin, "course_xapi_statements", [
            q(run), q(new Date(Date.now() - 86400000).toISOString()), q(new Date(Date.now() + 86400000).toISOString()),
        ]));
        const archive = await xapi();
        const scored = archive.statements.filter((entry) => entry.verb.id.endsWith("/scored"));
        assert.deepEqual(scored.map((entry) => entry.result.score.raw), [firstRelease.result.percent, secondPercent]);
        assert.ok(scored.every((entry) => entry.object.id.endsWith("/weighted-grade")));
        assert.ok(!JSON.stringify(scored).includes("Fictional numeric exam released"));
        assert.deepEqual(await xapi(), archive);
        // Optional missing work is reweighted, while the numeric base remains separate from bonus points.
        const optionalItems = items.map((item) => item.key === "exam" ? {...item,treatment:"optional"} : item);
        await sql(`update private.course_timed_exams set published_at=null where run_id=${q(run)}`);
        await changeWeighted(admin,"policy",2,{...policy,items:optionalItems});
        const optional = (await readWeighted(teacher,learner)).preview;
        assert.equal(optional.percent, corrected.preview.percent);
        assert.equal(optional.components.find(({key}) => key === "exam").status,"missing");
    });
    await check(
        "Membership and account revocation remove course documents with existing identities",
        async () => {
            await sql(
                `update public.client_organisation_memberships set removed_at=now() where user_id=${q(client)};update public.course_enrolments set status='removed' where user_id=${q(learner)};`,
            );
            await assert.rejects(workspace(client), /42501/);
            await assert.rejects(workspace(learner), /42501/);
            await assert.rejects(gradebook(learner), /42501/);
            await sql(
                `update public.profiles set active=false where id=${q(teacher)}`,
            );
            await assert.rejects(workspace(teacher), /42501/);
            await assert.rejects(gradebook(teacher), /42501/);
        },
    );
    console.log(`Passed ${count} real course workspace PostgreSQL groups.`);
});
