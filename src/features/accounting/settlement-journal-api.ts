/** Read and export a server-validated settlement journal for one exact period. */
import { saveBlob } from "../../lib/blob-download";
import { csvCell, csvText } from "../../lib/csv";
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

type JournalItem = SettlementJournal["items"][number];

export type SettlementJournalFilter = {
  kind: JournalItem["kind"] | "";
  currency: JournalItem["currency"] | "";
  posting: "" | "recorded" | "reversed";
};

export function filterSettlementJournal(
  report: SettlementJournal,
  filter: SettlementJournalFilter,
): SettlementJournal {
  const { kind, currency, posting } = filter;
  if (!kind && !currency && !posting) return report;
  const inScope = (entry: Pick<JournalItem, "kind" | "currency">) =>
    (!kind || kind === entry.kind) &&
    (!currency || currency === entry.currency);
  return {
    ...report,
    items: report.items.filter(
      (entry) =>
        inScope(entry) &&
        (!posting || (posting === "reversed") === (entry.reverses_id !== null)),
    ),
    totals: report.totals
      .filter(
        (total) => inScope(total) && (!posting || total[posting] !== "0.00"),
      )
      .map((total) => {
        if (posting === "recorded")
          return { ...total, reversed: "0.00", net: total.recorded };
        if (posting === "reversed")
          return { ...total, recorded: "0.00", net: `-${total.reversed}` };
        return total;
      }),
  };
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

/** Keep the machine-readable amounts as decimals, including a negative net. */
export function settlementJournalTotalsCsv(report: SettlementJournal) {
  const header = [
    "schema_version",
    "period_from",
    "period_to",
    "generated_at",
    "kind",
    "currency",
    "recorded",
    "reversed",
    "net",
  ];
  const rows = report.totals.map((total) => {
    const columns = [
      report.schema_version,
      report.from,
      report.to,
      report.generated_at,
      total.kind,
      total.currency,
      total.recorded,
      total.reversed,
    ].map(csvCell);
    const net = /^-?\d{1,14}\.\d{2}$/.test(total.net)
      ? `"${total.net}"`
      : csvCell(total.net);
    return [...columns, net].join(",");
  });
  return [csvText([header]), ...rows].join("\r\n");
}

export type SettlementJournalFile = "json" | "csv" | "totals_csv";

export function downloadSettlementJournal(
  report: SettlementJournal,
  format: SettlementJournalFile,
  filter: SettlementJournalFilter,
) {
  requireOnline();
  const json = format === "json";
  const totals = format === "totals_csv";
  const blob = new Blob(
    [
      json
        ? JSON.stringify(report, null, 2)
        : totals
          ? settlementJournalTotalsCsv(report)
          : settlementJournalCsv(report),
    ],
    { type: json ? "application/json" : "text/csv;charset=utf-8" },
  );
  const suffix = [
    filter.currency,
    filter.kind,
    filter.posting,
    totals && "totals",
  ]
    .filter(Boolean)
    .map((part) => `-${part}`)
    .join("");
  saveBlob(
    blob,
    `luminovia-settlement-journal-${report.from}-${report.to}${suffix}.${json ? "json" : "csv"}`,
  );
}
