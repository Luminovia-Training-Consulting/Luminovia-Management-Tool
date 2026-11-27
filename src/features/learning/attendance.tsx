/** Staff/company session register and protected PDF evidence on the existing file path. */
import { AttendanceImportPanel } from "./attendance-import-panel";
import { AttendanceSummary } from "./attendance-summary";
import { AttendanceBulkMark } from "./attendance-bulk-mark";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime, zonedInstantForEdit } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { uploadAcademyAttendancePdf, uploadDocument } from "../files/api";
import {
  downloadCourseDocument,
  downloadPortalDocument,
  type CourseWorkspace,
} from "./api";
import {
  attachAttendancePdf,
  attendanceRegisterKey,
  attendanceSummariesKey,
  attendanceRegisterQuery,
  saveAttendance,
  type AttendanceRegister,
  type AttendanceRow,
  type AttendanceStatus,
} from "./attendance-api";
import { attendanceStatuses } from "./attendance-schema";

function localTime(value: string | null, zone: string) {
  return value
    ? DateTime.fromISO(value, { zone }).toFormat("yyyy-MM-dd'T'HH:mm")
    : "";
}
function editedInstant(value: string, original: string | null, zone: string) {
  const converted = zonedInstantForEdit(
    value,
    zone,
    localTime(original, zone),
    original,
  );
  if (value && !converted) throw new Error("attendanceInvalidTime");
  return converted;
}

type AttendanceAction =
  | { kind: "manual"; status: AttendanceStatus }
  | { kind: "arrive" | "leave"; at: string };

type RowEditorProps = {
  course: CourseWorkspace;
  actor: string;
  session: string;
  row: AttendanceRow;
  endsAt: string;
  lastReadAt: number;
};

function AttendanceExport({
  register,
  academy,
}: {
  register: AttendanceRegister;
  academy: boolean;
}) {
  const { t } = useTranslation("learning");
  const day = DateTime.fromISO(register.starts_at, {
    zone: register.time_zone,
  }).toISODate();
  const download = useMutation({
    mutationFn: (format: "csv" | "pdf") =>
      downloadPortalDocument(
        {
          kind: academy ? "attendance" : "attendance_session",
          id: register.session_id,
          format,
        },
        `attendance-${day ?? "session"}-${register.session_id.slice(0, 8)}.${format}`,
      ),
  });
  return (
    <div>
      <div className="form-actions">
        {(["csv", "pdf"] as const).map((format) => (
          <Button
            key={format}
            type="button"
            variant="secondary"
            disabled={download.isPending}
            onClick={() => download.mutate(format)}
          >
            {t(
              format === "csv" ? "attendanceExportCsv" : "attendanceExportPdf",
            )}
          </Button>
        ))}
      </div>
      {download.isError && (
        <Notice kind="error">
          {t(
            download.error.message === "unsupported_glyph"
              ? "unsupportedGlyph"
              : "attendanceExportFailed",
          )}
        </Notice>
      )}
    </div>
  );
}

function RowEditor({ hidden, ...props }: RowEditorProps & { hidden: boolean }) {
  const { t } = useTranslation("learning");
  const { row } = props;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <li className="panel learning-panel attendance-entry" hidden={hidden}>
      <h4 id={headingId} ref={heading} tabIndex={-1}>
        {row.name.trim() || t("attendanceUnnamedParticipant")}
      </h4>
      <p
        role="status"
        className="attendance-status"
        data-attendance-status={row.status ?? "unmarked"}
      >
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
  endsAt,
  lastReadAt,
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
    mutationFn: (action: AttendanceAction) => {
      const zone = course.time_zone;
      if (action.kind === "manual") {
        const { status } = action;
        return saveAttendance(
          course.id,
          session,
          row,
          status,
          status === "present"
            ? editedInstant(arrival, row.arrival_at, zone)
            : null,
          status === "present"
            ? editedInstant(departure, row.departure_at, zone)
            : null,
          note,
          reason,
        );
      }
      const timestamp = Date.parse(action.at);
      const end = Date.parse(endsAt);
      if (timestamp > end + (action.kind === "leave" ? 3_600_000 : 0))
        throw new Error("attendanceInvalidTime");
      return saveAttendance(
        course.id,
        session,
        row,
        "present",
        action.kind === "arrive" ? action.at : row.arrival_at,
        action.kind === "leave" ? action.at : row.departure_at,
        row.note,
        t(
          action.kind === "arrive"
            ? "attendanceArrivalReason"
            : "attendanceDepartureReason",
        ),
      );
    },
    onSuccess: async () => {
      setReason("");
      await Promise.all([
        client.invalidateQueries({
          queryKey: attendanceRegisterKey(actor, course.id, session),
        }),
        client.invalidateQueries({ queryKey: attendanceSummariesKey(actor) }),
      ]);
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
    save.isError &&
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    ["PT409", "40001"].includes(String(save.error.code));
  const hasDraft =
    arrival !== localTime(row.arrival_at, course.time_zone) ||
    departure !== localTime(row.departure_at, course.time_zone) ||
    note !== row.note ||
    Boolean(reason.trim());
  const quickDisabled = !online || save.isPending || stale || hasDraft;
  const end = Date.parse(endsAt);
  function submit(button: HTMLButtonElement, action: AttendanceAction) {
    focusedSaveButton.current =
      document.activeElement === button ? button : null;
    save.mutate(action);
  }
  return (
    <>
      {lastReadAt <= end + 3_600_000 && (
        <div
          className="form-actions attendance-actions"
          role="group"
          aria-labelledby={headingId}
        >
          {lastReadAt <= end && (
            <Button
              type="button"
              variant="secondary"
              disabled={
                quickDisabled || Boolean(row.arrival_at || row.departure_at)
              }
              onClick={(event) =>
                submit(event.currentTarget, {
                  kind: "arrive",
                  at: new Date().toISOString(),
                })
              }
            >
              {t("attendanceArrivedNow")}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={
              quickDisabled ||
              row.status !== "present" ||
              Boolean(row.departure_at)
            }
            onClick={(event) =>
              submit(event.currentTarget, {
                kind: "leave",
                at: new Date().toISOString(),
              })
            }
          >
            {t("attendanceDepartedNow")}
          </Button>
        </div>
      )}
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
            variant="secondary"
            aria-pressed={row.status === status}
            data-attendance-status={status}
            disabled={
              !online ||
              save.isPending ||
              stale ||
              (row.version > 0 && reason.trim().length < 3)
            }
            onClick={(event) =>
              submit(
                event.currentTarget,
                status === "present" &&
                  !hasDraft &&
                  !row.arrival_at &&
                  !row.departure_at &&
                  lastReadAt <= end
                  ? { kind: "arrive", at: new Date().toISOString() }
                  : { kind: "manual", status },
              )
            }
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
/** Attach the exact confirmation to the selected register. */
function AttendanceEvidence({
  data,
  courseId,
  academy,
  canUpload,
  refresh,
}: {
  data: AttendanceRegister;
  courseId: string;
  academy: boolean;
  canUpload: boolean;
  refresh: () => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation("learning");
  const online = useOnline();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [downloadError, setDownloadError] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const stage = useRef<{ clientId: string; version?: string } | null>(null);
  const upload = useMutation({
    mutationFn: async () => {
      if (
        !canUpload ||
        !online ||
        !file ||
        !stage.current ||
        (!academy && file.type !== "application/pdf") ||
        !file.name.toLowerCase().endsWith(".pdf")
      )
        throw new Error("attendancePdfRequired");
      if (!stage.current.version) {
        const document = academy
          ? await uploadAcademyAttendancePdf(
              file,
              data.session_id,
              stage.current.clientId,
            )
          : await uploadDocument(file, { scope: "personal", kind: "material" });
        if (document.status !== "clean" || !document.current_version_id)
          throw new Error("attendancePdfRequired");
        stage.current.version = document.current_version_id;
      }
      const version = stage.current.version;
      const receipt = await attachAttendancePdf(
        courseId,
        data.session_id,
        version,
      );
      if (!receipt?.id || receipt.version_id !== version)
        throw new Error("attendancePdfRequired");
    },
    onSuccess: async () => {
      stage.current = null;
      setFile(null);
      if (input.current) input.current.value = "";
      await refresh();
    },
  });
  if (!canUpload && !data.evidence.length) return null;
  return (
    <>
      <h3>{t("attendanceEvidence")}</h3>
      {canUpload && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (file && !upload.isPending) upload.mutate();
          }}
        >
          <Field id="attendance-pdf" label={t("attendancePdfLabel")}>
            <input
              ref={input}
              id="attendance-pdf"
              type="file"
              accept="application/pdf,.pdf"
              disabled={!online || upload.isPending}
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null;
                stage.current = selected
                  ? { clientId: crypto.randomUUID() }
                  : null;
                setFile(selected);
                upload.reset();
              }}
            />
          </Field>
          <Button disabled={!online || upload.isPending || !file}>
            {t("attendanceAttachPdf")}
          </Button>
        </form>
      )}
      {data.evidence.length > 0 && (
        <ul>
          {data.evidence.map((item) => (
            <li key={item.id}>
              {item.name} ·{" "}
              {dateTime(item.attached_at, i18n.language, data.time_zone)}{" "}
              <Button
                type="button"
                variant="secondary"
                disabled={!online || downloadingId !== null}
                onClick={async () => {
                  setDownloadError(false);
                  setDownloadingId(item.id);
                  try {
                    if (item.resource_id === null) {
                      await downloadPortalDocument(
                        { kind: "attendance_evidence", id: item.id },
                        item.name,
                      );
                    } else {
                      await downloadCourseDocument(
                        "resource",
                        item.resource_id,
                        item.name,
                      );
                    }
                  } catch {
                    setDownloadError(true);
                  } finally {
                    setDownloadingId(null);
                  }
                }}
              >
                {t("download")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(upload.isError || downloadError) && (
        <Notice kind="error">{t("attendancePdfFailed")}</Notice>
      )}
    </>
  );
}

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
  const [selection, setSession] = useState(() => {
    const now = Date.now();
    const live = course.sessions.find(
      ({ starts_at, ends_at }) =>
        Date.parse(starts_at) <= now && now <= Date.parse(ends_at),
    );
    return live?.id ?? course.sessions[0]?.id ?? "";
  });
  const session = course.sessions.some(({ id }) => id === selection)
    ? selection
    : (course.sessions[0]?.id ?? "");
  const filterId = useId();
  const [statusControl, setStatusControl] = useState<HTMLSelectElement | null>(
    null,
  );
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"all" | "unmarked" | AttendanceStatus>(
    "all",
  );
  const allowed =
    course.access.manager || course.access.teacher || course.access.client;
  const query = useQuery({
    ...attendanceRegisterQuery(actor, course.id, session, Boolean(academy)),
    enabled: allowed && Boolean(session) && (!academy || online),
    ...(academy && { refetchOnMount: "always" }),
    refetchInterval: ({ state }) => {
      if (!online) return false;
      if (academy) return 10_000;
      if (state.status !== "success") return false;
      const start = Date.parse(state.data?.starts_at ?? "");
      const end = Date.parse(state.data?.ends_at ?? "");
      const transition = [start, end + 1, end + 3_600_001].find(
        (time) => time > state.dataUpdatedAt,
      );
      // Recheck at the start and at the arrival and departure cutoffs.
      return transition === undefined
        ? false
        : Math.max(1, Math.min(transition - Date.now(), 2_147_483_647));
    },
  });
  if (!allowed || !course.sessions.length) return null;
  const canEdit =
    academy !== "grace" &&
    query.isSuccess &&
    Date.parse(query.data.starts_at) <= query.dataUpdatedAt;
  const rows = query.data?.rows ?? [];
  const counts = { unmarked: 0, present: 0, absent: 0, excused: 0 };
  for (const row of rows) counts[row.status ?? "unmarked"]++;
  const needle = name.trim().normalize("NFC").toLowerCase();
  const visibleRows = rows.filter(
    (row) =>
      (status === "all" || (row.status ?? "unmarked") === status) &&
      row.name.normalize("NFC").toLowerCase().includes(needle),
  );
  const visibleIds = new Set(visibleRows.map((row) => row.user_id));
  const refreshRegister = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: attendanceRegisterKey(actor, course.id, session),
      }),
      client.invalidateQueries({ queryKey: attendanceSummariesKey(actor) }),
    ]);
  return (
    <section
      className={`panel learning-panel${academy ? " academy-attendance-register" : ""}`}
      aria-label={t("sessionRegister")}
    >
      <h2>{t("sessionRegister")}</h2>
      <AttendanceSummary actor={actor} run={course.id} />
      <p>{t("sessionRegisterHelp")}</p>
      <Field id="attendance-session" label={t("attendanceSession")}>
        <select
          id="attendance-session"
          value={session}
          onChange={(event) => {
            setSession(event.target.value);
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
          <AttendanceExport
            key={query.data.session_id}
            register={query.data}
            academy={Boolean(academy)}
          />
          {rows.length ? (
            <>
              <ul
                aria-label={t("attendanceCounts")}
                className="attendance-counts"
              >
                {(["unmarked", ...attendanceStatuses] as const).map((key) => (
                  <li key={key} className="badge">
                    {t(`attendance${key}`)}: {counts[key]}
                  </li>
                ))}
              </ul>
              <div className="attendance-register-filters">
                <Field
                  id={`${filterId}-name`}
                  label={t("attendanceFilterName")}
                >
                  <input
                    id={`${filterId}-name`}
                    type="search"
                    value={name}
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                </Field>
                <Field
                  id={`${filterId}-status`}
                  label={t("attendanceFilterStatus")}
                >
                  <select
                    id={`${filterId}-status`}
                    ref={setStatusControl}
                    value={status}
                    onChange={(event) =>
                      setStatus(event.currentTarget.value as typeof status)
                    }
                  >
                    <option value="all">{t("attendanceAllStatuses")}</option>
                    {(["unmarked", ...attendanceStatuses] as const).map(
                      (key) => (
                        <option key={key} value={key}>
                          {t(`attendance${key}`)}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
              </div>
              {!visibleRows.length && <p>{t("attendanceNoMatches")}</p>}
              {canEdit && (
                <AttendanceBulkMark
                  key={`${actor}:${course.id}:${session}:${query.data.starts_at}:${query.data.ends_at}`}
                  run={course.id}
                  register={query.data}
                  visibleRows={visibleRows}
                  refreshRegister={refreshRegister}
                  statusControl={statusControl}
                />
              )}
            </>
          ) : (
            <p>{t("attendanceNoParticipants")}</p>
          )}
          <ul className="learning-resources attendance-entries">
            {rows.map((row) =>
              canEdit ? (
                <RowEditor
                  key={`${session}:${row.user_id}`}
                  course={course}
                  actor={actor}
                  session={session}
                  row={row}
                  endsAt={query.data.ends_at}
                  lastReadAt={query.dataUpdatedAt}
                  hidden={!visibleIds.has(row.user_id)}
                />
              ) : (
                <li
                  key={row.user_id}
                  className="panel learning-panel attendance-entry"
                  hidden={!visibleIds.has(row.user_id)}
                >
                  <h4>
                    {row.name.trim() || t("attendanceUnnamedParticipant")}
                  </h4>
                  <p
                    className="attendance-status"
                    data-attendance-status={row.status ?? "unmarked"}
                  >
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
              refreshRegister={refreshRegister}
            />
          )}
          <AttendanceEvidence
            key={`${actor}:${course.id}:${session}`}
            data={query.data}
            courseId={course.id}
            academy={Boolean(academy)}
            canUpload={academy !== "grace"}
            refresh={refreshRegister}
          />
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
