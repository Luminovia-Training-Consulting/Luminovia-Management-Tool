/** Read and export a server-validated settlement journal for one exact period. */
import { saveBlob } from "../../lib/blob-download";
import { csvText } from "../../lib/csv";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  settlementJournalPeriodSchema,
  settlementJournalSchema,
  type SettlementJournal,
  type SettlementJournalPeriod,
} from "./settlement-journal-schema";

export async function readSettlementJournal(period: SettlementJournalPeriod) {
  requireOnline();
  const request = settlementJournalPeriodSchema.parse(period);
  const { data, error } = await db().rpc(
    "accounting_settlement_journal",
    request,
  );
  if (error) throw error;
  const report = settlementJournalSchema.parse(data);
  if (request.p_from !== report.from || request.p_to !== report.to)
    throw new Error("settlement_journal_period_mismatch");
  return report;
}

export function settlementJournalCsv(report: SettlementJournal) {
  return csvText([
    [
      "schema_version",
      "period_from",
      "period_to",
      "generated_at",
      "kind",
      "entry_id",
      "reverses_id",
      "subject_id",
      "effective_on",
      "recorded_at",
      "currency",
      "amount",
      "reference",
    ],
    ...report.items.map((item) => [
      report.schema_version,
      report.from,
      report.to,
      report.generated_at,
      item.kind,
      item.id,
      item.reverses_id,
      item.subject_id,
      item.effective_on,
      item.recorded_at,
      item.currency,
      item.amount,
      item.reference,
    ]),
  ]);
}

export function downloadSettlementJournal(
  report: SettlementJournal,
  format: "json" | "csv",
) {
  const blob = new Blob(
    [
      format === "json"
        ? JSON.stringify(report, null, 2)
        : settlementJournalCsv(report),
    ],
    { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" },
  );
  saveBlob(
    blob,
    `luminovia-settlement-journal-${report.from}-${report.to}.${format}`,
  );
}
