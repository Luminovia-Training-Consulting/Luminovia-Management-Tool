/** Shared review dialog for bounded spreadsheet grades and explicit draft replacement. */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { saveBlob } from "../../lib/blob-download";
import { csvText } from "../../lib/csv";
import { requireOnline } from "../../lib/online";
import { AttendanceImportError } from "./attendance-import";
import { maxExamGradeImportRows } from "./timed-exam-schema";
import "./exam-grade-import-i18n";

type DraftGradeChange = {
  id: string;
  name: string | null;
  before: string | null;
  after: string;
};

type Preview<Row> = { version: number; rows: Row[] };

type Props<Row> = {
  version: number;
  rosterSize: number;
  disabled: boolean;
  mode: "percentage" | "points" | "assignment";
  filePrefix: string;
  headers: readonly string[];
  templateRows: (start: number, end: number) => (string | number | null)[][];
  read: (file: File) => Promise<Row[]>;
  isCurrent: (row: Row) => boolean;
  commit: (rows: Row[]) => Promise<number>;
  refresh: () => Promise<unknown>;
};

export function GradeImportDialog<Row extends DraftGradeChange>({
  version,
  rosterSize,
  disabled,
  mode,
  filePrefix,
  headers,
  templateRows,
  read,
  isCurrent,
  commit,
  refresh,
}: Props<Row>) {
  const { t } = useTranslation("examGradeImport");
  const title = t(mode === "assignment" ? "assignmentTitle" : "title");
  const id = useId();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<Preview<Row>>();
  const [replace, setReplace] = useState(false);
  const [invalidRow, setInvalidRow] = useState<number>();
  const [reading, setReading] = useState(false);
  const save = useMutation({
    mutationFn: async (reviewed: Preview<Row>) => {
      requireOnline();
      const count = await commit(reviewed.rows);
      if (count !== reviewed.rows.length)
        throw new Error("Unconfirmed exam grade import");
      return count;
    },
    onSuccess: async () => {
      setPreview(undefined);
      setReplace(false);
      await refresh();
    },
    onError: refresh,
  });
  const pages = Math.ceil(rosterSize / maxExamGradeImportRows);
  const selectedPage = Math.min(page, Math.max(0, pages - 1));
  const template = useMutation({
    mutationFn: async (format: "csv" | "xlsx") => {
      const start = selectedPage * maxExamGradeImportRows;
      const rows = templateRows(start, start + maxExamGradeImportRows);
      const data =
        format === "csv"
          ? new Blob([csvText([[...headers], ...rows])], {
              type: "text/csv;charset=utf-8",
            })
          : await (
              await import("./attendance-xlsx")
            ).spreadsheetXlsxTemplate(headers, rows);
      saveBlob(data, `${filePrefix}-v${version}-${selectedPage + 1}.${format}`);
    },
  });
  /** The captured version survives background refetch while reading the file. */
  async function prepare(file?: File) {
    setPreview(undefined);
    setInvalidRow(undefined);
    setReplace(false);
    save.reset();
    if (!file) return;
    setReading(true);
    try {
      setPreview({
        version,
        rows: await read(file),
      });
    } catch (error) {
      setInvalidRow(error instanceof AttendanceImportError ? error.row : 1);
    } finally {
      setReading(false);
    }
  }

  const replaced =
    preview?.rows.filter(({ before }) => before !== null).length ?? 0;
  const stale =
    preview &&
    (preview.version !== version ||
      preview.rows.some((row) => !isCurrent(row)));
  const conflict =
    typeof save.error === "object" &&
    save.error !== null &&
    "code" in save.error &&
    save.error.code === "PT409";
  const busy = reading || save.isPending || template.isPending;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || rosterSize === 0}
        onClick={() => setOpen(true)}
      >
        {title}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) void prepare();
        }}
        title={title}
        description={t(
          {
            percentage: "hint",
            points: "pointsHint",
            assignment: "assignmentHint",
          }[mode],
        )}
      >
        <div className="space-y-3">
          {pages > 1 && (
            <Field id={id + "-page"} label={t("templatePart")}>
              <select
                id={id + "-page"}
                value={selectedPage}
                disabled={busy}
                onChange={(event) => setPage(Number(event.currentTarget.value))}
              >
                {Array.from({ length: pages }, (_, index) => (
                  <option key={index} value={index}>
                    {t("part", { page: index + 1, pages })}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || disabled || rosterSize === 0}
              onClick={() => template.mutate("csv")}
            >
              {t("csv")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || disabled || rosterSize === 0}
              onClick={() => template.mutate("xlsx")}
            >
              {t("xlsx")}
            </Button>
          </div>
          {template.isError && (
            <Notice kind="error">{t("templateFailed")}</Notice>
          )}
          <Field id={id} label={t("file")}>
            <input
              id={id}
              type="file"
              accept=".csv,.xlsx"
              disabled={busy || disabled || rosterSize === 0}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void prepare(file);
              }}
            />
          </Field>
          {reading && <p role="status">{t("reading")}</p>}
          {invalidRow && (
            <Notice kind="error">
              {t(mode === "assignment" ? "assignmentInvalid" : "invalid", {
                row: invalidRow,
              })}
            </Notice>
          )}
          {preview?.rows.length === 0 && <p role="status">{t("empty")}</p>}
          {Boolean(preview?.rows.length) && (
            <>
              <ul className="learning-resources" aria-label={t("preview")}>
                {preview?.rows.map((row) => (
                  <li key={row.id}>
                    <strong>{row.name ?? row.id}</strong>
                    <span>
                      {t("change", {
                        before: row.before ?? t("noScore"),
                        after: row.after,
                      })}
                    </span>
                  </li>
                ))}
              </ul>
              {replaced > 0 && (
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={replace}
                    disabled={busy || Boolean(stale)}
                    onChange={(event) =>
                      setReplace(event.currentTarget.checked)
                    }
                  />
                  {t("replace", { count: replaced })}
                </label>
              )}
              <Button
                type="button"
                disabled={
                  busy ||
                  disabled ||
                  Boolean(stale) ||
                  conflict ||
                  (replaced > 0 && !replace)
                }
                onClick={() => {
                  if (preview) save.mutate(preview);
                }}
              >
                {t(save.isPending ? "saving" : "confirm", {
                  count: preview?.rows.length,
                })}
              </Button>
            </>
          )}
          {(stale || conflict) && (
            <Notice kind="error">
              {t(mode === "assignment" ? "assignmentStale" : "stale")}
            </Notice>
          )}
          {save.isError && !stale && !conflict && (
            <Notice kind="error">{t("failed")}</Notice>
          )}
          {save.isSuccess && (
            <Notice kind="success">{t("saved", { count: save.data })}</Notice>
          )}
        </div>
      </Dialog>
    </>
  );
}
