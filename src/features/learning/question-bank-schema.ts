/** Exact bank revisions are references in the builder; manual rows contain their own answer key. */
import { z } from "zod";

export const questionDifficulties = [
  "introductory",
  "intermediate",
  "advanced",
] as const;
export const questionBankPageSize = 20;

export const objectiveQuestionSchema = z.strictObject({
  prompt: z.string().trim().min(1).max(500),
  options: z.array(z.string().trim().min(1).max(300)).min(2).max(6),
  correct: z.number().int().min(0).max(5),
});
export const objectiveQuestionInput = objectiveQuestionSchema.refine(
  ({ options, correct }) => correct < options.length,
  { path: ["correct"], message: "Choose an existing answer option" },
);

export const bankReferenceSchema = z.strictObject({
  question_id: z.uuid(),
  revision: z.number().int().positive(),
});
export const bankQuestionContentSchema = z.strictObject({
  topic: z.string().trim().min(1).max(120),
  difficulty: z.enum(questionDifficulties),
  content: objectiveQuestionInput,
});

export type BankReference = z.infer<typeof bankReferenceSchema>;
export type BankQuestionContent = z.infer<typeof bankQuestionContentSchema>;
export type ObjectiveQuestion = z.infer<typeof objectiveQuestionInput>;

export interface BankQuestion extends BankQuestionContent {
  id: string;
  revision: number;
  archived: boolean;
  can_edit: boolean;
}
