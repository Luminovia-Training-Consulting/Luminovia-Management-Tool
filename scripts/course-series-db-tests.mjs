import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { portalOpenApi } from "../src/features/developer-api/contract.ts";
import { z } from "zod";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const editions = ["internal", "customer-self-hosted", "customer-managed"];
const selected = process.env.PORTAL_COURSE_SERIES_EDITION;
if (selected) assert.ok(editions.includes(selected));
const instant = (days, hours = 0) =>
  new Date(Date.now() + (days * 24 + hours) * 3600000).toISOString();

for (const edition of selected ? [selected] : editions) {
  await withTestDatabase("course_series", async ({ sql, actor }) => {
    const [
      installation,
      admin,
      company,
      outsider,
      participant,
      org,
      otherOrg,
      template,
      otherTemplate,
      a,
      b,
      foreign,
    ] = Array.from({ length: 12 }, randomUUID);
    const internal = edition === "internal";
    const api = portalOpenApi("https://academy.example.invalid/backend", true, {
      name: "Practice Academy",
      edition,
      installationId: installation,
    });
    const response = (endpoint, method) =>
      z.fromJSONSchema(
        api.paths[`/rest/v1/rpc/${endpoint}`][method].responses["200"].content[
          "application/json"
        ].schema,
      );
    const request = z.fromJSONSchema(
      api.paths["/rest/v1/rpc/plan_course_series"].post.requestBody.content[
        "application/json"
      ].schema,
    );
    if (!internal) {
      const terms = {
        installation_id: installation,
        edition,
        release_commit: "ae".repeat(20),
        issued_at: instant(-2),
        starts_at: instant(-1),
        expires_at: instant(4),
        grace_until: instant(8),
        limits: {
          seat_count: 20,
          storage_bytes: 2000000,
          api_requests_per_minute: 60,
        },
        modules: ["lms"],
      };
      const key = generateKeyPairSync("ed25519");
      await prepareAcademyInstallation(
        {
          envelope: signAcademyLicence(terms, key.privateKey),
          publicKey: key.publicKey,
          expected: terms,
        },
        sql,
      );
      await sql(
        `select private.configure_academy_course_access(${q(installation)}, ${q(terms.release_commit)}, true)`,
      );
    }
    await sql(`insert into auth.users(id,email,email_confirmed_at) values ${[admin, company, outsider, participant].map((id) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values (${q(admin)},'admin'), (${q(company)},'client'), (${q(outsider)},'client'), (${q(participant)},'participant');
      insert into public.organisations(id,name) values (${q(org)},'Fictional Training'), (${q(otherOrg)},'Other Fictional Training');
      insert into public.client_organisation_memberships(user_id,organisation_id) values (${q(company)},${q(org)}), (${q(outsider)},${q(otherOrg)});
      insert into public.course_templates(id,title,owner_organisation_id) values
        (${q(template)},'Fictional course',${q(org)}), (${q(otherTemplate)},'Other fictional course',${q(otherOrg)});
      insert into private.course_classes(id,organisation_id,name) values
        (${q(a)},${q(org)},'Class A'), (${q(b)},${q(org)},'Class B'), (${q(foreign)},${q(otherOrg)},'Foreign class');`);

    const invoke = (who, endpoint, args, method = "POST") =>
      actor(
        who,
        `set local request.method=${q(method)}; set local request.path=${q("/rpc/" + endpoint)};
      select public.require_portal_access(); select public.${endpoint}(${args});`,
      );
    const classes = async (who) =>
      response("course_series_classes", "get").parse(
        JSON.parse(await invoke(who, "course_series_classes", q(org), "GET")),
      );
    const starts = instant(12);
    const ends = new Date(Date.parse(starts) + 3600000).toISOString();
    const run = (classId, venue, starts_at = starts, ends_at = ends) => ({
      delivery_type: "onsite",
      class_id: classId,
      venue,
      sessions: [{ starts_at, ends_at }],
    });
    const valid = [run(a, "Room A"), run(b, "Room B")];
    const plan = async (
      who,
      runs = valid,
      id = null,
      chosenTemplate = template,
    ) => {
      request.parse({
        p_organisation_id: org,
        p_template_id: chosenTemplate,
        p_time_zone: "Europe/Berlin",
        p_runs: runs,
        p_request_id: id,
      });
      return response("plan_course_series", "post").parse(
        JSON.parse(
          await invoke(
            who,
            "plan_course_series",
            [
              q(org),
              q(chosenTemplate),
              q("Europe/Berlin"),
              q(JSON.stringify(runs)),
              id ? q(id) : "null",
            ].join(","),
          ),
        ),
      );
    };
    const planner = internal ? company : admin;
    assert.deepEqual(await classes(planner), [
      { id: a, name: "Class A" },
      { id: b, name: "Class B" },
    ]);
    await assert.rejects(classes(outsider), /42501/);
    await assert.rejects(plan(participant), /42501/);
    await assert.rejects(plan(outsider), /42501/);
    await assert.rejects(plan(planner, valid, null, otherTemplate), /42501/);
    await assert.rejects(
      plan(planner, [valid[0], run(foreign, "Other")]),
      /42501/,
    );
    assert.deepEqual(await plan(planner), { run_ids: [], conflicts: [] });
    assert.deepEqual(
      (await plan(planner, [valid[0], run(a, "Room C")])).conflicts,
      [1, 2].map((run_no) => ({ run_no, session_no: 1, reason: "class" })),
    );
    assert.deepEqual(
      (await plan(planner, [valid[0], run(b, " room a ")])).conflicts,
      [1, 2].map((run_no) => ({ run_no, session_no: 1, reason: "room" })),
    );
    assert.equal(
      (
        await plan(planner, [
          {
            ...valid[0],
            sessions: [...valid[0].sessions, ...valid[0].sessions],
          },
          valid[1],
        ])
      ).conflicts.length,
      2,
    );
    assert.equal(await sql("select count(*) from public.course_runs"), "0");

    const id = randomUUID();
    const [first, retry] = await Promise.all([
      plan(planner, valid, id),
      plan(planner, valid, id),
    ]);
    assert.equal(first.run_ids.length, 2);
    assert.deepEqual(retry, first);
    assert.equal(
      await sql(
        "select count(*) from public.course_runs where not published and archived_at is null",
      ),
      "2",
    );
    assert.equal(
      await sql("select count(*) from private.course_class_assignments"),
      "2",
    );
    assert.equal(
      await sql("select count(*) from public.course_enrolments"),
      "0",
    );
    await assert.rejects(
      plan(planner, [valid[0], run(b, "Room C")], id),
      /PT409/,
    );
    const lateConflict = await plan(planner, valid, randomUUID());
    assert.deepEqual(
      lateConflict.conflicts,
      [1, 2].map((run_no) => ({ run_no, session_no: 1, reason: "class" })),
    );
    assert.deepEqual(lateConflict.run_ids, []);
    assert.equal(await sql("select count(*) from public.course_runs"), "2");
    const extra = [run(null, "Room D"), run(null, "Room E")];
    const approvals = await Promise.all([
      plan(planner, extra, randomUUID()),
      plan(planner, extra, randomUUID()),
    ]);
    assert.deepEqual(
      approvals.map((item) => item.run_ids.length).sort(),
      [0, 2],
    );
    assert.equal(await sql("select count(*) from public.course_runs"), "4");

    const zone = "Europe/Berlin";
    const datedPattern = (offset) => ({
      first_day: DateTime.fromISO(instant(offset), { zone }).toISODate(),
      days: 1,
      start: "09:00",
      end: "10:00",
      weekdays: [1, 2, 3, 4, 5, 6, 7],
      excluded_dates: "",
    });
    const change = (id, pattern, offsets = [0]) => {
      const firstDay = DateTime.fromISO(pattern.first_day, { zone });
      const sessions = offsets.map((offset) => {
        const day = firstDay.plus({ days: offset }).toISODate();
        return {
          starts_at: DateTime.fromISO(day + "T" + pattern.start, { zone })
            .toUTC()
            .toISO(),
          ends_at: DateTime.fromISO(day + "T" + pattern.end, { zone })
            .toUTC()
            .toISO(),
        };
      });
      return { id, pattern, sessions };
    };
    const patterned = (classId, venue, pattern) => ({
      ...run(classId, venue),
      pattern,
      sessions: change(null, pattern).sessions,
    });
    const find = async (who, course) => {
      const raw = await invoke(who, "course_series_for_run", q(course), "GET");
      return response("course_series_for_run", "get").parse(
        raw ? JSON.parse(raw) : null,
      );
    };
    const revisionRequest = z.fromJSONSchema(
      api.paths["/rest/v1/rpc/revise_course_series"].post.requestBody.content[
        "application/json"
      ].schema,
    );
    const revise = async (who, course, revision, changes, confirm = false) => {
      revisionRequest.parse({
        p_course_id: course,
        p_revision: revision,
        p_changes: changes,
        p_confirm: confirm,
      });
      return response("revise_course_series", "post").parse(
        JSON.parse(
          await invoke(
            who,
            "revise_course_series",
            [
              q(course),
              q(revision),
              q(JSON.stringify(changes)),
              String(confirm),
            ].join(","),
          ),
        ),
      );
    };
    const sessionRows = async (course) =>
      JSON.parse(
        await sql(
          `select coalesce(jsonb_agg(to_jsonb(s) order by starts_at, id), '[]'::jsonb)
           from public.course_sessions s where course_run_id=${q(course)}`,
        ),
      );

    await sql(
      `update private.course_series_requests set organisation_id = null, time_zone = null
       where actor_id = ${q(planner)} and request_id = ${q(id)}`,
    );
    const standalone = randomUUID();
    await sql(
      `insert into public.course_runs(id, template_id, organisation_id)
       values (${q(standalone)},${q(template)},${q(org)})`,
    );
    assert.equal(await find(planner, standalone), null);
    const legacy = await find(planner, first.run_ids[1]);
    assert.deepEqual(
      legacy.runs.map(({ id }) => id),
      first.run_ids,
    );
    assert.ok(legacy.runs.every(({ pattern }) => pattern === null));
    assert.equal(
      Date.parse(legacy.runs[0].sessions[0].starts_at),
      Date.parse(starts),
      "Reading an old receipt preserves the original session instant",
    );

    const legacyEdit = change(first.run_ids[0], datedPattern(35));
    assert.deepEqual(
      await revise(
        planner,
        first.run_ids[0],
        legacy.revision,
        [legacyEdit],
        true,
      ),
      { run_ids: [first.run_ids[0]], conflicts: [] },
    );
    const revisedLegacy = await find(planner, first.run_ids[1]);
    assert.deepEqual(revisedLegacy.runs[0].pattern, legacyEdit.pattern);
    assert.deepEqual(revisedLegacy.runs[1], legacy.runs[1]);

    const patterns = [datedPattern(40), datedPattern(44)];
    const savedPlanning = [
      patterned(a, "Planning room A", patterns[0]),
      patterned(b, "Planning room B", patterns[1]),
    ];
    const createId = randomUUID();
    const saved = await plan(planner, savedPlanning, createId);
    assert.equal(saved.run_ids.length, 2);
    const [editId, siblingId] = saved.run_ids;
    const snapshot = await find(planner, siblingId);
    assert.equal(snapshot.time_zone, zone);
    assert.deepEqual(
      snapshot.runs.map(({ id }) => id),
      saved.run_ids,
    );
    assert.deepEqual(
      snapshot.runs.map(({ pattern }) => pattern),
      patterns,
    );
    assert.ok(snapshot.runs.every(({ editable }) => editable));
    await assert.rejects(find(outsider, editId), /42501/);
    await assert.rejects(find(participant, editId), /42501/);
    if (!internal) await assert.rejects(find(company, editId), /42501/);
    assert.deepEqual(await find(admin, editId), snapshot);

    const followingYear = DateTime.now().setZone(zone).year + 1;
    const lastSundayOf = (month) => {
      const monthEnd = DateTime.fromObject(
        { year: followingYear, month },
        { zone },
      ).endOf("month");
      return monthEnd.minus({ days: monthEnd.weekday % 7 }).toISODate();
    };
    const springTransition = lastSundayOf(3);
    const autumnTransition = lastSundayOf(10);
    for (const first_day of [springTransition, autumnTransition]) {
      const ambiguousOrMissing = change(editId, {
        ...patterns[0],
        first_day,
        start: "02:10",
        end: "03:30",
      });
      await assert.rejects(
        revise(planner, editId, snapshot.revision, [ambiguousOrMissing], true),
        /22023/,
      );
    }
    const acrossTransition = change(
      editId,
      {
        ...patterns[0],
        first_day: DateTime.fromISO(springTransition)
          .minus({ days: 1 })
          .toISODate(),
        days: 2,
      },
      [0, 1],
    );
    assert.notEqual(
      Date.parse(acrossTransition.sessions[1].starts_at) -
        Date.parse(acrossTransition.sessions[0].starts_at),
      86_400_000,
    );
    assert.deepEqual(
      await revise(planner, editId, snapshot.revision, [acrossTransition]),
      { run_ids: [], conflicts: [] },
    );

    const before = await sessionRows(editId);
    const siblingBefore = await sessionRows(siblingId);
    const patternDay = DateTime.fromISO(patterns[0].first_day, { zone });
    const extend = change(
      editId,
      {
        ...patterns[0],
        days: 2,
        weekdays: [0, 1, 2].map(
          (offset) => patternDay.plus({ days: offset }).weekday,
        ),
        excluded_dates: patternDay.plus({ days: 1 }).toISODate(),
      },
      [0, 2],
    );
    assert.deepEqual(
      await revise(planner, editId, snapshot.revision, [extend]),
      {
        run_ids: [],
        conflicts: [],
      },
    );
    assert.deepEqual(await find(planner, editId), snapshot);
    assert.deepEqual(await sessionRows(editId), before);
    await assert.rejects(
      revise(outsider, editId, snapshot.revision, [extend], true),
      /42501/,
    );

    const contenderPattern = datedPattern(52);
    const contender = await plan(
      planner,
      [
        patterned(a, "Planning room A", contenderPattern),
        patterned(b, "Other planning room", datedPattern(58)),
      ],
      randomUUID(),
    );
    assert.equal(contender.run_ids.length, 2);
    const collision = change(editId, contenderPattern);
    const siblingChange = change(siblingId, datedPattern(60));
    await assert.rejects(
      revise(
        planner,
        editId,
        snapshot.revision,
        [
          extend,
          {
            ...siblingChange,
            pattern: { ...siblingChange.pattern, start: "08:00" },
          },
        ],
        true,
      ),
      /22023/,
    );
    await assert.rejects(
      revise(planner, editId, snapshot.revision, [extend, extend], true),
      /22023/,
    );
    await assert.rejects(
      revise(
        planner,
        editId,
        snapshot.revision,
        [extend, change(contender.run_ids[0], datedPattern(61))],
        true,
      ),
      /22023|42501/,
    );
    const conflict = {
      run_ids: [],
      conflicts: [{ run_no: 1, session_no: 1, reason: "class" }],
    };
    assert.deepEqual(
      await revise(planner, editId, snapshot.revision, [
        collision,
        siblingChange,
      ]),
      conflict,
    );
    assert.deepEqual(
      await revise(
        planner,
        editId,
        snapshot.revision,
        [collision, siblingChange],
        true,
      ),
      conflict,
    );
    assert.deepEqual(await sessionRows(editId), before);
    assert.deepEqual(await sessionRows(siblingId), siblingBefore);
    assert.deepEqual(await find(planner, editId), snapshot);

    const edited = await revise(
      planner,
      editId,
      snapshot.revision,
      [extend],
      true,
    );
    assert.deepEqual(edited, { run_ids: [editId], conflicts: [] });
    const after = await sessionRows(editId);
    assert.equal(after.length, 2);
    assert.deepEqual(
      after[0],
      before[0],
      "The unchanged session must retain its row and identity",
    );
    assert.equal(
      Date.parse(after[1].starts_at),
      Date.parse(extend.sessions[1].starts_at),
      "The revised schedule must honour the chosen weekdays and excluded day",
    );
    assert.deepEqual(await sessionRows(siblingId), siblingBefore);
    const updated = await find(planner, siblingId);
    assert.notEqual(updated.revision, snapshot.revision);
    assert.deepEqual(
      updated.runs.map(({ pattern }) => pattern),
      [extend.pattern, patterns[1]],
    );
    await assert.rejects(
      revise(planner, editId, snapshot.revision, [extend], true),
      /PT409/,
    );
    assert.deepEqual(await plan(planner, savedPlanning, createId), saved);
    assert.equal(
      await sql(
        `select count(*) from private.course_class_assignments
         where (course_id, class_id) in ((${q(editId)},${q(a)}),(${q(siblingId)},${q(b)}))`,
      ),
      "2",
    );

    await sql(
      `update public.course_runs set published = true where id = ${q(siblingId)}`,
    );
    const protectedSnapshot = await find(planner, editId);
    assert.equal(protectedSnapshot.runs[1].editable, false);
    assert.equal(protectedSnapshot.runs[0].editable, true);
    await assert.rejects(
      revise(
        planner,
        editId,
        protectedSnapshot.revision,
        [extend, siblingChange],
        true,
      ),
      /PT409/,
    );
    assert.deepEqual(await sessionRows(editId), after);
    assert.deepEqual(await sessionRows(siblingId), siblingBefore);

    const allocated = contender.run_ids[1];
    const allocatedSessions = await sessionRows(allocated);
    await sql(
      `insert into public.course_enrolments(course_run_id, user_id, enrolled_by)
       values (${q(allocated)},${q(participant)},${q(planner)})`,
    );
    const allocatedSeries = await find(planner, allocated);
    assert.equal(allocatedSeries.runs[1].editable, false);
    await assert.rejects(
      revise(
        planner,
        allocated,
        allocatedSeries.revision,
        [change(allocated, datedPattern(62))],
        true,
      ),
      /PT409/,
    );
    assert.deepEqual(await sessionRows(allocated), allocatedSessions);
    assert.equal(
      await sql(`select count(*) from public.course_enrolments
                 where course_run_id = ${q(allocated)} and user_id = ${q(participant)}`),
      "1",
    );

    const simultaneous = await Promise.allSettled(
      [datedPattern(63), datedPattern(67)].map((pattern) =>
        revise(
          planner,
          editId,
          protectedSnapshot.revision,
          [change(editId, pattern)],
          true,
        ),
      ),
    );
    assert.equal(
      simultaneous.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    assert.match(
      simultaneous.find(({ status }) => status === "rejected").reason.message,
      /PT409/,
    );
    assert.deepEqual(await sessionRows(siblingId), siblingBefore);

    if (!internal) {
      const licensedSnapshot = await find(planner, editId);
      const licensedSessions = await sessionRows(editId);
      const pending = change(editId, datedPattern(71));
      for (const column of ["expires_at", "grace_until"]) {
        await sql(
          `update private.installation_verified_licence
           set ${column} = now() - interval '1 second'
           where installation_id = ${q(installation)}`,
        );
        await assert.rejects(
          revise(planner, editId, licensedSnapshot.revision, [pending], true),
          /42501/,
        );
        assert.deepEqual(await sessionRows(editId), licensedSessions);
        if (column === "expires_at") {
          const graceSnapshot = await find(planner, editId);
          assert.ok(graceSnapshot.runs.every(({ editable }) => !editable));
          assert.deepEqual(
            graceSnapshot.runs.map(({ sessions }) => sessions),
            licensedSnapshot.runs.map(({ sessions }) => sessions),
          );
        } else {
          await assert.rejects(find(planner, editId), /42501/);
        }
      }
      await sql(
        `update private.installation_verified_licence
         set expires_at = ${q(instant(4))}, grace_until = ${q(instant(8))}
         where installation_id = ${q(installation)}`,
      );
      assert.deepEqual(await find(planner, editId), licensedSnapshot);
      assert.deepEqual(await sessionRows(editId), licensedSessions);
    }
    console.log(
      `PASS ${edition}: series creation, scoped pattern revision, stale snapshots, exact session retention and atomic conflict checks`,
    );
  });
}
