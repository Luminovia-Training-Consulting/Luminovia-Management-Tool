/** Review a local exam spreadsheet and save the exact changes as unpublished drafts. */
import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { saveBlob } from "../../lib/blob-download";
import { csvText } from "../../lib/csv";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { AttendanceImportError } from "./attendance-import";
import {
  examGradeImportHeaders,
  examGradeTemplateRows,
  readExamGradeImport,
  type ExamGradeCandidate,
} from "./exam-grade-import";
import { timedExamKey } from "./timed-exam-api";
import {
  examGradeImportCount,
  examGradeImportRequest,
  maxExamGradeImportRows,
} from "./timed-exam-schema";
import "./exam-grade-import-i18n";

type Preview = {
  version: number;
  rows: Awaited<ReturnType<typeof readExamGradeImport>>;
};

export function ExamGradeImportPanel({
  actor,
  run,
  version,
  roster,
  disabled,
}: {
  actor: string;
  run: string;
  version: number;
  roster: ExamGradeCandidate[];
  disabled: boolean;
}) {
  const { t } = useTranslation("examGradeImport");
  const id = useId();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [preview, setPreview] = useState<Preview>();
  const [replace, setReplace] = useState(false);
  const [invalidRow, setInvalidRow] = useState<number>();
  const [reading, setReading] = useState(false);
  const refresh = () =>
    cache.invalidateQueries({ queryKey: timedExamKey(actor, run) });
  const save = useMutation({
    mutationFn: async (reviewed: Preview) => {
      requireOnline();
      const request = examGradeImportRequest.parse({
        p_run_id: run,
        p_version: reviewed.version,
        p_rows: reviewed.rows.map(
          ({ participant_id, expected_score, score }) => ({
            participant_id,
            expected_score,
            score,
          }),
        ),
      });
      const { data, error } = await db().rpc(
        "import_course_exam_grades",
        request,
      );
      if (error) throw error;
      const count = examGradeImportCount.parse(data);
      if (count !== request.p_rows.length)
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
  const pages = Math.ceil(roster.length / maxExamGradeImportRows);
  const selectedPage = Math.min(page, Math.max(0, pages - 1));
  const template = useMutation({
    mutationFn: async (format: "csv" | "xlsx") => {
      const start = selectedPage * maxExamGradeImportRows;
      const rows = examGradeTemplateRows(
        run,
        version,
        roster.slice(start, start + maxExamGradeImportRows),
      );
      const data =
        format === "csv"
          ? new Blob([csvText([examGradeImportHeaders, ...rows])], {
              type: "text/csv;charset=utf-8",
            })
          : await (
              await import("./attendance-xlsx")
            ).spreadsheetXlsxTemplate(examGradeImportHeaders, rows);
      saveBlob(
        data,
        `exam-grades-${run}-v${version}-${selectedPage + 1}.${format}`,
      );
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
        rows: await readExamGradeImport(file, run, version, roster),
      });
    } catch (error) {
      setInvalidRow(error instanceof AttendanceImportError ? error.row : 1);
    } finally {
      setReading(false);
    }
  }

  const replaced =
    preview?.rows.filter(({ expected_score }) => expected_score !== null)
      .length ?? 0;
  const currentRoster = new Map(
    roster.map((row) => [row.participant_id, row.score]),
  );
  const stale =
    preview &&
    (preview.version !== version ||
      preview.rows.some(
        ({ participant_id, expected_score }) =>
          currentRoster.get(participant_id) !== expected_score,
      ));
  const conflict =
    typeof save.error === "object" &&
    save.error !== null &&
    "code" in save.error &&
    save.error.code === "PT409";
  const busy = reading || save.isPending || template.isPending;
  const scoreLabel = (score: number | null) =>
    score === null ? t("noScore") : t("score", { score });
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {t("title")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) void prepare();
        }}
        title={t("title")}
        description={t("hint")}
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
              disabled={busy || disabled}
              onClick={() => template.mutate("csv")}
            >
              {t("csv")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || disabled}
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
              disabled={busy || disabled}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                void prepare(file);
              }}
            />
          </Field>
          {reading && <p role="status">{t("reading")}</p>}
          {invalidRow && (
            <Notice kind="error">{t("invalid", { row: invalidRow })}</Notice>
          )}
          {preview?.rows.length === 0 && <p role="status">{t("empty")}</p>}
          {Boolean(preview?.rows.length) && (
            <>
              <ul className="learning-resources" aria-label={t("preview")}>
                {preview?.rows.map((row) => (
                  <li key={row.participant_id}>
                    <strong>{row.name}</strong>
                    <span>
                      {t("change", {
                        before: scoreLabel(row.expected_score),
                        after: scoreLabel(row.score),
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
          {(stale || conflict) && <Notice kind="error">{t("stale")}</Notice>}
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
