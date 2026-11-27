/** Validate the permission-filtered indicators and issue receipts from the Control Center. */
import { z } from "zod";
import { currencyCodes } from "../../lib/currencies.ts";
import { validZone } from "../../lib/dates.ts";

const money = z.number().finite();
const count = z.number().int().nonnegative();
export const trainingIssueCode = z.enum([
  "staffing",
  "delivery",
  "agreement",
  "qualification",
  "preparation",
]);
export const trainingEscalationAssignees = z.array(
  z.object({ id: z.uuid(), name: z.string() }),
);
export const trainingEscalationSchema = z.object({
  id: z.uuid(),
  state: z.enum(["open", "doing", "done"]),
  due_at: z.iso.datetime({ offset: true }).nullable(),
  assignee: z.string(),
});
export const trainingControlSchema = z.object({
  time_zone: z.string().refine(validZone),
  filters: z.object({
    organisations: z.array(z.object({ id: z.uuid(), name: z.string() })),
    topics: z.array(
      z.object({ id: z.uuid(), label_de: z.string(), label_en: z.string() }),
    ),
  }),
  capacity: z
    .object({
      weeks: z.array(
        z.object({
          week: z.iso.date(),
          people: count,
          free_minutes: z.number().nonnegative(),
        }),
      ),
      absences: z
        .array(
          z.object({
            id: z.uuid(),
            name: z.string(),
            starts_at: z.iso.datetime({ offset: true }),
            ends_at: z.iso.datetime({ offset: true }),
          }),
        )
        .max(100),
    })
    .nullable(),
  operations: z
    .object({
      upcoming: count,
      active: count,
      assigned_minutes: z.number().nonnegative(),
      unassigned_minutes: z.number().nonnegative(),
      unstaffed: count,
      partly_staffed: count,
      attention: count,
      issues: z
        .array(
          z.object({
            run_id: z.uuid(),
            title: z.string(),
            starts_at: z.iso.datetime({ offset: true }),
            code: trainingIssueCode,
            fingerprint: z.string().regex(/^[a-f0-9]{32}$/),
            acknowledged: z.boolean(),
            escalation: trainingEscalationSchema.nullish(),
          }),
        )
        .max(500),
    })
    .nullable(),
  receivables: z
    .object({
      currencies: z.array(
        z.object({
          currency: z.enum(currencyCodes),
          invoiced: money,
          received: money,
          outstanding: money,
        }),
      ),
      overdue: z
        .array(
          z.object({
            id: z.uuid(),
            number: z.string(),
            organisation: z.string(),
            due_on: z.iso.date(),
            currency: z.enum(currencyCodes),
            outstanding_total: money,
          }),
        )
        .max(100),
    })
    .nullable(),
});

export type TrainingIssue = NonNullable<
  z.infer<typeof trainingControlSchema>["operations"]
>["issues"][number];
