/** Retain licensed source metadata separately from native quiz answer keys. */
import { z } from "zod";
import { objectiveQuestionInput } from "./question-bank-schema.ts";

export const h5pSimpleLibraries = [
  "H5P.MultiChoice 1.16",
  "H5P.TrueFalse 1.8",
] as const;
export const h5pCollectionLibraries = [
  "H5P.SingleChoiceSet 1.11",
  "H5P.QuestionSet 1.20",
  "H5P.QuestionSet 1.21",
] as const;
export const h5pCollectionLimit = 20;

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
const attribution = z.strictObject({
  title: z.string().trim().min(1).max(150),
  language: z.string().regex(/^([a-z]{2}|und)$/),
  library: z.enum([...h5pSimpleLibraries, ...h5pCollectionLibraries]),
  license: z.enum(["CC0-1.0", "CC-BY-4.0"]),
  authors: z.array(author).max(10),
  source_url: source.nullable(),
  license_notice: z.string().max(1000).nullable(),
  changes: z.array(change).max(10),
});
const simpleAttribution = attribution.extend({
  library: z.enum(h5pSimpleLibraries),
});
export const h5pAttributionSchema = attribution.extend({
  subcontent: simpleAttribution.optional(),
});

const packageDigest = z.string().regex(/^[0-9a-f]{64}$/);
export const h5pQuestionImportSchema = z.strictObject({
  package_sha256: packageDigest,
  attribution: simpleAttribution,
  question: objectiveQuestionInput,
});
export const h5pCollectionItemSchema = z.strictObject({
  question: objectiveQuestionInput,
  library: z.enum([...h5pSimpleLibraries, "H5P.SingleChoiceSet 1.11"]),
  subcontent: simpleAttribution.nullable(),
});
export const h5pCollectionImportSchema = z.strictObject({
  package_sha256: packageDigest,
  attribution: attribution.extend({ library: z.enum(h5pCollectionLibraries) }),
  questions: z.array(h5pCollectionItemSchema).min(1).max(h5pCollectionLimit),
});
export type H5pAttribution = z.infer<typeof h5pAttributionSchema>;
export type H5pQuestionImport = z.infer<typeof h5pQuestionImportSchema>;
export type H5pCollectionImport = z.infer<typeof h5pCollectionImportSchema>;
export type H5pCollectionItem = z.infer<typeof h5pCollectionItemSchema>;
export type H5pImport = H5pQuestionImport | H5pCollectionImport;
