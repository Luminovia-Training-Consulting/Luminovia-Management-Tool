/** Database projections and filters shared by job browsing and OpenAPI. */
import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

const bound = z.number().min(0).max(1_000_000_000).nullable().default(null);
export const jobFilterFieldsSchema = z
  .object({
    q: z.string().max(160).default(""),
    customer: z.string().max(120).default(""),
    topic_ids: z.array(z.uuid()).max(20).default([]),
    delivery: z.enum(["", "online", "onsite"]).default(""),
    status: z
      .enum(["", "draft", "published", "filled", "archived"])
      .default(""),
    from: z.string().default(""),
    to: z.string().default(""),
    zone: z.string().refine(validZone).default("Europe/Berlin"),
    currency: z.enum(["", "EUR", "AUD"]).default(""),
    unit: z
      .enum(["", "per_day", "per_hour", "per_teaching_unit", "fixed_total"])
      .default(""),
    min_total: bound,
    max_total: bound,
    min_rate: bound,
    max_rate: bound,
    min_hours: bound,
    max_hours: bound,
    available_only: z.boolean().default(false),
    include_history: z.boolean().default(false),
    sort: z
      .enum([
        "newest",
        "oldest",
        "soonest",
        "total_asc",
        "total_desc",
        "rate_asc",
        "rate_desc",
        "duration_asc",
        "title",
        "customer_asc",
        "topic_de_asc",
        "topic_en_asc",
      ])
      .default("soonest"),
  })
  .strict();
export const jobFiltersSchema = jobFilterFieldsSchema.superRefine((f, ctx) => {
  const bad = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });
  if (
    !f.currency &&
    (f.min_total !== null ||
      f.max_total !== null ||
      f.min_rate !== null ||
      f.max_rate !== null ||
      /^(total|rate)_/.test(f.sort))
  )
    bad("currency", "currencyRequired");
  if (
    !f.unit &&
    (f.min_rate !== null || f.max_rate !== null || f.sort.startsWith("rate_"))
  )
    bad("unit", "unitRequired");
  for (const [min, max] of [
    ["min_total", "max_total"],
    ["min_rate", "max_rate"],
    ["min_hours", "max_hours"],
  ] as const)
    if (f[min] !== null && f[max] !== null && f[min]! > f[max]!)
      bad(min, "rangeInvalid");
  for (const name of ["from", "to"] as const) {
    const d = f[name];
    if (
      d &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !Number.isFinite(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d)
    )
      bad(name, "rangeInvalid");
  }
  if (f.from && f.to && f.from > f.to) bad("from", "rangeInvalid");
  if (new Set(f.topic_ids).size !== f.topic_ids.length)
    bad("topic_ids", "rangeInvalid");
});
export type JobFilters = z.infer<typeof jobFiltersSchema>;
export const defaultJobFilters = jobFiltersSchema.parse({});

const instant = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)))
  .meta({ format: "date-time" });
export const jobSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  customer_name: z.string(),
  delivery_type: z.enum(["online", "onsite"]),
  location: z.string(),
  time_zone: z.string().refine(validZone),
  status: z.enum(["draft", "published", "filled", "archived"]),
  // Management may discover an offer without its private lecturer quote.
  // Accept numeric or restricted-null values explicitly; coercion invents zero fees.
  amount: z.number().finite().nonnegative().nullable(),
  total_amount: z.number().finite().nonnegative().nullable(),
  currency: z.enum(["EUR", "AUD"]),
  rate_unit: z.enum([
    "per_day",
    "per_hour",
    "per_teaching_unit",
    "fixed_total",
  ]),
  terms: z.string(),
  terms_version: z.number().int().positive(),
  requires_contract: z.boolean(),
  claim_deadline: instant.nullable(),
  capacity: z.number().int().min(1).max(20),
  capacity_basis: z.enum(["single_position", "per_position"]),
  created_at: instant,
  urgent_reopened_at: instant.nullable().optional(),
  dispatch_only: z.boolean().optional(),
  job_sessions: z.array(
    z.object({
      id: z.uuid(),
      job_id: z.uuid(),
      starts_at: instant,
      ends_at: instant,
    }),
  ),
  job_requirements: z.array(z.object({ topic_id: z.uuid() })),
  confirmed_count: z.number().int().nonnegative(),
  open_positions: z.number().int().nonnegative(),
});
export const cursorSchema = z
  .object({
    id: z.uuid(),
    number: z.string().regex(/^-?\d+(?:\.\d+)?$/),
    text: z.string().max(400),
    fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
    urgent: z.boolean().optional(),
  })
  .strict();
export type JobCursor = z.infer<typeof cursorSchema>;
export const discoveryPageSchema = z
  .object({
    items: z.array(jobSchema).max(100),
    has_more: z.boolean(),
    next_cursor: cursorSchema.nullable(),
    as_of: instant,
    filters: jobFiltersSchema,
  })
  .superRefine((page, ctx) => {
    if (
      page.has_more !== Boolean(page.next_cursor) ||
      (page.has_more && !page.items.length)
    )
      ctx.addIssue({
        code: "custom",
        path: ["next_cursor"],
        message: "Inconsistent discovery pagination",
      });
  });
export const savedViewSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(80),
  version: z.number().int().positive(),
  filters: jobFiltersSchema,
  created_at: instant,
  updated_at: instant,
});
export type SavedJobView = z.infer<typeof savedViewSchema>;
export const savedViewsSchema = z.array(savedViewSchema).max(20);

const count = z.number().int().nonnegative();
export const jobDashboardSchema = z.object({
  open_count: count,
  assignment_count: count,
  next_session_count: count,
  matching: z.boolean(),
  suggestions: z.array(jobSchema).max(2),
  next_assignments: z
    .array(
      z.object({
        id: z.uuid(),
        starts_at: instant,
        ends_at: instant,
        job: z.object({ id: z.uuid(), title: z.string() }),
      }),
    )
    .max(5),
  management: z
    .object({ drafts: count, expired: count, upcoming: count })
    .nullable(),
  as_of: instant,
});

/** Customer/topic descriptions for filtering only the actor's own confirmed calendar assignments. */
export const assignmentCalendarMetadataSchema = z
  .array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      organisation_id: z.uuid().nullable(),
      organisation_name: z.string(),
      topics: z.array(
        z.object({ id: z.uuid(), label_de: z.string(), label_en: z.string() }),
      ),
    }),
  )
  .max(1000);
export type AssignmentCalendarMetadata = z.infer<
  typeof assignmentCalendarMetadataSchema
>[number];
