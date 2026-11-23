import { z } from "zod";

export const classScore = z.number().int().min(1).max(5);
export const classRating = z.object({
  score: classScore,
  comment: z.string().max(2000),
  version: z.number().int().positive(),
});

export const classFeedback = z.object({
  count: z.number().int().nonnegative(),
  average: z.number().min(1).max(5).nullable(),
  comments: z.object({
    items: z
      .array(
        z.discriminatedUnion("source", [
          z.object({
            id: z.uuid(),
            comment: z.string().max(2000),
            source: z.literal("lecturer"),
            score: classScore,
          }),
          z.object({
            id: z.uuid(),
            comment: z.string().min(1).max(2000),
            source: z.literal("company"),
            score: z.null(),
          }),
        ]),
      )
      .max(25),
    next: z.uuid().nullable(),
  }),
  rating: classRating.nullable(),
  can_rate: z.boolean(),
  can_comment: z.boolean(),
});
