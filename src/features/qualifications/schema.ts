import { z } from "zod";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const evidence = z.object({
  id: uuid,
  version_id: uuid,
  document_id: uuid,
  name: z.string(),
  sha256: hash,
  created_at: instant,
});
export const qualificationReviewSchema = z.object({
  user_id: uuid,
  topic_id: uuid,
  version: z.number().int().nonnegative(),
  verified: z.boolean(),
  valid_until: instant.nullable(),
  evidence: evidence.nullable(),
});
const certificate = z.object({
  version_id: uuid,
  document_id: uuid,
  name: z.string(),
  sha256: hash,
  version: z.number().int().positive(),
  created_at: instant,
});
const event = z.object({
  id: uuid,
  action: z.enum(["bind", "withdraw", "deselect", "attest"]),
  version: z.number().int().positive(),
  evidence_id: uuid.nullable(),
  verified: z.boolean().nullable(),
  valid_until: instant.nullable(),
  basis: z.enum(["management_attestation", "document_evidence"]).nullable(),
  created_at: instant,
  actor_name: z.string().nullable(),
});
const cursorSchema = z.object({ at: instant, id: uuid });
const page = <T extends z.ZodType>(item: T) => {
  const items = z.array(item).max(50);
  return z.discriminatedUnion("has_more", [
    z.object({ items, has_more: z.literal(false), next_cursor: z.null() }),
    z.object({ items, has_more: z.literal(true), next_cursor: cursorSchema }),
  ]);
};
export type Cursor = z.infer<typeof cursorSchema>;
export type Certificate = z.infer<typeof certificate>;
export const qualificationCertificatePage = page(certificate);
export const qualificationHistoryPage = page(event);
