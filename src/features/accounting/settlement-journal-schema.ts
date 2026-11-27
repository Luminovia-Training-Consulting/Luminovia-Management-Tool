import { z } from "zod";
import { accountingCurrency, accountingDecimal } from "./schema.ts";

export const settlementJournalKind = z.enum([
  "customer_credit",
  "customer_refund",
  "lecturer_repayment",
  "expense_reimbursement",
]);
const scope = z.enum(["customer", "lecturer"]);
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const totalAmount = z.string().regex(/^(0|[1-9]\d{0,13})\.\d{2}$/);
const totalNet = z.string().regex(/^-?(0|[1-9]\d{0,13})\.\d{2}$/);
const entry = z.strictObject({
  kind: settlementJournalKind,
  id: z.uuid(),
  reverses_id: z.uuid().nullable(),
  subject_id: z.uuid(),
  effective_on: date,
  recorded_at: instant,
  currency: accountingCurrency,
  amount: accountingDecimal.refine((value) => value !== "0.00"),
  reference: z.string().min(1).max(200),
});
const totalRow = z.strictObject({
  kind: settlementJournalKind,
  currency: accountingCurrency,
  recorded: totalAmount,
  reversed: totalAmount,
  net: totalNet,
});
export const settlementJournalPeriodSchema = z
  .strictObject({ p_from: date, p_to: date })
  .refine(
    ({ p_from, p_to }) =>
      p_from >= "0001-01-01" &&
      p_from <= p_to &&
      Date.parse(p_to) - Date.parse(p_from) <= 365 * 86_400_000,
    "Select an inclusive period of up to 366 days",
  );

function cents(amount: string) {
  return totalNet.safeParse(amount).success
    ? BigInt(amount.replace(".", ""))
    : null;
}

export const settlementJournalSchema = z
  .strictObject({
    schema_version: z.literal("luminovia.settlement-journal/1"),
    from: date,
    to: date,
    generated_at: instant,
    scopes: z.array(scope).min(1).max(2),
    items: z.array(entry).max(5000),
    totals: z
      .array(totalRow)
      .max(
        settlementJournalKind.options.length *
          accountingCurrency.options.length,
      ),
  })
  .superRefine((report, context) => {
    const scopes = new Set(report.scopes);
    const identities = new Set<string>();
    const amounts = new Map<string, { recorded: bigint; reversed: bigint }>();
    const inconsistent = () =>
      context.addIssue({
        code: "custom",
        message: "Inconsistent settlement journal",
      });
    if (
      scopes.size !== report.scopes.length ||
      !settlementJournalPeriodSchema.safeParse({
        p_from: report.from,
        p_to: report.to,
      }).success
    )
      return inconsistent();
    for (const item of report.items) {
      const reversal = item.reverses_id !== null;
      const amount = cents(item.amount);
      const identity = `${item.kind}:${item.id}:${reversal}`;
      const repayment = item.kind === "lecturer_repayment";
      const reimbursement = item.kind === "expense_reimbursement";
      const key = `${item.currency}:${item.kind}`;
      if (
        amount === null ||
        item.effective_on < report.from ||
        item.effective_on > report.to ||
        !scopes.has(repayment || reimbursement ? "lecturer" : "customer") ||
        identities.has(identity) ||
        (reversal &&
          (reimbursement || (item.reverses_id === item.id) !== repayment))
      )
        return inconsistent();
      identities.add(identity);
      const value = amounts.get(key) ?? { recorded: 0n, reversed: 0n };
      value[reversal ? "reversed" : "recorded"] += amount;
      amounts.set(key, value);
    }
    for (const total of report.totals) {
      const key = `${total.currency}:${total.kind}`;
      const value = amounts.get(key);
      if (
        !value ||
        value.recorded !== cents(total.recorded) ||
        value.reversed !== cents(total.reversed) ||
        value.recorded - value.reversed !== cents(total.net)
      )
        return inconsistent();
      amounts.delete(key);
    }
    if (amounts.size) inconsistent();
  });

export type SettlementJournal = z.infer<typeof settlementJournalSchema>;
export type SettlementJournalPeriod = z.infer<
  typeof settlementJournalPeriodSchema
>;
