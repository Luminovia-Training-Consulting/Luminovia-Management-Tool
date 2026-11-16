/**
 * Vertrags-/Finanzqueries und lokale Exportaufbereitung für autorisierte Datensätze. Sichtbereichsparameter beantragen eine Projektion, erteilen aber keine Rechte; Beträge werden je Originalwährung getrennt und CSV-Zellen gegen Formelauswertung geschützt.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import type {
  CommercialAccess,
  CommercialPerson,
  ContractRecord,
  EarningRecord,
  InvoicePayment,
  InvoiceRecord,
} from "./types";
/** Gemeinsame akteursbezogene Präfixe für kommerzielle Queries und deren gezielte Invalidierung. */
export const commercialKeys = {
  access: (actor: string) => ["commercial-access", actor] as const,
  contracts: (actor: string) => ["contracts", actor] as const,
  finance: (actor: string) => ["finance", actor] as const,
};
/** Lädt die Serverprojektion über commercial_access und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const commercialAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: commercialKeys.access(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("commercial_access");
      if (error) throw error;
      return data as CommercialAccess;
    },
    staleTime: 1000,
  });
/** Lädt die Serverprojektion über commercial_people und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const commercialPeopleQuery = (actor: string) =>
  queryOptions({
    queryKey: ["commercial-people", actor],
    queryFn: async () => {
      const { data, error } = await db().rpc("commercial_people");
      if (error) throw error;
      return (data ?? []) as CommercialPerson[];
    },
  });
/** Lädt die Serverprojektion über contract_records und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const contractsQuery = (actor: string, all: boolean) =>
  queryOptions({
    queryKey: [...commercialKeys.contracts(actor), all],
    queryFn: async () => {
      const { data, error } = await db().rpc("contract_records", {
        p_all: all,
      });
      if (error) throw error;
      return (data ?? []) as ContractRecord[];
    },
  });
/** Lädt die Serverprojektion über finance_earnings und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const earningsQuery = (actor: string, all: boolean) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "earnings", all],
    queryFn: async () => {
      const { data, error } = await db().rpc("finance_earnings", {
        p_all: all,
      });
      if (error) throw error;
      return (data ?? []) as EarningRecord[];
    },
  });
/** Lädt die Serverprojektion über invoice_records und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const invoicesQuery = (actor: string, all: boolean) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "invoices", all],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_records", { p_all: all });
      if (error) throw error;
      return (data ?? []) as InvoiceRecord[];
    },
  });
/** Lädt die Serverprojektion über invoice_payments und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const paymentsQuery = (actor: string, invoice: string) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "payments", invoice],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_payments", {
        p_invoice_id: invoice,
      });
      if (error) throw error;
      return (data ?? []) as InvoicePayment[];
    },
  });
/** Protect exported user-authored text from spreadsheet formula interpretation. */
/** Maskiert Zelltext, Zeilenumbrüche und Formelpräfixe, damit verfasste Texte beim Tabellenimport nicht als Formeln starten. */
export function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/[\r\n\t]/g, " ");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
/** Erzeugt UTF-8-CSV mit BOM, CRLF und derselben sicheren Zellmaskierung für jede Zeile. */
export function csvText(rows: unknown[][]) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
/** Startet den Download der autorisierten Exportzeilen und gibt die temporäre Blob-URL danach frei. */
export function downloadCsv(filename: string, rows: unknown[][]) {
  const url = URL.createObjectURL(
    new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
/** Summiert Statusbeträge centbasiert je Originalwährung, ohne EUR und AUD zusammenzurechnen. */
export function groupedEarnings(rows: EarningRecord[]) {
  const groups = new Map<
    string,
    {
      currency: "EUR" | "AUD";
      expected: number;
      completed: number;
      invoiced: number;
      paid: number;
    }
  >();
  for (const row of rows) {
    const group = groups.get(row.currency) ?? {
      currency: row.currency,
      expected: 0,
      completed: 0,
      invoiced: 0,
      paid: 0,
    };
    group[row.stage] += Math.round(Number(row.total_amount) * 100);
    groups.set(row.currency, group);
  }
  return [...groups.values()].map((group) => ({
    currency: group.currency,
    expected: group.expected / 100,
    completed: group.completed / 100,
    invoiced: group.invoiced / 100,
    paid: group.paid / 100,
  }));
}

/** Normalisiert eindeutige kommagetrennte Labels und weist übergroße oder steuerzeichenhaltige Eingaben ab. */
export function parseInvoiceLabels(value: string) {
  const labels = [
    ...new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
  if (
    labels.length > 10 ||
    labels.some(
      (label) =>
        label.length > 50 ||
        Array.from(label).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    )
  )
    throw new Error("labels_invalid");
  return labels;
}
