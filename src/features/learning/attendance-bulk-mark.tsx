/** Review and save a single, version-checked bulk mark for a session. */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import {
  saveAttendanceBatch,
  type AttendanceRegister,
  type AttendanceRow,
  type AttendanceStatus,
} from "./attendance-api";
import {
  attendanceStatuses,
  maxAttendanceImportRows,
} from "./attendance-schema";

export function AttendanceBulkMark({
  run,
  register,
  visibleRows,
  refreshRegister,
  statusControl,
}: {
  run: string;
  register: Pick<AttendanceRegister, "session_id" | "starts_at" | "time_zone">;
  visibleRows: AttendanceRow[];
  refreshRegister: () => Promise<unknown>;
  statusControl: HTMLSelectElement | null;
}) {
  const { t, i18n } = useTranslation("learning");
  const online = useOnline();
  const id = useId();
  const [status, setStatus] = useState<AttendanceStatus>("present");
  const [review, setReview] = useState<{
    status: AttendanceStatus;
    rows: AttendanceRow[];
  }>();

  // A self-report has a version even when the current staff status is empty.
  // Exclude it and every previously edited row from first-time bulk marking.
  const candidates = visibleRows.filter(
    (row) => row.status === null && row.version === 0,
  );
  const tooMany = candidates.length > maxAttendanceImportRows;
  const save = useMutation({
    mutationFn: (confirmed: NonNullable<typeof review>) =>
      saveAttendanceBatch(
        run,
        register.session_id,
        confirmed.rows.map((row) => ({
          user_id: row.user_id,
          status: confirmed.status,
          arrival_at: null,
          departure_at: null,
          note: "",
          reason: "",
          expected_version: row.version,
        })),
      ),
    onSettled: async () => {
      await refreshRegister();
      setReview(undefined);
    },
  });

  return (
    <>
      {tooMany && (
        <Notice>
          {t("attendanceBulkLimit", { count: maxAttendanceImportRows })}
        </Notice>
      )}
      {candidates.length > 0 && !tooMany && (
        <div className="form-actions">
          <Field id={id} label={t("attendanceBulkStatus")}>
            <select
              id={id}
              value={status}
              disabled={!online || save.isPending}
              onChange={(event) =>
                setStatus(event.currentTarget.value as AttendanceStatus)
              }
            >
              {attendanceStatuses.map((value) => (
                <option value={value} key={value}>
                  {t(`attendance${value}`)}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            variant="secondary"
            disabled={!online || save.isPending}
            onClick={() => {
              save.reset();
              setReview({ status, rows: candidates });
            }}
          >
            {t("attendanceBulkReview")}
          </Button>
        </div>
      )}
      {review && (
        <Dialog
          open
          title={t("attendanceBulkReview")}
          description={t("attendanceBulkPreview", {
            date: dateTime(
              register.starts_at,
              i18n.language,
              register.time_zone,
            ),
            status: t(`attendance${review.status}`),
          })}
          returnFocusTo={statusControl}
          onOpenChange={(open) => {
            if (!open && !save.isPending) setReview(undefined);
          }}
        >
          <ul>
            {review.rows.map((row) => (
              <li key={row.user_id}>
                {row.name.trim() || t("attendanceUnnamedParticipant")}
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => setReview(undefined)}
            >
              {t("enrolmentCancel")}
            </Button>
            <Button
              type="button"
              disabled={!online || save.isPending}
              onClick={() => save.mutate(review)}
            >
              {t("attendanceImportConfirm", { count: review.rows.length })}
            </Button>
          </div>
        </Dialog>
      )}
      {save.isSuccess && (
        <Notice>{t("attendanceImportSaved", { count: save.data })}</Notice>
      )}
      {save.isError && (
        <Notice kind="error">
          {t(
            "code" in save.error && save.error.code === "PT409"
              ? "attendanceBulkChanged"
              : "attendanceBulkFailed",
          )}
        </Notice>
      )}
    </>
  );
}
