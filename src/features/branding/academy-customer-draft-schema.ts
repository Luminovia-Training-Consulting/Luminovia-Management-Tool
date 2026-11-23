import { z } from "zod";
import {
  academyBrandColor,
  academyBrandName,
  academyBrandShortName,
} from "./academy-branding-schema.ts";
import {
  licenceLimits,
  reference,
  releaseCommit,
} from "./academy-licence-fields.ts";

export const academyReservedRoots = [
  "/opt/luminovia-portal",
  "/var/backups/luminovia-complete",
];
const inside = (candidate: string, parent: string) =>
  candidate === parent || candidate.startsWith(parent + "/");
export const academyPathsOverlap = (a: string, b: string) =>
  inside(a, b) || inside(b, a);

const privateLabel = (length: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(length)
    .regex(/^[^\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>]+$/u);
const email = z.email().max(254).toLowerCase();
export const academyDomainLabels =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const origin = z
  .string()
  .max(261)
  .toLowerCase()
  .regex(/^https:\/\/[a-z0-9.-]+\/?$/)
  .refine((value) =>
    academyDomainLabels.test(value.slice(8).replace(/\/$/, "")),
  )
  .transform((value) => new URL(value).origin);
const timeZone = z
  .string()
  .max(80)
  .regex(/^[A-Za-z][A-Za-z0-9_+/-]*$/)
  .refine((zone) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return true;
    } catch {
      return false;
    }
  });
const localHostname =
  /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/;
const fixtureHostname = /(?:^|\.)example\.(?:com|org|net)$/;
const vendorHostname = /(?:^|\.)luminovia\.org$/;

export const academyCustomerDraftSchema = z
  .strictObject({
    version: z.literal(1),
    request_id: z.uuidv4().toLowerCase(),
    purpose: z.enum(["customer", "rehearsal"]),
    legal_customer_name: privateLabel(120),
    branding: z.strictObject({
      name: academyBrandName,
      short_name: academyBrandShortName,
      theme: z.enum(["light", "dark", "system"]),
      theme_color: academyBrandColor.toLowerCase(),
      approved_assets_reference: reference,
    }),
    initial_administrator: z.strictObject({
      email,
      username: z
        .string()
        .regex(/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/)
        .nullish()
        .transform((name) => name ?? null),
    }),
    target: z.strictObject({
      edition: z.enum(["customer-self-hosted", "customer-managed"]),
      portal_origin: origin,
      domain_status: z.enum(["verified-by-operator", "temporary-pending"]),
      runtime_directory: z
        .string()
        .max(240)
        .regex(/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)+$/),
      host_reference: reference,
      data_region: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/),
      tls: z.enum(["acme", "operator-terminated"]),
    }),
    preferences: z.strictObject({
      locale: z.enum(["de", "en"]),
      time_zone: timeZone,
    }),
    smtp_mode: z.enum(["capture", "provider"]),
    backup_retention_days: z.int().positive(),
    support: z.strictObject({
      agreement_reference: reference,
      contact_email: email,
    }),
    licence: z.strictObject({
      release_commit: releaseCommit,
      limits: licenceLimits,
    }),
  })
  .superRefine((draft, state) => {
    const host = new URL(draft.target.portal_origin).hostname;
    if (
      vendorHostname.test(host) ||
      (draft.purpose === "customer" &&
        (localHostname.test(host) || fixtureHostname.test(host)))
    ) {
      state.addIssue({
        code: "custom",
        path: ["target", "portal_origin"],
        message: "Invalid academy domain",
      });
    }
    const directory = draft.target.runtime_directory;
    if (
      academyReservedRoots.some((root) => academyPathsOverlap(directory, root))
    ) {
      state.addIssue({
        code: "custom",
        path: ["target", "runtime_directory"],
        message: "Reserved installation path",
      });
    }
  });

export type AcademyCustomerDraft = z.output<typeof academyCustomerDraftSchema>;
