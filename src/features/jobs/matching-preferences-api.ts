/** Parsing and online RPC access for teaching preferences and job requirements. */
import { z } from "zod";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

const languageCode = z.string().regex(/^[a-z]{2,3}$/);
export const teachingFormats = ["online", "onsite", "hybrid"] as const;

const preferences = z.object({
  version: z.number().int().nonnegative(),
  delivery_formats: z.array(z.enum(teachingFormats)).max(3),
  teaching_languages: z.array(languageCode).max(12),
  teaching_days: z.array(z.number().int().min(1).max(7)).max(7),
  teaching_start: z.string().nullable(),
  teaching_end: z.string().nullable(),
  urgent_cover: z.boolean(),
});
const requirements = z.object({
  version: z.number().int().positive(),
  can_edit: z.boolean(),
  qualification_topics: z.array(z.uuid()).max(20),
  document_evidence_required: z.boolean(),
  teaching_languages: z.array(languageCode).max(12),
});

export type LecturerPreferences = z.infer<typeof preferences>;
export type JobMatchingRequirements = z.infer<typeof requirements>;

export const matchingPreferencesKey = (actor: string) => [
  "matching-preferences",
  actor,
];
export const matchingRequirementsKey = (actor: string, job: string) => [
  "job-matching-requirements",
  actor,
  job,
];

export function teachingLanguageCodes(input: string) {
  const values = [
    ...new Set(
      input
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean),
    ),
  ];
  return z.array(languageCode).max(12).parse(values);
}

export const matchingConflict = (error: unknown) =>
  z.object({ code: z.literal("40001") }).safeParse(error).success;

export async function loadLecturerPreferences(signal: AbortSignal) {
  requireOnline();
  const { data, error } = await db()
    .rpc("own_lecturer_matching_preferences")
    .abortSignal(signal);
  if (error) throw error;
  return preferences.parse(data);
}

export async function saveLecturerPreferences(
  version: number,
  body: Omit<LecturerPreferences, "version">,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_lecturer_matching_preferences", {
    p_expected_version: version,
    p_payload: body,
  });
  if (error) throw error;
  return preferences.parse(data);
}

export async function loadJobMatchingRequirements(
  job: string,
  signal: AbortSignal,
) {
  requireOnline();
  const { data, error } = await db()
    .rpc("job_matching_requirements", { p_job_id: job })
    .abortSignal(signal);
  if (error) throw error;
  return requirements.parse(data);
}

export async function saveJobMatchingRequirements(
  job: string,
  version: number,
  body: Pick<
    JobMatchingRequirements,
    "qualification_topics" | "teaching_languages" | "document_evidence_required"
  >,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_job_matching_requirements", {
    p_job_id: job,
    p_expected_version: version,
    p_payload: body,
  });
  if (error) throw error;
  return requirements.parse(data);
}
