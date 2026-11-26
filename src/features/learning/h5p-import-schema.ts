/** Persist the package's declared licensing metadata separately from the correct answer. */
import { z } from "zod";
import { objectiveQuestionSchema } from "./question-bank-schema.ts";

export const h5pLibraries = [
  "H5P.MultiChoice 1.16",
  "H5P.TrueFalse 1.8",
] as const;
const source = z
  .string()
  .max(500)
  .regex(/^https?:\/\/[a-zA-Z0-9.-]+(?::[0-9]{1,5})?(?:[/?#][^\s\\]*)?$/i);
const author = z.strictObject({
  name: z.string().trim().min(1).max(150),
  role: z.enum(["Author", "Editor", "Licensee", "Originator"]),
});
const change = z.strictObject({
  author: z.string().trim().min(1).max(150),
  date: z.string().trim().min(1).max(100),
  log: z.string().trim().min(1).max(500),
});
export const h5pAttributionSchema = z.strictObject({
  title: z.string().trim().min(1).max(150),
  language: z.string().regex(/^([a-z]{2}|und)$/),
  library: z.enum(h5pLibraries),
  license: z.enum(["CC0-1.0", "CC-BY-4.0"]),
  authors: z.array(author).max(10),
  source_url: source.nullable(),
  license_notice: z.string().max(1000).nullable(),
  changes: z.array(change).max(10),
});
export const h5pQuestionImportSchema = z.strictObject({
  package_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  attribution: h5pAttributionSchema,
  question: objectiveQuestionSchema,
});
export type H5pAttribution = z.infer<typeof h5pAttributionSchema>;
export type H5pQuestionImport = z.infer<typeof h5pQuestionImportSchema>;
