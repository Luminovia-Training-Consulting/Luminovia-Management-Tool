/** Unit checks for the local rehearsal driver. The native system run owns HTTP evidence. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { rehearseCourseHandover } from "./testing/academy-handover-course.mjs";
import { academyAuthMailLink } from "./testing/academy-auth-mail-link.mjs";

const course = "8ff7aab8-407b-4d98-b88a-e92914bfb19f";
const draft = { course_run_id: course, template_id: "fictional-template" };
const roles = Object.fromEntries(
  ["admin", "teacher", "learner", "outside"].map((id) => [id, { id }]),
);
const enrolled = {
  id: course,
  access: { learner: true },
  time_zone: "Australia/Brisbane",
};
const quiz = {
  published: true,
  version: 1,
  questions: [{ prompt: "Fictional" }],
};
const recorded = { score: 100, passed: true, id: "fictional-attempt" };
const workflow = [
  ["academy_create_course_draft", "learner", 403],
  ["academy_create_course_draft", "admin", draft],
  ["academy_create_course_draft", "admin", draft],
  ["academy_publish_course", "admin", 409],
  ["manage_course_enrolment", "admin", 409],
  ["course_workspace", "learner", 403],
  ["academy_assign_course_instructor", "admin", { status: "confirmed" }],
  ["academy_publish_course", "teacher", 403],
  ["academy_publish_course", "admin", { published: true, capacity: 2 }],
  ["manage_course_enrolment", "admin", 403],
  ["manage_course_enrolment", "admin", 204],
  ["course_workspace", "outside", 403],
  ["course_workspace", "learner", enrolled],
  ["academy_learning_action", "learner", 403],
  ["academy_learning_action", "teacher", { id: null, saved: true }],
  ["course_workspace", "learner", { quiz }],
  ["academy_learning_action", "outside", 403],
  ["academy_learning_action", "learner", 400],
  ["academy_learning_action", "learner", recorded],
  ["academy_learning_action", "learner", recorded],
  [
    "course_workspace",
    "learner",
    { quiz: { attempts: 1, passed: true, last_score: 100 } },
  ],
];

function fixture(change = {}) {
  const steps = workflow.map((step, index) => change[index] ?? step);
  const calls = [];
  let sessionStarted = false;
  return {
    args: {
      organisation: "fictional-organisation",
      ...roles,
      now: Date.parse("2026-11-24T04:00:00Z"),
      startSession(id) {
        assert.equal(id, course);
        assert.equal(calls.length, 18);
        sessionStarted = true;
      },
      async request(path, actor, input) {
        if (calls.length >= 18) assert.equal(sessionStarted, true);
        const [operation, role, result] = steps[calls.length];
        assert.equal(path, "/rest/v1/rpc/" + operation);
        assert.equal(actor.id, role);
        calls.push(input);
        return typeof result === "number"
          ? new Response(null, { status: result })
          : Response.json(result);
      },
    },
    calls,
  };
}

test("observes role denials, reuses operation IDs and records progress only after start", async () => {
  const { args, calls } = fixture();
  assert.equal(await rehearseCourseHandover(args), course);
  assert.equal(calls.length, workflow.length);
  assert.deepEqual(calls[1], calls[2]);
  assert.deepEqual(calls[18], calls[19]);
  assert.equal(calls[9].p_user_id, roles.outside.id);
  assert.equal(calls[10].p_user_id, roles.learner.id);
  assert.deepEqual(calls[1].p_payload.sessions, [
    {
      starts_at: "2026-11-25T04:00:00.000Z",
      ends_at: "2026-11-25T05:00:00.000Z",
    },
  ]);
});

test("refuses a handover receipt when an assigned lecturer can publish", async () => {
  const { args, calls } = fixture({
    7: ["academy_publish_course", "teacher", { published: true }],
  });
  await assert.rejects(rehearseCourseHandover(args), /academy_publish_course/);
  assert.equal(calls.length, 8);
});

test("refuses a learner projection containing the answer key", async () => {
  const { args, calls } = fixture({
    15: [
      "course_workspace",
      "learner",
      { quiz: { ...quiz, questions: [{ correct: 1 }] } },
    ],
  });
  await assert.rejects(rehearseCourseHandover(args), { code: "ERR_ASSERTION" });
  assert.equal(calls.length, 16);
});

test("selects the one-use invitation action after the informational sign-in link", () => {
  const origin = "http://127.0.0.1:54321";
  const html = [
    `<a href="${origin}/login">Sign in</a>`,
    `<a href="${origin}/auth/callback?token_hash=fictional&amp;type=invite">Accept invitation</a>`,
  ].join("");
  const callback = academyAuthMailLink(
    html,
    origin,
    "/auth/callback",
    "invite",
    "token_hash",
  );
  assert.equal(callback.searchParams.get("token_hash"), "fictional");
});

test("rejects foreign, missing, duplicate and confused Auth actions", () => {
  const origin = "http://127.0.0.1:54321";
  const action = `<a href="${origin}/auth/v1/verify?token=fictional&amp;type=recovery">Recover</a>`;
  const read = (html) =>
    academyAuthMailLink(html, origin, "/auth/v1/verify", "recovery", "token");
  assert.equal(read(action).pathname, "/auth/v1/verify");
  for (const html of [
    "",
    action.replace("54321", "54322"),
    action + action,
    action.replace("type=recovery", "type=invite"),
    action.replace("token=fictional", "token=first&amp;token=second"),
  ])
    assert.throws(() => read(html), /exactly one local Auth action link/);
});
