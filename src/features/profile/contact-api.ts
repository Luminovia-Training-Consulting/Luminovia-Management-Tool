import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import {
  contactPreferencesSchema,
  personContactSchema,
} from "./privacy-schema";

export type ContactPreferences = ReturnType<
  typeof contactPreferencesSchema.parse
>;
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
