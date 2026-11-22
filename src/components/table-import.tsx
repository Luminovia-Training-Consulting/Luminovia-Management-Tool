import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { saveBlob } from "../lib/blob-download";
import { downloadCsv } from "../lib/csv";
import { useOnline } from "../lib/online";
import {
  AttendanceImportError,
  readSpreadsheetCsv,
} from "../features/learning/attendance-import";
import { Field, Notice } from "./common";
import { Button } from "./ui/button";

export function TableImport<T>({
  label,
  filename,
  columns,
  example,
  parse,
  save,
  saveBatch,
  refresh,
}: {
  label: string;
  filename: string;
  columns: readonly string[];
  example: readonly string[];
  parse: (values: Record<string, string>) => T;
  refresh: () => Promise<unknown>;
} & (
  | { save: (row: T) => Promise<unknown>; saveBatch?: never }
  | {
      save?: never;
      saveBatch: (rows: T[]) => Promise<{ created: number; skipped: number }>;
    }
)) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const online = useOnline();
  const id = useId();
  const [rows, setRows] = useState<
    { number: number; cells: string[]; value: T }[]
  >([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function prepare(file: File) {
    setBusy(true);
    setRows([]);
    setStatus("");
    setError(false);
    let row = 1;
    try {
      const records = file.name.toLowerCase().endsWith(".xlsx")
        ? await (
            await import("../features/learning/attendance-xlsx")
          ).readSpreadsheetXlsx(file, columns)
        : await readSpreadsheetCsv(file, columns);
      if (!records.length) throw new AttendanceImportError(2);
      setRows(
        records.map(({ rowNumber, columns: cells }) => {
          row = rowNumber;
          return {
            number: rowNumber,
            cells,
            value: parse(
              Object.fromEntries(
                columns.map((name, index) => [name, cells[index]]),
              ),
            ),
          };
        }),
      );
    } catch (cause) {
      if (cause instanceof AttendanceImportError) row = cause.row;
      setError(true);
      setStatus(
        de
          ? `Bitte Format und Zeile ${row} prüfen.`
          : `Check the file format and row ${row}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function downloadWorkbook() {
    setBusy(true);
    setError(false);
    setStatus("");
    try {
      const { spreadsheetXlsxTemplate } =
        await import("../features/learning/attendance-xlsx");
      saveBlob(
        await spreadsheetXlsxTemplate(columns, [example]),
        `${filename}.xlsx`,
      );
    } catch {
      setError(true);
      setStatus(
        de
          ? "XLSX-Vorlage konnte nicht erstellt werden."
          : "Could not create the XLSX template.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setRows([]);
    setStatus("");
    setError(false);
    let completed = 0;
    try {
      if (saveBatch) {
        const outcome = await saveBatch(rows.map(({ value }) => value));
        setStatus(
          de
            ? `${outcome.created} angelegt, ${outcome.skipped} vorhandene übersprungen.`
            : `Created ${outcome.created}, skipped ${outcome.skipped} existing records.`,
        );
        return;
      }
      for (const row of rows) {
        await save(row.value);
        completed++;
      }
      setStatus(
        de
          ? `${completed} Einträge angelegt.`
          : `Created ${completed} records.`,
      );
    } catch {
      setError(true);
      if (saveBatch) {
        setStatus(
          de
            ? "Der Import wurde nicht bestätigt."
            : "The import was not confirmed.",
        );
      } else {
        const failed = rows[completed].number;
        setStatus(
          de
            ? `${completed} bestätigt. Bei Zeile ${failed} gestoppt. Prüfe vorhandene Einträge vor einem neuen Import.`
            : `${completed} confirmed. Stopped at row ${failed}. Check existing records before importing again.`,
        );
      }
    } finally {
      await refresh().catch(() => undefined);
      setBusy(false);
    }
  }

  return (
    <details className="panel">
      <summary>{label}</summary>
      <p>
        {de
          ? "Ersetze die Beispielzeile durch deine Daten und prüfe die Vorschau. Der Import legt neue Einträge an und stoppt bei einem Speicherfehler."
          : "Replace the example row with your data and review the preview. Import creates new records and stops if a save fails."}
      </p>
      <div className="button-row">
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={() =>
            downloadCsv(`${filename}.csv`, [[...columns], [...example]])
          }
        >
          {de ? "CSV-Vorlage laden" : "Download CSV template"}
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={() => void downloadWorkbook()}
        >
          {de ? "XLSX-Vorlage laden" : "Download XLSX template"}
        </Button>
      </div>
      <Field id={id} label={de ? "CSV- oder XLSX-Datei" : "CSV or XLSX file"}>
        <input
          id={id}
          type="file"
          accept=".csv,.xlsx"
          disabled={busy}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void prepare(file);
          }}
        />
      </Field>
      {rows.length > 0 && (
        <>
          <details open>
            <summary>{de ? "Vorschau" : "Preview"}</summary>
            <ul>
              {rows.map(({ number, cells }) => (
                <li key={number}>
                  {number}: {cells.filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </details>
          <Button
            type="button"
            disabled={!online || busy}
            onClick={() => void confirm()}
          >
            {de
              ? `${rows.length} Einträge anlegen`
              : `Create ${rows.length} records`}
          </Button>
        </>
      )}
      {status && <Notice kind={error ? "error" : undefined}>{status}</Notice>}
    </details>
  );
}
