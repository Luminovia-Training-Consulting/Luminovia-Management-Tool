import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import type { AttendanceRow } from "./attendance-api";
import {
  AttendanceCsvError,
  attendanceCsvTemplate,
  readAttendanceCsv,
} from "./attendance-import";

export function AttendanceImportPanel({
  run,
  session,
  rows,
  onSaved,
}: {
  run: string;
  session: string;
  rows: AttendanceRow[];
  onSaved: () => Promise<unknown>;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const online = useOnline();
  const [preview, setPreview] =
    useState<Awaited<ReturnType<typeof readAttendanceCsv>>>();
  const [invalidRow, setInvalidRow] = useState<number>();
  const [reading, setReading] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!preview?.length) throw new Error("attendance_import_empty");
      const { data, error } = await db().rpc(
        "import_course_session_attendance",
        {
          p_run_id: run,
          p_session_id: session,
          p_rows: preview,
        },
      );
      if (error || data?.saved !== preview.length)
        throw new Error("attendance_import_unconfirmed");
      return Number(data.saved);
    },
    onSuccess: async () => {
      setPreview(undefined);
      await onSaved();
    },
  });

  async function prepare(file: File | undefined) {
    setPreview(undefined);
    setInvalidRow(undefined);
    save.reset();
    if (!file) return;
    setReading(true);
    try {
      setPreview(await readAttendanceCsv(file, rows));
    } catch (error) {
      setInvalidRow(error instanceof AttendanceCsvError ? error.row : 1);
    } finally {
      setReading(false);
    }
  }

  return (
    <details>
      <summary>{t("attendanceImport")}</summary>
      <p>{t("attendanceImportHelp")}</p>
      <a
        download="attendance.csv"
        href={
          "data:text/csv;charset=utf-8," +
          encodeURIComponent(attendanceCsvTemplate(rows))
        }
      >
        {t("attendanceImportTemplate")}
      </a>
      <Field id={id} label={t("attendanceImportFile")}>
        <input
          id={id}
          type="file"
          accept=".csv,text/csv"
          disabled={!online || reading || save.isPending}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            void prepare(file);
          }}
        />
      </Field>
      {invalidRow && (
        <Notice kind="error">
          {t("attendanceImportInvalid", { row: invalidRow })}
        </Notice>
      )}
      {preview && (
        <>
          <ul>
            {preview.map((entry) => (
              <li key={entry.user_id}>
                {rows.find((row) => row.user_id === entry.user_id)?.name} ·{" "}
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
            onClick={() => save.mutate()}
          >
            {t("attendanceImportConfirm", { count: preview.length })}
          </Button>
        </>
      )}
      {save.isSuccess && (
        <Notice>{t("attendanceImportSaved", { count: save.data })}</Notice>
      )}
      {save.isError && (
        <Notice kind="error">{t("attendanceImportFailed")}</Notice>
      )}
    </details>
  );
}
