import { z } from "zod";

const identity = { installation_id: z.uuid() };
const id = z.uuid();
const date = z.iso.datetime({ offset: true });
const scope = z.enum(["installation", "course"]);

const grant = z.strictObject({
  id,
  grantee_id: id,
  grantee_email: z.email(),
  granted_by: id,
  scope,
  purpose: z.string(),
  course_id: id.nullable(),
  granted_at: date,
  expires_at: date,
  revoked_by: id.nullable(),
  revoked_at: date.nullable(),
  status: z.enum(["active", "expired", "revoked"]),
});

const decision = { ...identity, id };
export const academySupportReply = z.discriminatedUnion("action", [
  z.strictObject({
    ...identity,
    action: z.literal("list"),
    can_manage: z.boolean(),
    can_issue: z.boolean(),
    can_read: z.boolean(),
    grants: z.array(grant).max(100),
  }),
  z.strictObject({ ...decision, action: z.literal("grant") }),
  z.strictObject({ ...decision, action: z.literal("revoke") }),
  z.strictObject({
    ...decision,
    action: z.literal("audit"),
    events: z
      .array(
        z.strictObject({
          kind: z.enum(["granted", "revoked", "expired", "read"]),
          actor_id: id.nullable(),
          at: date,
        }),
      )
      .max(103),
  }),
  z.strictObject({
    ...decision,
    action: z.literal("read"),
    expires_at: date,
    diagnostic: z.discriminatedUnion("scope", [
      z.strictObject({
        scope: z.literal("installation"),
        edition: z.enum(["customer-self-hosted", "customer-managed"]),
        release: z.string().regex(/^[a-f0-9]{40}$/),
        licence: z.literal("active"),
      }),
      z.strictObject({
        scope: z.literal("course"),
        course_id: id,
        published: z.boolean(),
        session_count: z.int().min(0),
      }),
    ]),
  }),
]);

const oneGrant = z.strictObject({ id });
export const academySupportRequest = z.discriminatedUnion("p_action", [
  z.strictObject({
    p_action: z.literal("list"),
    p_payload: z.strictObject({}).optional(),
  }),
  z.strictObject({
    p_action: z.literal("grant"),
    p_payload: z.strictObject({
      id,
      recipient_email: z.email(),
      scope,
      purpose: z.string().min(8).max(240),
      duration_minutes: z.int().min(15).max(1440),
      course_id: id.nullable().optional(),
    }),
  }),
  z.strictObject({ p_action: z.literal("revoke"), p_payload: oneGrant }),
  z.strictObject({ p_action: z.literal("audit"), p_payload: oneGrant }),
  z.strictObject({ p_action: z.literal("read"), p_payload: oneGrant }),
]);

export type AcademySupportRequest = z.infer<typeof academySupportRequest>;
export type AcademySupportReply = z.infer<typeof academySupportReply>;
