/** Read one learner's scoped company activity and edit the company-owned reference. */
import { useEffect, useId, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseWorkspaceKey } from "../learning/api";
import { attendanceRegistersKey } from "../learning/attendance-api";
import { CompanyParticipantCourseAssignment } from "./company-participant-course-assignment";
import {
  type CompanyParticipant,
  companyCourseAssignmentReceiptSchema,
  companyParticipantOverviewSchema,
  companyParticipantReferenceSchema,
  companyReferenceLimit,
} from "./company-participant-schema";
import "./i18n";
import "./company-participant.css";

const pageSize = 30;

export function CompanyParticipantDetails({
  actor,
  organisationId,
  participant,
  returnFocusTo,
  onClose,
}: {
  actor: string;
  organisationId: string;
  participant: CompanyParticipant;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("operations");
  const id = useId();
  const online = useOnline();
  const cache = useQueryClient();
  const assignButton = useRef<HTMLButtonElement>(null);
  const restoreAssignFocus = useRef(false);
  const [assigning, setAssigning] = useState(false);
  const membershipKey = [
    "company-participants",
    actor,
    organisationId,
  ] as const;
  const [draft, setDraft] = useState<{ value: string; version: number } | null>(
    null,
  );
  const overviewKey = [
    "company-participant-overview",
    actor,
    organisationId,
    participant.user_id,
  ] as const;
  const assignmentsKey = [
    "company-participant-assignable-courses",
    actor,
    organisationId,
    participant.user_id,
  ] as const;
  const overview = useInfiniteQuery({
    queryKey: overviewKey,
    enabled: online,
    initialPageParam: 0,
    retry: false,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("company_participant_overview", {
          p_organisation_id: organisationId,
          p_user_id: participant.user_id,
          p_limit: pageSize,
          p_offset: pageParam,
        })
        .abortSignal(signal);
      if (error) throw error;
      return companyParticipantOverviewSchema.parse(data);
    },
    getNextPageParam: (last, _pages, offset) =>
      last.has_more && last.items.length
        ? offset + last.items.length
        : undefined,
  });
  const reference = useMutation({
    mutationFn: async (edit: { value: string; version: number }) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "set_company_participant_reference",
        {
          p_organisation_id: organisationId,
          p_user_id: participant.user_id,
          p_reference: edit.value.trim() || null,
          p_expected_version: edit.version,
        },
      );
      if (error) throw error;
      return companyParticipantReferenceSchema.parse(data);
    },
    onSuccess: (receipt) => {
      cache.setQueryData<CompanyParticipant[]>(membershipKey, (records) =>
        records?.map((row) =>
          row.user_id === participant.user_id ? { ...row, ...receipt } : row,
        ),
      );
      setDraft(null);
      void cache.invalidateQueries({ queryKey: membershipKey });
      void cache.invalidateQueries({
        queryKey: ["company-participant-history", actor, organisationId],
      });
    },
    onError: () => void cache.invalidateQueries({ queryKey: membershipKey }),
  });
  const assignment = useMutation({
    mutationFn: async (courseIds: string[]) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "assign_company_participant_courses",
        {
          p_organisation_id: organisationId,
          p_user_id: participant.user_id,
          p_run_ids: courseIds,
        },
      );
      if (error) throw error;
      const receipt = companyCourseAssignmentReceiptSchema.parse(data);
      const confirmed = new Set([...receipt.enrolled, ...receipt.unchanged]);
      if (
        confirmed.size !== courseIds.length ||
        receipt.enrolled.length + receipt.unchanged.length !==
          courseIds.length ||
        courseIds.some((id) => !confirmed.has(id))
      )
        throw new Error("incomplete_course_assignment_receipt");
      return receipt;
    },
    onSuccess: (receipt) => {
      restoreAssignFocus.current = true;
      setAssigning(false);
      void cache.invalidateQueries({ queryKey: overviewKey });
      void cache.invalidateQueries({ queryKey: assignmentsKey });
      void cache.invalidateQueries({
        queryKey: ["company-participant-history", actor, organisationId],
      });
      for (const courseId of receipt.enrolled) {
        void cache.invalidateQueries({
          queryKey: ["course-enrolments", actor, courseId],
        });
        void cache.invalidateQueries({
          queryKey: ["course-enrolment-candidates", actor, courseId],
        });
        void cache.invalidateQueries({
          queryKey: courseWorkspaceKey(actor, courseId),
        });
        void cache.invalidateQueries({
          queryKey: attendanceRegistersKey(actor, courseId),
        });
      }
    },
    onError: () => void cache.invalidateQueries({ queryKey: assignmentsKey }),
  });
  useEffect(() => {
    if (!assigning && restoreAssignFocus.current) {
      restoreAssignFocus.current = false;
      assignButton.current?.focus();
    }
  }, [assigning]);
  const assignmentError =
    assignment.error &&
    ("code" in assignment.error && assignment.error.code === "PT409"
      ? "unavailable"
      : "unknown");

  const courses = overview.data?.pages.flatMap((page) => page.items) ?? [];
  const stale = draft !== null && draft.version !== participant.version;
  return (
    <Dialog
      open
      returnFocusTo={returnFocusTo}
      onOpenChange={(open) => {
        if (!open && !reference.isPending && !assignment.isPending) onClose();
      }}
      title={
        assigning
          ? t("participantAssignFor", { name: participant.display_name })
          : participant.display_name
      }
      description={t(
        assigning ? "participantAssignHelp" : "participantDetailsDescription",
      )}
    >
      {assigning ? (
        <CompanyParticipantCourseAssignment
          actor={actor}
          organisationId={organisationId}
          userId={participant.user_id}
          pending={assignment.isPending}
          error={assignmentError}
          onAssign={(ids) => assignment.mutate(ids)}
          onChange={assignment.reset}
          onBack={() => {
            assignment.reset();
            restoreAssignFocus.current = true;
            setAssigning(false);
          }}
        />
      ) : (
        <>
          <section
            className="company-participant-courses"
            aria-label={t("participantCourseActivity")}
          >
            <div className="company-participant-course-heading">
              <h3>{t("participantCourseActivity")}</h3>
              <Button
                type="button"
                ref={assignButton}
                disabled={!online || reference.isPending}
                onClick={() => {
                  assignment.reset();
                  setAssigning(true);
                }}
              >
                {t("participantAssignCourses")}
              </Button>
            </div>
            {assignment.isSuccess && (
              <Notice kind="success">
                {assignment.data.enrolled.length
                  ? t("participantAssignSuccess", {
                      count: assignment.data.enrolled.length,
                    })
                  : t("participantAssignAlreadyDone")}
                {assignment.data.enrolled.length > 0 &&
                assignment.data.unchanged.length > 0
                  ? " " +
                    t("participantAssignUnchanged", {
                      count: assignment.data.unchanged.length,
                    })
                  : null}
              </Notice>
            )}
            {overview.isPending && <Loading />}
            {overview.isError && (
              <ErrorState retry={() => void overview.refetch()} />
            )}
            {!overview.isPending && !overview.isError && !courses.length && (
              <p>{t("participantNoCourses")}</p>
            )}
            {!overview.isError && (
              <ul>
                {courses.map((course) => (
                  <li key={course.run_id}>
                    <Link to={`/courses/${course.run_id}/workspace`}>
                      {course.title}
                    </Link>
                    <p className="muted">
                      {t(`participantEnrolment.${course.status}`)}
                      {course.starts_at &&
                        ` · ${dateTime(course.starts_at, i18n.language, course.time_zone)}`}
                      {course.ends_at &&
                        ` – ${dateTime(course.ends_at, i18n.language, course.time_zone)}`}
                    </p>
                    {course.starts_at && (
                      <small className="muted">
                        {t("participantCourseTimeZone", {
                          zone: course.time_zone,
                        })}
                      </small>
                    )}
                    <p>
                      {t("participantAttendanceCounts", {
                        present: course.present_count,
                        absent: course.absent_count,
                        excused: course.excused_count,
                        sessions: course.session_count,
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {overview.hasNextPage && !overview.isError && (
              <Button
                type="button"
                variant="secondary"
                disabled={!online || overview.isFetchingNextPage}
                onClick={() => void overview.fetchNextPage()}
              >
                {t("participantMoreCourses")}
              </Button>
            )}
          </section>
          <dl className="company-participant-details">
            <div>
              <dt>{t("participantUserId")}</dt>
              <dd>{participant.luminovia_user_id}</dd>
            </div>
          </dl>
          <form
            className="company-participant-reference"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft && !stale && online && !reference.isPending)
                reference.mutate(draft);
            }}
          >
            <Field
              id={id + "-reference"}
              label={t("participantCompanyReference")}
            >
              <input
                value={draft?.value ?? participant.company_reference ?? ""}
                maxLength={companyReferenceLimit}
                autoComplete="off"
                disabled={!online || reference.isPending}
                onChange={(event) => {
                  reference.reset();
                  const value = event.currentTarget.value;
                  setDraft((previous) => ({
                    value,
                    version: previous?.version ?? participant.version,
                  }));
                }}
              />
            </Field>
            {stale && (
              <Notice kind="error">
                {t("participantReferenceStale")}
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setDraft(null)}
                >
                  {t("participantUseCurrentReference")}
                </Button>
              </Notice>
            )}
            {!stale && reference.isError && (
              <Notice kind="error">{t("participantReferenceError")}</Notice>
            )}
            {reference.isSuccess && (
              <Notice kind="success">{t("participantReferenceSaved")}</Notice>
            )}
            <Button
              type="submit"
              variant="secondary"
              disabled={
                !online ||
                reference.isPending ||
                !draft ||
                stale ||
                (draft.value.trim() || null) === participant.company_reference
              }
            >
              {t("participantSaveReference")}
            </Button>
          </form>
        </>
      )}
    </Dialog>
  );
}
