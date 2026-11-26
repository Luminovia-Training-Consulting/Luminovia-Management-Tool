import { expect, it } from "vitest";
import {
  weightedGradeCommand,
  weightedGradebookResult,
  weightedPolicyDraft,
  type WeightedGradebook,
} from "./weighted-gradebook-schema";

const runId = "08e23555-68cd-4852-aede-ee24fa312e20";
const learnerId = "08e23555-68cd-4852-aede-ee24fa312e21";
const assignmentId = "08e23555-68cd-4852-aede-ee24fa312e22";
const validPolicy = {
  threshold: 50,
  missing_required: "block",
  separate_reviewer: true,
  items: [
    { key: "quiz", weight: 50, treatment: "required" },
    { key: "exam", weight: 50, treatment: "optional" },
    { key: assignmentId, weight: 15, treatment: "bonus" },
  ],
};

it("requires distinct assessment sources and validates base and bonus weights independently", () => {
  expect(weightedPolicyDraft.safeParse(validPolicy).success).toBe(true);
  expect(
    weightedPolicyDraft.safeParse({
      ...validPolicy,
      items: [
        { key: "quiz", weight: 85, treatment: "required" },
        validPolicy.items[2],
      ],
    }).success,
  ).toBe(false);
  expect(
    weightedPolicyDraft.safeParse({
      ...validPolicy,
      items: [
        ...validPolicy.items,
        { key: "quiz", weight: 1, treatment: "bonus" },
      ],
    }).success,
  ).toBe(false);
  expect(
    weightedPolicyDraft.safeParse({
      ...validPolicy,
      items: [
        { key: "quiz", weight: 100, treatment: "required" },
        { key: "exam", weight: 90, treatment: "bonus" },
        validPolicy.items[2],
      ],
    }).success,
  ).toBe(false);
});

it("binds review to a snapshot and requires release preconditions", () => {
  const target = {
    user_id: learnerId,
    expected_review: 1,
    expected_release: 0,
  };
  const command = { p_run_id: runId, p_expected_policy: 1 };
  expect(
    weightedGradeCommand.safeParse({
      ...command,
      p_action: "release",
      p_payload: target,
    }).success,
  ).toBe(true);
  expect(
    weightedGradeCommand.safeParse({
      ...command,
      p_action: "release",
      p_payload: { user_id: learnerId, expected_review: 1 },
    }).success,
  ).toBe(false);
  expect(
    weightedGradeCommand.safeParse({
      ...command,
      p_action: "review",
      p_payload: { ...target, fingerprint: "f".repeat(64), reason: "" },
    }).success,
  ).toBe(true);
  expect(
    weightedGradeCommand.safeParse({
      ...command,
      p_action: "review",
      p_payload: { ...target, fingerprint: "unexpected", reason: "" },
    }).success,
  ).toBe(false);
});

it("validates the released learner result and rejects raw evidence in the projection", () => {
  const projection: WeightedGradebook = {
    can_manage: false,
    policy: null,
    sources: [],
    preview: null,
    fingerprint: null,
    review: null,
    exemptions: {},
    latest_release: 1,
    history: [
      {
        released_at: "2026-11-26T10:00:00Z",
        revision: 1,
        reason: null,
        result: {
          policy_version: 1,
          threshold: 50,
          missing_required: "block",
          percent: 50,
          passed: true,
          components: [
            {
              key: "quiz",
              label: null,
              weight: 100,
              treatment: "required",
              score: 50,
              status: "graded",
            },
          ],
        },
      },
    ],
    next_before: null,
  };
  expect(weightedGradebookResult.safeParse(projection).success).toBe(true);
  const [release] = projection.history;
  expect(
    weightedGradebookResult.safeParse({
      ...projection,
      history: [
        {
          ...release,
          result: { ...release.result, basis: { attempt: assignmentId } },
        },
      ],
    }).success,
  ).toBe(false);
});

it("accepts nested assessment categories and rejects dangling references or cycles", () => {
  const root = {
    id: "be638957-4531-4984-a2c7-5471aa2b5b3c",
    label: "Practice",
  };
  const child = {
    id: "204e5964-7597-4e2a-bc30-2310c4a51b14",
    label: "Workshop",
    parent_id: root.id,
  };
  const grouped = {
    ...validPolicy,
    categories: [root, child],
    items: [
      { ...validPolicy.items[0], category_id: child.id },
      ...validPolicy.items.slice(1),
    ],
  };
  expect(weightedPolicyDraft.safeParse(grouped).success).toBe(true);
  expect(
    weightedPolicyDraft.safeParse({ ...grouped, categories: [root] }).success,
  ).toBe(false);
  expect(
    weightedPolicyDraft.safeParse({ ...grouped, categories: [child, root] })
      .success,
  ).toBe(false);
  expect(
    weightedPolicyDraft.safeParse({
      ...grouped,
      categories: [{ ...root, parent_id: child.id }, child],
    }).success,
  ).toBe(false);
});
