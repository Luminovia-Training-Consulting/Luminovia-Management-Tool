/** Form validation and the role-scoped course gradebook response contract. */
import { z } from "zod";

export const courseGradeBandSchema = z
  .object({
    minimum: z.number().int().min(0).max(100),
    label: z.string().trim().min(1).max(80),
  })
  .strict();

const bandPolicySchema = z
  .object({
    scheme: z.literal("bands"),
    bands: z.array(courseGradeBandSchema).min(2).max(10),
  })
  .strict()
  .superRefine(({ bands }, context) => {
    if (!bands.some(({ minimum }) => minimum === 0)) {
      context.addIssue({
        code: "custom",
        path: ["bands"],
        message: "A band beginning at zero is required",
      });
    }
    if (new Set(bands.map(({ minimum }) => minimum)).size !== bands.length) {
      context.addIssue({
        code: "custom",
        path: ["bands"],
        message: "Band thresholds must be unique",
      });
    }
    if (
      new Set(bands.map(({ label }) => label.toLocaleLowerCase())).size !==
      bands.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["bands"],
        message: "Band labels must be unique",
      });
    }
  });

export const courseGradePolicySchema = z.discriminatedUnion("scheme", [
  z.object({ scheme: z.literal("percentage"), bands: z.tuple([]) }).strict(),
  bandPolicySchema,
]);

export type CourseGradePolicy = z.infer<typeof courseGradePolicySchema>;

export interface CourseGradebookMark {
  revision: number;
  attempt_id: string;
  quiz_version: number;
  score: number;
  passed: boolean;
  policy_version: number;
  grade_percent: number | null;
  grade_label: string | null;
  corrected: boolean;
  published_at: string;
  reason?: string | null;
}

export interface CourseGradebookHistory {
  revisions: CourseGradebookMark[];
  next_before: number | null;
}

export interface CourseGradebookExportRow {
  user_id: string;
  name: string;
  grade: CourseGradebookMark;
}

export interface CourseGradebook {
  can_manage: boolean;
  policy: {
    version: number;
    scheme: "percentage" | "bands";
    bands: { minimum: number; label: string }[];
    created_at: string;
  } | null;
  learners: {
    user_id: string;
    name: string;
    status: "enrolled" | "completed";
    best_attempt: {
      id: string;
      quiz_version: number;
      score: number;
      passed: boolean;
      created_at: string;
    } | null;
    preview: {
      grade_percent: number | null;
      grade_label: string | null;
    } | null;
    grade: CourseGradebookMark | null;
  }[];
  own_grade: CourseGradebookMark | null;
  total: number;
  offset: number;
  limit: number;
}

export const gradebookPageSize = 20;
