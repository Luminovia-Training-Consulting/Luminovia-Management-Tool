/** Exact response shapes for the authorized totals on the internal dashboard. */
import { z } from "zod";
import { currencyCodes } from "../../lib/currencies.ts";

const total = { currency: z.enum(currencyCodes), amount: z.number() };

export const dashboardFinancialSummarySchema = z.array(
  z.discriminatedUnion("kind", [
    z.strictObject({
      ...total,
      kind: z.literal("platform"),
      accepted_gross: z.number(),
      organisation_id: z.null(),
      organisation_name: z.null(),
    }),
    z.strictObject({
      ...total,
      kind: z.literal("client"),
      accepted_gross: z.null(),
      organisation_id: z.uuid(),
      organisation_name: z.string(),
    }),
    z.strictObject({
      ...total,
      kind: z.literal("lecturer"),
      accepted_gross: z.null(),
      organisation_id: z.null(),
      organisation_name: z.null(),
    }),
  ]),
);
