/** Shows and commits the same register preview for CSV and XLSX worksheet inputs. */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";
import { saveBlob } from "../../lib/blob-download";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { saveAttendanceBatch, type AttendanceRegister } from "./attendance-api";
import type { AttendanceImportRow } from "./attendance-schema";
import {
  AttendanceImportError,
  attendanceCsvTemplate,
  readAttendanceCsv,
} from "./attendance-import";

/** Bind the confirmed preview to the selected course and session in one request. */
type AttendanceImportRequest = {
  p_run_id: string;
  p_session_id: string;
  p_rows: AttendanceImportRow[];
};

/** Keep workbook bytes local and submit only confirmed, versioned register rows online. */
export function AttendanceImportPanel({
  run,
  register,
  refreshRegister,
}: {
  run: string;
  register: Pick<
    AttendanceRegister,
    "session_id" | "starts_at" | "ends_at" | "time_zone" | "rows"
  >;
  refreshRegister: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation("learning");
  const { rows, time_zone: timeZone } = register;
  const id = useId();
  const online = useOnline();
  const [preview, setPreview] = useState<AttendanceImportRequest["p_rows"]>();
  const [invalidRow, setInvalidRow] = useState<number>();
  const [reading, setReading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [templateFailed, setTemplateFailed] = useState(false);

  async function downloadWorkbook() {
    setWriting(true);
    setTemplateFailed(false);
    try {
      const { attendanceXlsxTemplate } = await import("./attendance-xlsx");
      saveBlob(await attendanceXlsxTemplate(rows), "attendance.xlsx");
    } catch {
      setTemplateFailed(true);
    } finally {
      setWriting(false);
    }
  }
  const save = useMutation({
    mutationFn: (confirmed: AttendanceImportRequest) =>
      saveAttendanceBatch(
        confirmed.p_run_id,
        confirmed.p_session_id,
        confirmed.p_rows,
      ),
    onSettled: async () => {
      setPreview(undefined);
      await refreshRegister();
    },
  });

  /** Defer the archive reader until someone selects XLSX. */
  async function prepare(file: File | undefined) {
    setPreview(undefined);
    setInvalidRow(undefined);
    save.reset();
    if (!file) return;
    setReading(true);
    try {
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const workbook = await import("./attendance-xlsx");
        setPreview(await workbook.readAttendanceXlsx(file, rows, register));
      } else {
        setPreview(await readAttendanceCsv(file, rows, register));
      }
    } catch (error) {
      setInvalidRow(error instanceof AttendanceImportError ? error.row : 1);
    } finally {
      setReading(false);
    }
  }

  return (
    <details className="attendance-import">
      <summary>{t("attendanceImport")}</summary>
      <p>{t("attendanceImportHelp")}</p>
      <div className="learning-action-row">
        <Button asChild variant="secondary">
          <a
            download="attendance.csv"
            href={
              "data:text/csv;charset=utf-8," +
              encodeURIComponent(attendanceCsvTemplate(rows))
            }
          >
            {t("attendanceImportTemplate")}
          </a>
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={writing}
          onClick={() => void downloadWorkbook()}
        >
          {t("attendanceXlsxTemplate")}
        </Button>
      </div>
      {templateFailed && (
        <Notice kind="error">{t("attendanceXlsxTemplateFailed")}</Notice>
      )}
      <Field id={id} label={t("attendanceImportFile")}>
        <input
          id={id}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={!online || reading || save.isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void prepare(file);
          }}
        />
      </Field>
      <details>
        <summary>{t("attendanceImportFormat")}</summary>
        <ul className="space-y-2">
          <li>{t("attendanceImportFormatColumns")}</li>
          <li>{t("attendanceImportFormatStatuses")}</li>
          <li>{t("attendanceImportFormatTime")}</li>
        </ul>
      </details>
      {invalidRow && (
        <Notice kind="error">
          {t("attendanceImportInvalid", { row: invalidRow })}
        </Notice>
      )}
      {preview && (
        <>
          <p>
            {t("attendanceImportSession", {
              date: dateTime(register.starts_at, i18n.language, timeZone),
              zone: timeZone,
            })}
          </p>
          <ul>
            {preview.map((entry) => (
              <li key={entry.user_id}>
                {rows
                  .find((row) => row.user_id === entry.user_id)
                  ?.name.trim() || t("attendanceUnnamedParticipant")}{" "}
                · <code>{entry.user_id}</code> ·{" "}
                {t(`attendance${entry.status}`)}
                {entry.arrival_at && <> · {entry.arrival_at}</>}
                {entry.departure_at && <> – {entry.departure_at}</>}
                {entry.note && <p className="preserve-text">{entry.note}</p>}
                {entry.reason && (
                  <p className="preserve-text">{entry.reason}</p>
                )}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            disabled={!online || save.isPending || save.isError}
            onClick={() =>
              save.mutate({
                p_run_id: run,
                p_session_id: register.session_id,
                p_rows: preview,
              })
            }
          >
            {t("attendanceImportConfirm", { count: preview.length })}
          </Button>
        </>
      )}
      {save.isSuccess && (
        <Notice>{t("attendanceImportSaved", { count: save.data })}</Notice>
      )}
      {save.isError && (
        <Notice kind="error">
          {t(
            "code" in save.error && save.error.code === "PT409"
              ? "attendanceImportChanged"
              : "attendanceImportFailed",
          )}
        </Notice>
      )}
    </details>
  );
}
