/** Shared client and OpenAPI contract for metadata on a single course file share. */
import { z } from "zod";
import { competencyDefinition } from "./competency-schema.ts";

export const materialCompetency = competencyDefinition.extend({
  framework_id: z.uuid(),
  framework_revision: z.number().int().positive(),
});
export type MaterialCompetency = z.infer<typeof materialCompetency>;

export const materialLanguage = z.enum(["", "de", "en", "other"]);

export const materialMetadataSchema = z.strictObject({
  title: z.string().trim().max(160),
  description: z.string().trim().max(2000),
  subject: z.string().trim().max(120),
  licence: z.string().trim().max(160),
  language: materialLanguage,
  learning_objectives: z.string().trim().max(1000).optional(),
  review_on: z
    .union([z.literal(""), z.iso.date().refine((date) => /^[1-9]/.test(date))])
    .optional(),
  competencies: z
    .array(materialCompetency)
    .max(12)
    .refine(
      (links) =>
        new Set(links.map((link) => `${link.framework_id}:${link.id}`)).size ===
        links.length,
    )
    .optional(),
  library_archived: z.boolean().optional(),
  library_master: z.boolean().optional(),
  tags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(40)
        .regex(/^[^,]+$/),
    )
    .max(10)
    .refine(
      (tags) =>
        new Set(tags.map((tag) => tag.toLowerCase())).size === tags.length,
    ),
});

export type MaterialMetadata = z.infer<typeof materialMetadataSchema>;
