/** Staff/company session register and protected PDF evidence on the existing file path. */
import { AttendanceImportPanel } from "./attendance-import-panel";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { uploadDocument } from "../files/api";
import { downloadCourseDocument, type CourseWorkspace } from "./api";
import {
  attachAttendancePdf,
  attendanceRegisterKey,
  attendanceRegisterQuery,
  saveAttendance,
  type AttendanceRow,
  type AttendanceStatus,
} from "./attendance-api";

function localTime(value: string | null, zone: string) {
  return value
    ? DateTime.fromISO(value, { zone }).toFormat("yyyy-MM-dd'T'HH:mm")
    : "";
}
function instant(value: string, zone: string) {
  if (!value) return null;
  const time = DateTime.fromISO(value, { zone });
  if (
    !time.isValid ||
    time.toFormat("yyyy-MM-dd'T'HH:mm") !== value ||
    time.getPossibleOffsets().length !== 1
  )
    throw new Error("attendanceInvalidTime");
  return time.toUTC().toISO();
}

type RowEditorProps = {
  course: CourseWorkspace;
  actor: string;
  session: string;
  row: AttendanceRow;
};

function RowEditor(props: RowEditorProps) {
  const { t } = useTranslation("learning");
  const { row } = props;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <li className="panel learning-panel attendance-entry">
      <h4 id={headingId} ref={heading} tabIndex={-1}>
        {row.name.trim() || t("attendanceUnnamedParticipant")}
      </h4>
      <p role="status">
        {t("attendanceCurrent")}:{" "}
        {row.status ? t(`attendance${row.status}`) : t("unreported")}
      </p>
      <AttendanceFields
        key={row.version}
        {...props}
        headingId={headingId}
        restoreFocus={() => heading.current?.focus()}
      />
    </li>
  );
}

function AttendanceFields({
  course,
  actor,
  session,
  row,
  headingId,
  restoreFocus,
}: RowEditorProps & {
  headingId: string;
  restoreFocus: () => void;
}) {
  const { t } = useTranslation("learning");
  const client = useQueryClient();
  const online = useOnline();
  const [arrival, setArrival] = useState(
    localTime(row.arrival_at, course.time_zone),
  );
  const [departure, setDeparture] = useState(
    localTime(row.departure_at, course.time_zone),
  );
  const [note, setNote] = useState(row.note);
  const [reason, setReason] = useState("");
  const focusedSaveButton = useRef<HTMLButtonElement>(null);
  const save = useMutation({
    mutationFn: (status: AttendanceStatus) =>
      saveAttendance(
        course.id,
        session,
        row,
        status,
        status === "present" ? instant(arrival, course.time_zone) : null,
        status === "present" ? instant(departure, course.time_zone) : null,
        note,
        reason,
      ),
    onSuccess: async () => {
      setReason("");
      await client.invalidateQueries({
        queryKey: attendanceRegisterKey(actor, course.id, session),
      });
      // The confirmed version replaces the editor fields. Keep keyboard focus on this row.
      if (
        focusedSaveButton.current &&
        (document.activeElement === focusedSaveButton.current ||
          document.activeElement === document.body)
      )
        restoreFocus();
    },
  });
  const stale =
    save.isError && "code" in save.error && save.error.code === "PT409";
  return (
    <>
      <div className="attendance-fields">
        <Field id={`arrival-${row.user_id}`} label={t("arrivalTime")}>
          <input
            id={`arrival-${row.user_id}`}
            type="datetime-local"
            value={arrival}
            onChange={(event) => setArrival(event.target.value)}
          />
        </Field>
        <Field id={`departure-${row.user_id}`} label={t("departureTime")}>
          <input
            id={`departure-${row.user_id}`}
            type="datetime-local"
            value={departure}
            onChange={(event) => setDeparture(event.target.value)}
          />
        </Field>
        <Field
          id={`attendance-note-${row.user_id}`}
          label={t("attendanceNote")}
        >
          <textarea
            id={`attendance-note-${row.user_id}`}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {row.version > 0 && (
          <Field
            id={`attendance-reason-${row.user_id}`}
            label={t("attendanceCorrectionReason")}
          >
            <input
              id={`attendance-reason-${row.user_id}`}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
      </div>
      <div
        className="form-actions attendance-actions"
        role="group"
        aria-labelledby={headingId}
      >
        {(["present", "absent", "excused"] as const).map((status) => (
          <Button
            key={status}
            type="button"
            variant={row.status === status ? "default" : "secondary"}
            disabled={
              !online ||
              save.isPending ||
              stale ||
              (row.version > 0 && reason.trim().length < 3)
            }
            onClick={(event) => {
              focusedSaveButton.current =
                document.activeElement === event.currentTarget
                  ? event.currentTarget
                  : null;
              save.mutate(status);
            }}
          >
            {t(`attendance${status}`)}
          </Button>
        ))}
      </div>
      {save.isError && (
        <Notice kind="error">
          {t(
            stale
              ? "attendanceChanged"
              : save.error.message === "attendanceInvalidTime"
                ? "attendanceInvalidTime"
                : "attendanceSaveFailed",
          )}
        </Notice>
      )}
      {stale && (
        <Button
          variant="secondary"
          onClick={() =>
            void client.invalidateQueries({
              queryKey: attendanceRegisterKey(actor, course.id, session),
            })
          }
        >
          {t("refresh")}
        </Button>
      )}
    </>
  );
}

/** This panel is not mounted for participant-only course access. The RPC enforces the same boundary. */
export function AttendancePanel({
  course,
  actor,
  academy,
}: {
  course: CourseWorkspace;
  actor: string;
  academy?: "active" | "grace";
}) {
  const { t, i18n } = useTranslation("learning");
  const online = useOnline();
  const client = useQueryClient();
  const [session, setSession] = useState(course.sessions[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const allowed =
    course.lms_enabled &&
    (course.access.manager || course.access.teacher || course.access.client);
  const query = useQuery({
    ...attendanceRegisterQuery(actor, course.id, session),
    enabled: allowed && Boolean(session) && (!academy || online),
    ...(academy && { refetchInterval: 10_000, refetchOnMount: "always" }),
  });
  const upload = useMutation({
    mutationFn: async () => {
      if (
        !file ||
        file.type !== "application/pdf" ||
        !file.name.toLowerCase().endsWith(".pdf")
      )
        throw new Error("attendancePdfRequired");
      const document = await uploadDocument(file, {
        scope: "personal",
        kind: "material",
      });
      if (document.status !== "clean" || !document.current_version_id)
        throw new Error("attendancePdfRequired");
      return attachAttendancePdf(
        course.id,
        session,
        document.current_version_id,
      );
    },
    onSuccess: async () => {
      setFile(null);
      await client.invalidateQueries({
        queryKey: attendanceRegisterKey(actor, course.id, session),
      });
    },
  });
  if (!allowed || !course.sessions.length) return null;
  const canEdit =
    !academy ||
    (academy === "active" &&
      query.isSuccess &&
      Date.parse(query.data.starts_at) <= query.dataUpdatedAt);
  return (
    <section
      className={`panel learning-panel${academy ? " academy-attendance-register" : ""}`}
      aria-label={t("sessionRegister")}
    >
      <h2>{t("sessionRegister")}</h2>
      <p>{t("sessionRegisterHelp")}</p>
      <Field id="attendance-session" label={t("attendanceSession")}>
        <select
          id="attendance-session"
          value={session}
          onChange={(event) => {
            setSession(event.target.value);
            setFile(null);
            setDownloadError(false);
          }}
        >
          {course.sessions.map((item, index) => (
            <option key={item.id} value={item.id}>
              {t("sessionNumber", { number: index + 1 })} ·{" "}
              {dateTime(item.starts_at, i18n.language, course.time_zone)}
            </option>
          ))}
        </select>
      </Field>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      {query.isSuccess && online && (
        <>
          <p>{t("attendanceZone", { zone: course.time_zone })}</p>
          {!query.data.rows.length && <p>{t("attendanceNoParticipants")}</p>}
          <ul className="learning-resources attendance-entries">
            {query.data.rows.map((row) =>
              canEdit ? (
                <RowEditor
                  key={`${session}:${row.user_id}`}
                  course={course}
                  actor={actor}
                  session={session}
                  row={row}
                />
              ) : (
                <li
                  key={row.user_id}
                  className="panel learning-panel attendance-entry"
                >
                  <h4>
                    {row.name.trim() || t("attendanceUnnamedParticipant")}
                  </h4>
                  <p>
                    {t("attendanceCurrent")}:{" "}
                    {row.status
                      ? t(`attendance${row.status}`)
                      : t("unreported")}
                  </p>
                  {row.arrival_at && (
                    <p>
                      {t("arrivalTime")}:{" "}
                      {dateTime(
                        row.arrival_at,
                        i18n.language,
                        course.time_zone,
                      )}
                    </p>
                  )}
                  {row.departure_at && (
                    <p>
                      {t("departureTime")}:{" "}
                      {dateTime(
                        row.departure_at,
                        i18n.language,
                        course.time_zone,
                      )}
                    </p>
                  )}
                  {row.note && (
                    <p className="preserve-text">
                      {t("attendanceNote")}: {row.note}
                    </p>
                  )}
                </li>
              ),
            )}
          </ul>
          {canEdit && query.data.rows.length > 0 && (
            <AttendanceImportPanel
              key={`${actor}:${course.id}:${session}:${query.data.starts_at}:${query.data.ends_at}`}
              run={course.id}
              register={query.data}
              refreshRegister={() =>
                client.invalidateQueries({
                  queryKey: attendanceRegisterKey(actor, course.id, session),
                })
              }
            />
          )}
          {!academy && (
            <>
              <h3>{t("attendanceEvidence")}</h3>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  upload.mutate();
                }}
              >
                <Field id="attendance-pdf" label={t("attendancePdfLabel")}>
                  <input
                    id="attendance-pdf"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </Field>
                <Button disabled={!online || upload.isPending || !file}>
                  {t("attendanceAttachPdf")}
                </Button>
              </form>
              {upload.isError && (
                <Notice kind="error">{t("attendancePdfFailed")}</Notice>
              )}
              <ul>
                {query.data.evidence.map((item) => (
                  <li key={item.id}>
                    {item.name} ·{" "}
                    {dateTime(
                      item.attached_at,
                      i18n.language,
                      course.time_zone,
                    )}{" "}
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!online}
                      onClick={() => {
                        setDownloadError(false);
                        void downloadCourseDocument(
                          "resource",
                          item.resource_id,
                          item.name,
                        ).catch(() => setDownloadError(true));
                      }}
                    >
                      {t("download")}
                    </Button>
                  </li>
                ))}
              </ul>
              {downloadError && (
                <Notice kind="error">{t("attendancePdfFailed")}</Notice>
              )}
            </>
          )}
          <h3>{t("attendanceCorrections")}</h3>
          <ul>
            {query.data.history.map((item) => (
              <li key={item.id}>
                {query.data?.rows
                  .find((row) => row.user_id === item.user_id)
                  ?.name.trim() || t("attendanceUnnamedParticipant")}{" "}
                · {dateTime(item.created_at, i18n.language, course.time_zone)} ·{" "}
                {item.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
