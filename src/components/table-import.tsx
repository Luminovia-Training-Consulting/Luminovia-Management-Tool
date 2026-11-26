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
import { Dialog } from "./ui/dialog";

function rejectionCode(cause: unknown) {
  return cause && typeof cause === "object" && "code" in cause
    ? cause.code
    : null;
}

function definitivelyRejected(cause: unknown) {
  const code = rejectionCode(cause);
  return typeof code === "string" && /^(22|23)\d{3}$/.test(code);
}

function saveFailureReason(cause: unknown, de: boolean) {
  const code = rejectionCode(cause);
  if (code === "42501")
    return de ? "Berechtigung fehlt." : "Permission required.";
  if (code === "PT409")
    return de
      ? "Die Importkennung wurde bereits für andere Daten verwendet."
      : "The import key was already used for different data.";
  if (definitivelyRejected(cause))
    return de
      ? "Die Daten wurden abgelehnt."
      : "The server rejected the row data.";
  return de
    ? "Der Server hat den Vorgang nicht bestätigt."
    : "The server did not confirm the operation.";
}

export function TableImport<T>({
  label,
  filename,
  inDialog = false,
  columns,
  example,
  parse,
  save,
  saveBatch,
  refresh,
}: {
  label: string;
  filename: string;
  inDialog?: boolean;
  columns: readonly string[];
  example: readonly string[];
  parse: (values: Record<string, string>) => T;
  refresh: () => Promise<unknown>;
} & (
  | { save: (row: T, key: string) => Promise<unknown>; saveBatch?: never }
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
    {
      number: number;
      cells: string[];
      parsed: { valid: true; value: T } | { valid: false };
      key: string;
    }[]
  >([]);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [failed, setFailed] = useState<{
    number: number;
    editable: boolean;
  } | null>(null);
  const [batchFailure, setBatchFailure] = useState<
    "rejected" | "unconfirmed" | null
  >(null);
  const [repairable, setRepairable] = useState<Set<number>>(new Set());
  const invalid = rows.some((row) => !row.parsed.valid);

  function parseCells(cells: string[]): (typeof rows)[number]["parsed"] {
    try {
      return {
        valid: true,
        value: parse(
          Object.fromEntries(
            columns.map((name, index) => [name, cells[index]]),
          ),
        ),
      };
    } catch {
      return { valid: false };
    }
  }

  function parsedValue(row: (typeof rows)[number]): T {
    if (!row.parsed.valid) throw new Error("The import row must be corrected");
    return row.parsed.value;
  }

  function correctCell(number: number, column: number, value: string) {
    const nextKey = crypto.randomUUID();
    setRepairable((previous) => new Set(previous).add(number));
    setRows((current) =>
      current.map((row) => {
        if (row.number !== number) return row;
        const cells = row.cells.map((cell, index) =>
          index === column ? value : cell,
        );
        return { ...row, cells, key: nextKey, parsed: parseCells(cells) };
      }),
    );
  }
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);

  async function prepare(file: File) {
    setBusy(true);
    setRows([]);
    setCompleted(0);
    setFailed(null);
    setBatchFailure(null);
    setRepairable(new Set());
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
            key: crypto.randomUUID(),
            cells,
            parsed: parseCells(cells),
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
    if (invalid || !online || busy) return;
    setBusy(true);
    setStatus("");
    setError(false);
    let confirmed = completed;
    try {
      if (saveBatch) {
        const outcome = await saveBatch(rows.map(parsedValue));
        setRows([]);
        setStatus(
          de
            ? `${outcome.created} angelegt, ${outcome.skipped} vorhandene übersprungen.`
            : `Created ${outcome.created}, skipped ${outcome.skipped} existing records.`,
        );
        return;
      }
      for (const row of rows.slice(confirmed)) {
        await save(parsedValue(row), row.key);
        setFailed(null);
        setCompleted(++confirmed);
      }
      setStatus(
        de
          ? `${confirmed} Einträge angelegt.`
          : `Created ${confirmed} records.`,
      );
    } catch (cause) {
      setError(true);
      if (saveBatch) {
        setBatchFailure(
          definitivelyRejected(cause) ? "rejected" : "unconfirmed",
        );
        setStatus(
          de
            ? "Der Import wurde nicht bestätigt."
            : "The import was not confirmed.",
        );
      } else {
        const row = rows[confirmed].number;
        setFailed({ number: row, editable: definitivelyRejected(cause) });
        const reason = saveFailureReason(cause, de);
        setStatus(
          de
            ? `${confirmed} bestätigt. Zeile ${row} konnte nicht bestätigt werden. ${reason} Der nächste Versuch setzt dort fort.`
            : `${confirmed} confirmed. Row ${row} could not be confirmed. ${reason} Retrying resumes from that row.`,
        );
      }
    } finally {
      try {
        await refresh();
      } catch {
        setStatus((current) => {
          const note = de
            ? "Die Ansicht konnte nicht aktualisiert werden."
            : "The view could not be refreshed.";
          return current ? `${current} ${note}` : note;
        });
      }
      setBusy(false);
    }
  }

  const content = (
    <>
      <p>
        {de
          ? "Ersetze die Beispielzeile durch deine Daten und prüfe die Vorschau. Der Import legt neue Einträge an und stoppt bei einem Speicherfehler."
          : "Replace the example row with your data and review the preview. Import creates new records and stops if a save fails."}
      </p>
      <div className="page-actions">
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
              {rows.map(({ number, cells, parsed: { valid } }, index) => (
                <li key={number}>
                  {number}: {cells.filter(Boolean).join(" · ")}
                  {!saveBatch && " · "}
                  {!saveBatch && (
                    <small className="muted">
                      {index < completed
                        ? de
                          ? "Gespeichert"
                          : "Saved"
                        : !valid ||
                            (failed?.number === number && failed.editable)
                          ? de
                            ? "Korrektur nötig"
                            : "Correction required"
                          : number === failed?.number
                            ? de
                              ? "Bestätigung fehlt"
                              : "Unconfirmed"
                            : de
                              ? "Offen"
                              : "Pending"}
                    </small>
                  )}
                  {index >= completed &&
                    batchFailure !== "unconfirmed" &&
                    (!valid ||
                      batchFailure === "rejected" ||
                      repairable.has(number) ||
                      (failed?.editable && failed.number === number)) &&
                    (failed?.number !== number || failed.editable) && (
                      <details open={!valid || repairable.has(number)}>
                        <summary>
                          {de
                            ? `Zeile ${number} korrigieren`
                            : `Correct row ${number}`}
                        </summary>
                        <div className="form-grid">
                          {columns.map((column, field) => {
                            const fieldId = `${id}-row-${number}-${field}`;
                            return (
                              <Field key={column} id={fieldId} label={column}>
                                <input
                                  id={fieldId}
                                  type="text"
                                  value={cells[field]}
                                  disabled={busy}
                                  onChange={(event) =>
                                    correctCell(
                                      number,
                                      field,
                                      event.target.value,
                                    )
                                  }
                                />
                              </Field>
                            );
                          })}
                        </div>
                      </details>
                    )}
                </li>
              ))}
            </ul>
          </details>
          {failed !== null && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                downloadCsv(`${filename}-pending.csv`, [
                  [...columns],
                  ...rows.slice(completed).map(({ cells }) => cells),
                ])
              }
            >
              {de
                ? "Offene Zeilen zur Prüfung exportieren"
                : "Export pending rows for review"}
            </Button>
          )}
          {completed < rows.length && (
            <Button
              type="button"
              disabled={!online || busy || invalid}
              onClick={() => void confirm()}
            >
              {failed !== null
                ? de
                  ? "Offene Zeilen erneut versuchen"
                  : "Retry pending rows"
                : de
                  ? `${rows.length} Einträge anlegen`
                  : `Create ${rows.length} records`}
            </Button>
          )}
        </>
      )}
      {status && <Notice kind={error ? "error" : undefined}>{status}</Notice>}
    </>
  );

  if (inDialog)
    return (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={(event) => {
            setTrigger(event.currentTarget);
            setOpen(true);
          }}
        >
          {label}
        </Button>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!busy) setOpen(next);
          }}
          title={label}
          description={
            de
              ? "CSV- oder XLSX-Datei prüfen und importieren."
              : "Review and import a CSV or XLSX file."
          }
          returnFocusTo={trigger}
          closeDisabled={busy}
        >
          {content}
        </Dialog>
      </>
    );

  return (
    <details className="panel">
      <summary>{label}</summary>
      {content}
    </details>
  );
}
