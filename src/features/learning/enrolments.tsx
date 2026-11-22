/** In-course management and self-withdrawal using the live Premium enrolment RPCs. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { TableImport } from "../../components/table-import";
import { importTableRow } from "../../components/table-import-api";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { dateTime } from "../../lib/dates";
import { notificationKeys } from "../notifications/api";
import {
  courseHubQuery,
  courseWorkspaceKey,
  type CourseOverview,
  type CourseWorkspace,
} from "./api";
import { attendanceRegistersKey } from "./attendance-api";
import { courseWithdrawalWindowSchema } from "./course-withdrawal-schema";
import "./enrolment-i18n";
import "./enrolments.css";

type Props = { course: CourseWorkspace; actor: string };
type Status = "enrolled" | "completed" | "removed";
type Enrolment = { user_id: string; display_name: string; status: Status };
type Candidate = Omit<Enrolment, "status"> & { luminovia_user_id: string };
type Change = {
  participant: Pick<Enrolment, "user_id" | "display_name">;
  status: Status;
};

const statusLabel = {
  enrolled: "enrolmentEnrolled",
  completed: "enrolmentCompleted",
  removed: "enrolmentRemoved",
};
const confirmation = {
  enrolled: "enrolmentConfirmEnrol",
  completed: "enrolmentConfirmComplete",
  removed: "enrolmentConfirmRemove",
};

/** The company scope is resolved from the course on the server; no organisation is sent by this component. */
export function CourseEnrolmentsPanel({
  course,
  actor,
  academy,
}: Props & { academy?: boolean }) {
  const { t, i18n } = useTranslation("learning");
  const queryClient = useQueryClient();
  const online = useOnline();
  const fieldId = useId();
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selection, setSelection] = useState("");
  const [change, setChange] = useState<Change | null>(null);
  const allowed =
    course.lms_enabled && (course.access.manager || course.access.client);
  const enrolmentsKey = ["course-enrolments", actor, course.id];
  const candidatesKey = ["course-enrolment-candidates", actor, course.id];
  const enrolments = useQuery({
    queryKey: enrolmentsKey,
    enabled: online && allowed,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_enrolments", {
          p_course_run_id: course.id,
        })
        .abortSignal(signal);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_course_enrolments");
      return data as Enrolment[];
    },
    retry: false,
  });
  const candidates = useQuery({
    queryKey: [...candidatesKey, search],
    enabled: online && allowed,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_enrolment_candidates", {
          p_course_run_id: course.id,
          p_search: search,
        })
        .abortSignal(signal);
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_course_candidates");
      return data as Candidate[];
    },
    retry: false,
  });
  async function saveEnrolment(userId: string, status: Status) {
    requireOnline();
    const { error } = await db().rpc("manage_course_enrolment", {
      p_course_run_id: course.id,
      p_user_id: userId,
      p_status: status,
    });
    if (error) throw error;
  }

  const refreshEnrolments = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: enrolmentsKey }),
      queryClient.invalidateQueries({ queryKey: candidatesKey }),
      queryClient.invalidateQueries({
        queryKey: courseWorkspaceKey(actor, course.id),
      }),
      queryClient.invalidateQueries({
        queryKey: attendanceRegistersKey(actor, course.id),
      }),
    ]);

  const save = useMutation({
    mutationFn: ({ participant, status }: Change) =>
      saveEnrolment(participant.user_id, status),
    onSuccess: async () => {
      setChange(null);
      setSelection("");
      await refreshEnrolments();
    },
  });
  const participant = candidates.data?.find(
    (candidate) => candidate.user_id === selection,
  );
  const enrolmentError = save.error as { details?: string } | null;
  const errorMessage =
    enrolmentError?.details === "academy_course_unpublished"
      ? "academyEnrolmentUnpublished"
      : enrolmentError?.details === "academy_course_capacity_reached"
        ? "academyEnrolmentFull"
        : "enrolmentFailed";

  /** Reset the prior mutation result whenever a different command is reviewed. */
  const review = (intent: Change) => {
    save.reset();
    setChange(intent);
  };

  if (!allowed) return null;
  return (
    <section
      className="panel learning-panel course-enrolments"
      aria-labelledby={`${fieldId}-title`}
    >
      <h2 id={`${fieldId}-title`}>{t("enrolmentAdmin")}</h2>
      {!online ? (
        <Notice>{t("enrolmentOffline")}</Notice>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSelection("");
              setSearch(searchInput.trim());
            }}
          >
            <Field
              id={`${fieldId}-search`}
              label={t(academy ? "academyEnrolmentSearch" : "enrolmentSearch")}
            >
              <input
                id={`${fieldId}-search`}
                type="search"
                value={searchInput}
                maxLength={120}
                onChange={(event) => setSearchInput(event.currentTarget.value)}
              />
            </Field>
            <Button type="submit" variant="secondary">
              {t("enrolmentSearchButton")}
            </Button>
          </form>
          {candidates.isError || enrolments.isError ? (
            <Notice kind="error">{t("enrolmentReadError")}</Notice>
          ) : null}
          {candidates.isPending || enrolments.isPending ? <Loading /> : null}
          {candidates.isSuccess &&
            (candidates.data.length === 0 ? (
              <p className="muted">
                {t(
                  academy
                    ? "academyEnrolmentNoCandidates"
                    : "enrolmentNoCandidates",
                )}
              </p>
            ) : (
              <div className="course-enrolment-actions">
                <Field
                  id={`${fieldId}-candidate`}
                  label={t("enrolmentCandidate")}
                  hint={
                    candidates.data.length === 100
                      ? t("enrolmentSearchMore")
                      : undefined
                  }
                >
                  <select
                    id={`${fieldId}-candidate`}
                    value={selection}
                    onChange={(event) =>
                      setSelection(event.currentTarget.value)
                    }
                  >
                    <option value="">
                      {t("enrolmentCandidatePlaceholder")}
                    </option>
                    {candidates.data.map((candidate) => (
                      <option key={candidate.user_id} value={candidate.user_id}>
                        {candidate.display_name} · {candidate.luminovia_user_id}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button
                  type="button"
                  disabled={!participant || save.isPending}
                  onClick={() =>
                    participant && review({ participant, status: "enrolled" })
                  }
                >
                  {t("enrolmentEnrol")}
                </Button>
              </div>
            ))}
          {candidates.isSuccess && enrolments.isSuccess && (
            <TableImport
              key={course.id}
              label={
                i18n.language.startsWith("de")
                  ? "Teilnehmende für diesen Kurs importieren"
                  : "Import participants into this course"
              }
              filename="course-participants"
              columns={["luminovia_user_id"]}
              example={["LV-0000-0000-0000-0000-0001"]}
              parse={({ luminovia_user_id }) => {
                const id = luminovia_user_id.trim().toUpperCase();
                if (!/^LV(?:-[0-9A-F]{4}){5}$/.test(id))
                  throw new Error("invalid participant ID");
                return id;
              }}
              save={(id, key) =>
                importTableRow(key, "enrolment", { id }, course.id)
              }
              refresh={refreshEnrolments}
            />
          )}
          {enrolments.isSuccess && (
            <>
              <h3>{t("enrolmentCurrent")}</h3>
              {enrolments.data.length === 0 ? (
                <p className="muted">{t("enrolmentEmpty")}</p>
              ) : (
                <ul className="course-enrolment-roster">
                  {enrolments.data.map((item) => (
                    <li key={item.user_id}>
                      <div>
                        <strong>{item.display_name}</strong>{" "}
                        <span className="badge">
                          {t(statusLabel[item.status])}
                        </span>
                      </div>
                      <div className="course-enrolment-actions">
                        {course.ended && item.status === "enrolled" && (
                          <Button
                            type="button"
                            variant="secondary"
                            aria-label={t("enrolmentCompleteFor", {
                              name: item.display_name,
                            })}
                            disabled={save.isPending}
                            onClick={() =>
                              review({ participant: item, status: "completed" })
                            }
                          >
                            {t("enrolmentComplete")}
                          </Button>
                        )}
                        {item.status !== "removed" && (
                          <Button
                            type="button"
                            variant="ghost"
                            aria-label={t("enrolmentRemoveFor", {
                              name: item.display_name,
                            })}
                            disabled={save.isPending}
                            onClick={() =>
                              review({ participant: item, status: "removed" })
                            }
                          >
                            {t("enrolmentRemove")}
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {save.isSuccess && <Notice>{t("enrolmentSaved")}</Notice>}
        </>
      )}
      <Dialog
        title={t("enrolmentAdmin")}
        open={change !== null}
        onOpenChange={(open) => {
          if (!open && !save.isPending) setChange(null);
        }}
        description={
          change
            ? t(confirmation[change.status], {
                name: change.participant.display_name,
              })
            : ""
        }
      >
        {change && (
          <>
            {save.isError && <Notice kind="error">{t(errorMessage)}</Notice>}
            <div className="course-enrolment-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={save.isPending}
                onClick={() => setChange(null)}
              >
                {t("enrolmentCancel")}
              </Button>
              <Button
                type="button"
                disabled={!online || save.isPending}
                onClick={() => save.mutate(change)}
              >
                {t("enrolmentConfirm")}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}

/** Present the server's current withdrawal window and wait for the guarded write. */
export function CourseWithdrawal({
  course,
  actor,
  academy,
}: Props & { academy?: "active" | "grace" }) {
  const { t, i18n } = useTranslation("learning");
  const online = useOnline();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const allowed = course.lms_enabled && course.access.learner && !course.ended;
  const windowKey = ["course-withdrawal-window", actor, course.id] as const;
  const availability = useQuery({
    queryKey: windowKey,
    enabled: online && allowed,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_withdrawal_window", {
          p_course_run_id: course.id,
        })
        .abortSignal(signal);
      if (error) throw error;
      return courseWithdrawalWindowSchema.parse(data);
    },
    retry: false,
    refetchInterval: 60_000,
  });
  const withdrawal = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("cancel_own_course_enrolment", {
        p_course_run_id: course.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setConfirming(false);
      const hubKey = courseHubQuery(actor).queryKey;
      await queryClient.cancelQueries({ queryKey: hubKey });
      queryClient.setQueryData<CourseOverview[]>(hubKey, (courses) =>
        courses?.filter(({ id }) => id !== course.id),
      );
      void navigate("/learning", { replace: true });
      for (const queryKey of [
        windowKey,
        courseWorkspaceKey(actor, course.id),
        ["course-workspace-entitlement", actor, course.id],
        ["course-welcome", actor, course.id],
        ["course-chat-rooms", actor, course.id],
        ["course-chat-messages", actor, course.id],
      ])
        queryClient.removeQueries({ queryKey });
      if (academy) {
        queryClient.removeQueries({ queryKey: ["academy-timetable", actor] });
        void queryClient.resetQueries({
          queryKey: notificationKeys.all(actor),
        });
      }
      void queryClient.invalidateQueries({ queryKey: hubKey });
    },
    onError: () => queryClient.invalidateQueries({ queryKey: windowKey }),
  });
  if (!allowed) return null;
  const deadline = availability.data?.deadline_at;
  const canWithdraw = Boolean(
    online &&
    academy !== "grace" &&
    availability.isSuccess &&
    availability.data.can_withdraw,
  );
  return (
    <div className="course-withdrawal">
      {availability.isError && online && (
        <Notice kind="error">{t("withdrawalWindowFailed")}</Notice>
      )}
      {deadline && (
        <p className="muted">
          {t("withdrawalDeadline", {
            date: dateTime(deadline, i18n.language, course.time_zone),
          })}
        </p>
      )}
      {canWithdraw && (
        <Button
          type="button"
          variant="secondary"
          disabled={withdrawal.isPending}
          onClick={() => {
            withdrawal.reset();
            setConfirming(true);
          }}
        >
          {t("withdrawalOpen")}
        </Button>
      )}
      <Dialog
        title={t("withdrawalOpen")}
        open={confirming && academy !== "grace"}
        description={t("withdrawalConfirm", { course: course.title })}
        onOpenChange={(open) => {
          if (!open && !withdrawal.isPending) setConfirming(false);
        }}
      >
        {withdrawal.isError ? (
          <Notice kind="error">{t("withdrawalFailed")}</Notice>
        ) : !canWithdraw && !withdrawal.isPending ? (
          <Notice>{t("withdrawalUnavailable")}</Notice>
        ) : null}
        <div className="course-enrolment-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={withdrawal.isPending}
            onClick={() => setConfirming(false)}
          >
            {t("enrolmentCancel")}
          </Button>
          <Button
            type="button"
            disabled={!canWithdraw || withdrawal.isPending}
            onClick={() => withdrawal.mutate()}
          >
            {t("enrolmentConfirm")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
