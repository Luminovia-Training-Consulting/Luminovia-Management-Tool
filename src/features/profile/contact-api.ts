import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

export const contactPreferencesSchema = z.object({
  email_visible: z.boolean(),
  phone_visible: z.boolean(),
  version: z.number().int().nonnegative(),
  can_share: z.boolean(),
  email_address: z.string().nullable(),
  phone_number: z.string().nullable(),
});
export type ContactPreferences = z.infer<typeof contactPreferencesSchema>;
export const contactVisibilityKey = (actor: string) =>
  ["contact-visibility", actor] as const;
export const contactVisibilityQuery = (actor: string) =>
  queryOptions({
    queryKey: contactVisibilityKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("contact_visibility_preferences")
        .abortSignal(signal);
      if (error) throw error;
      return contactPreferencesSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
export async function saveContactVisibility(
  value: Pick<
    ContactPreferences,
    "email_visible" | "phone_visible" | "version"
  >,
) {
  requireOnline();
  const { version, ...payload } = value;
  const { data, error } = await db().rpc(
    "save_contact_visibility_preferences",
    { p_payload: payload, p_expected_version: version },
  );
  if (error) throw error;
  return contactPreferencesSchema.parse(data);
}
export const personContactSchema = z.object({
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export const personContactQuery = (actor: string, target: string) =>
  queryOptions({
    queryKey: ["person-contact", actor, target],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("person_contact", { p_user_id: target })
        .abortSignal(signal);
      if (error) throw error;
      return personContactSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
export function contactEmailLink(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !value.includes("\\")
    ? `mailto:${encodeURIComponent(value)}`
    : null;
}
export function contactPhoneLink(value: string) {
  if (!/^[+0-9 ()./-]{3,50}$/.test(value)) return null;
  const number = value.replace(/[ ()./-]/g, "");
  return /^\+?\d{3,20}$/.test(number) ? `tel:${number}` : null;
}
