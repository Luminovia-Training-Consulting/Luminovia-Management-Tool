/**
 * Per-job references and explicitly shared contact details. Actor-scoped reads never
 * fetch the internal customer directory; writes retain reviewed versions and retry IDs.
 */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

/** Parse an external HTTP(S) destination without credentials or ambiguous control/space characters. */
export function briefingWebUrl(value: string): string | null {
  const text = value.trim();
  if (
    !text ||
    /\s/u.test(text) ||
    [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    return null;
  // Require the authored authority itself to be well-formed: URL() otherwise
  // repairs triple slashes, backslashes, empty ports and encoded host spellings.
  const authority = /^https?:\/\/([^/?#]+)(?:[/?#]|$)/iu.exec(text)?.[1];
  if (
    !authority ||
    text.includes("\\") ||
    !/^(?:[\p{L}\p{N}](?:[\p{L}\p{N}.-]*[\p{L}\p{N}])?|\[[a-f0-9:]+\])(?::[0-9]{1,5})?$/iu.test(
      authority,
    )
  )
    return null;
  const port = /:([0-9]+)$/.exec(authority)?.[1];
  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Validate authored optional fields locally; PostgreSQL independently validates the closed payload. */
export const briefingValuesSchema = z
  .object({
    reference_url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => value === "" || briefingWebUrl(value) !== null),
    reference_label: z.string().trim().max(120),
    reference_description: z.string().trim().max(4000),
    contact_name: z.string().trim().max(120),
    contact_email: z
      .string()
      .trim()
      .max(254)
      .refine(
        (value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value),
      ),
    contact_phone: z
      .string()
      .trim()
      .max(50)
      .refine(
        (value) =>
          ![...value].some(
            (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
          ),
      ),
    contact_description: z.string().trim().max(2000),
    contact_visibility: z.enum(["after_claim", "offer_viewers"]),
  })
  .strict();
/** Editable values exclude all server capability, visibility and version fields. */
export type BriefingValues = z.infer<typeof briefingValuesSchema>;
/** Server projection contains redacted strings when contact visibility is not currently granted. */
export interface JobBriefingData extends BriefingValues {
  version: number;
  has_contact: boolean;
  contact_visible: boolean;
  can_manage: boolean;
  can_edit: boolean;
}
const responseSchema = briefingValuesSchema.extend({
  version: z.number().int().nonnegative(),
  has_contact: z.boolean(),
  contact_visible: z.boolean(),
  can_manage: z.boolean(),
  can_edit: z.boolean(),
});

/** Scope cached contact data to both the authenticated actor and the concrete job. */
export const briefingKey = (actor: string, job: string) =>
  ["job-briefing", actor, job] as const;
/** Access denial must stop retries and hide any previously retained response. */
export function briefingDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ["42501", "PGRST301", "PGRST302"].includes(String(error.code))
  );
}
/** Read only the server-authorized projection, with cancellation and bounded freshness polling. */
export const briefingQuery = (actor: string, job: string) =>
  queryOptions({
    queryKey: briefingKey(actor, job),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_briefing", { p_job_id: job })
        .abortSignal(signal);
      if (error) throw error;
      return responseSchema.parse(data) as JobBriefingData;
    },
    retry: (count, error) => !briefingDenied(error) && count < 1,
    refetchInterval: 30000,
  });

/** Select only writable fields; view capabilities and response metadata never enter a mutation. */
export function briefingValues(data: BriefingValues): BriefingValues {
  return {
    reference_url: data.reference_url,
    reference_label: data.reference_label,
    reference_description: data.reference_description,
    contact_name: data.contact_name,
    contact_email: data.contact_email,
    contact_phone: data.contact_phone,
    contact_description: data.contact_description,
    contact_visibility: data.contact_visibility,
  };
}
/** Normalize an explicit draft and require actual online server confirmation before returning saved state. */
export async function saveBriefing(
  job: string,
  version: number,
  request: string,
  values: BriefingValues,
): Promise<JobBriefingData> {
  requireOnline();
  const payload = briefingValuesSchema.parse(values);
  const { data, error } = await db().rpc("save_job_briefing", {
    p_job_id: job,
    p_expected_version: version,
    p_request_id: request,
    p_payload: payload,
  });
  if (error) throw error;
  const confirmed = responseSchema.parse(data) as JobBriefingData;
  if (confirmed.version <= version) throw new Error("unconfirmed_briefing");
  return confirmed;
}
