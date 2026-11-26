/** Covers checkpoint recovery with the real HTTP clients and fictional loopback services. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  dispatchCourseArchives,
  runXapiDispatchCli,
} from "./xapi-lrs-dispatch.mjs";

const course = "0af5df12-b77d-4ad4-bdea-7d53193756ab";
const other = "510aef19-43f3-46eb-ba20-1009466e98b0";
const fixtureTime = Date.parse("2026-11-26T01:05:00Z");
const midnight = "2026-11-26T00:00:00.000Z";
const halfHour = "2026-11-26T00:30:00.000Z";
const end = "2026-11-26T01:00:00.000Z";
const accepted = { submitted: 1, retries: 0, pending: 0, failure: null };

test("bisects the export limit before checking off a complete time window", async () => {
  const state = { version: 1, courses: {} };
  const ranges = [];
  const checkpoints = [];
  const reports = await dispatchCourseArchives({
    courses: [{ id: course, from: midnight }],
    state,
    now: fixtureTime,
    exportWindow: (id, from, until) => {
      ranges.push([id, from, until]);
      return from === midnight && until === end ? { overflow: true } : {};
    },
    deliver: () => accepted,
    save: (next) => checkpoints.push(next),
  });
  assert.deepEqual(ranges, [
    [course, midnight, end],
    [course, midnight, halfHour],
    [course, halfHour, end],
  ]);
  assert.deepEqual(checkpoints, [{ version: 1, courses: { [course]: end } }]);
  assert.deepEqual(reports, [
    { course, through: end, submitted: 2, retries: 0, failure: null },
  ]);
});

test("keeps an unpersisted checkpoint unchanged and still processes a second course", async () => {
  const state = { version: 1, courses: { [course]: halfHour } };
  const reports = await dispatchCourseArchives({
    courses: [
      { id: course, from: midnight },
      { id: other, from: halfHour },
    ],
    state,
    now: fixtureTime,
    exportWindow: () => ({}),
    deliver: () => accepted,
    save: (next) => {
      if (!next.courses[other]) throw new Error("Fictional disk failure");
    },
  });
  assert.equal(reports[0].failure, "export_or_checkpoint");
  assert.equal(state.courses[course], halfHour);
  assert.equal(reports[1].failure, null);
  assert.equal(state.courses[other], end);
});

test("restarts a partial delivery from the saved range with unchanged statement IDs", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "lms-xapi-dispatch-"));
  context.after(() => rm(directory, { recursive: true }));
  const config = join(directory, "courses.json");
  const checkpoint = join(directory, "checkpoint.json");
  const from = new Date(Date.now() - 900_000).toISOString();
  await writeFile(config, JSON.stringify({ courses: [{ id: course, from }] }));
  const statements = Array.from({ length: 2 }, () => ({
    id: randomUUID(),
    timestamp: from,
    actor: {
      objectType: "Agent",
      account: { homePage: "https://luminovia.org", name: "a".repeat(64) },
    },
    verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
    object: {
      objectType: "Activity",
      id: "https://luminovia.org/xapi/activities/course/" + "b".repeat(64),
    },
    result: { completion: true },
  }));
  const received = [];
  const attempts = [];
  let rejectSecondStatement = true;
  const server = createServer(async (request, response) => {
    const parts = [];
    for await (const buffer of request) parts.push(buffer);
    const body = JSON.parse(Buffer.concat(parts));
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/backend/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "password");
      assert.equal(body.email, "course-manager@example.invalid");
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          access_token: "fixture-user-token",
          refresh_token: "fictional-refresh",
          expires_in: 1200,
          token_type: "bearer",
          user: { id: randomUUID() },
        }),
      );
    } else if (url.pathname === "/backend/rest/v1/rpc/course_xapi_statements") {
      assert.equal(request.headers.authorization, "Bearer fixture-user-token");
      assert.equal(body.p_run_id, course);
      attempts.push(body);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          profile: "luminovia-lms-1",
          xapi_version: "1.0.3",
          statements,
        }),
      );
    } else {
      assert.equal(url.pathname, "/xapi/statements");
      assert.equal(request.method, "PUT");
      assert.equal(request.headers["x-experience-api-version"], "1.0.3");
      assert.equal(url.searchParams.get("statementId"), body.id);
      received.push(body);
      response
        .writeHead(
          rejectSecondStatement && body.id === statements[1].id ? 409 : 204,
        )
        .end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const env = {
    LMS_XAPI_PORTAL_URL: base + "/backend",
    LMS_XAPI_PORTAL_PUBLISHABLE_KEY: "fixture-key",
    LMS_XAPI_PORTAL_EMAIL: "course-manager@example.invalid",
    LMS_XAPI_PORTAL_PASSWORD: "fixture-portal-password",
    LMS_XAPI_LRS_ENDPOINT: base + "/xapi",
    LMS_XAPI_LRS_USERNAME: "fixture-lrs",
    LMS_XAPI_LRS_PASSWORD: "fixture-lrs-password",
  };
  const [partial] = await runXapiDispatchCli(config, checkpoint, env);
  assert.equal(partial.failure, 409);
  assert.equal(partial.submitted, 1);
  await assert.rejects(readFile(checkpoint, "utf8"), { code: "ENOENT" });
  rejectSecondStatement = false;
  const [complete] = await runXapiDispatchCli(config, checkpoint, env);
  assert.equal(complete.failure, null);
  assert.equal(complete.submitted, 2);
  assert.ok(attempts.every((request) => request.p_from === from));
  assert.deepEqual(received, [...statements, ...statements]);
  const saved = JSON.parse(await readFile(checkpoint, "utf8"));
  assert.deepEqual(saved, {
    version: 1,
    courses: { [course]: complete.through },
  });
});
