/** Drive course publication and learner progress through the ordinary Academy REST API. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * The caller provides clients signed in to an isolated Academy. Only the owning
 * manager publishes/enrols and only staff configure quizzes. No privileged
 * fixture credentials are used for the course workflow itself.
 */
export async function rehearseCourseHandover({
  request,
  organisation,
  admin,
  teacher,
  learner,
  outside,
  startSession,
  now = Date.now(),
}) {
  const rpc = async (path, actor, input, expected = 200) => {
    const response = await request("/rest/v1/rpc/" + path, actor, input);
    if (response.status !== expected) await response.body?.cancel();
    assert.equal(response.status, expected, path);
    if (expected === 200) return response.json();
    await response.body?.cancel();
  };
  const start = new Date(now + 86_400_000).toISOString();
  const end = new Date(now + 90_000_000).toISOString();
  const creation = {
    p_request_id: randomUUID(),
    p_organisation_id: organisation,
    p_template_id: null,
    p_template_title: "Fictional Workshop",
    p_payload: {
      time_zone: "Australia/Brisbane",
      delivery_type: "online",
      venue: "",
      sessions: [{ starts_at: start, ends_at: end }],
    },
  };
  await rpc("academy_create_course_draft", learner, creation, 403);
  const draft = await rpc("academy_create_course_draft", admin, creation);
  const course = draft.course_run_id;
  assert.match(course, /^[a-f0-9-]{36}$/i);
  assert.deepEqual(
    await rpc("academy_create_course_draft", admin, creation),
    draft,
  );
  const publish = { p_course_id: course, p_capacity: 2 };
  const enrol = {
    p_course_run_id: course,
    p_user_id: learner.id,
    p_status: "enrolled",
  };
  const workspace = { p_run_id: course };
  await rpc("academy_publish_course", admin, publish, 409);
  await rpc("manage_course_enrolment", admin, enrol, 409);
  await rpc("course_workspace", learner, workspace, 403);

  const assigned = await rpc("academy_assign_course_instructor", admin, {
    p_course_id: course,
    p_instructor_id: teacher.id,
    p_request_id: randomUUID(),
  });
  assert.equal(assigned.status, "confirmed");
  await rpc("academy_publish_course", teacher, publish, 403);
  assert.deepEqual(await rpc("academy_publish_course", admin, publish), {
    published: true,
    capacity: 2,
  });
  await rpc(
    "manage_course_enrolment",
    admin,
    { ...enrol, p_user_id: outside.id },
    403,
  );
  await rpc("manage_course_enrolment", admin, enrol, 204);
  await rpc("course_workspace", outside, workspace, 403);
  const enrolled = await rpc("course_workspace", learner, workspace);
  assert.equal(enrolled.id, course);
  assert.equal(enrolled.access.learner, true);
  assert.equal(enrolled.time_zone, creation.p_payload.time_zone);

  const quizConfig = {
    ...workspace,
    p_action: "quiz_config",
    p_payload: {
      questions: [
        {
          prompt: "What is the fictional lesson's correct choice?",
          options: ["Choice A", "Choice B"],
          correct: 1,
        },
      ],
      published: true,
      pass_percent: 80,
      max_attempts: 2,
    },
    p_expected_version: 0,
  };
  await rpc("academy_learning_action", learner, quizConfig, 403);
  await rpc("academy_learning_action", teacher, quizConfig);
  const before = (await rpc("course_workspace", learner, workspace)).quiz;
  assert.equal(before.published, true);
  assert.equal(Object.hasOwn(before.questions[0], "correct"), false);
  const attempt = {
    ...workspace,
    p_action: "quiz_attempt",
    p_payload: { answers: [1], request_id: randomUUID() },
    p_expected_version: before.version,
  };
  await rpc("academy_learning_action", outside, attempt, 403);
  await rpc("academy_learning_action", learner, attempt, 400);
  // Advance this single fictional session without waiting until tomorrow.
  // Publication, enrolment, quiz configuration and attempts stay on REST.
  await startSession(course);
  const recorded = await rpc("academy_learning_action", learner, attempt);
  assert.equal(recorded.score, 100);
  assert.equal(recorded.passed, true);
  assert.deepEqual(
    await rpc("academy_learning_action", learner, attempt),
    recorded,
  );
  const progress = (await rpc("course_workspace", learner, workspace)).quiz;
  assert.equal(progress.attempts, 1);
  assert.equal(progress.passed, true);
  assert.equal(progress.last_score, 100);
  return course;
}
