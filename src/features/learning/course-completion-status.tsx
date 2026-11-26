/** Explain current course completion requirements to learners and scoped staff. */
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import {
  useCourseCompletionStatus,
  type CourseCompletionStatus,
  type CourseWorkspace,
} from "./api";

type StatusQuery = ReturnType<typeof useCourseCompletionStatus>;

/** Convert current rule inputs into an ordered list of actionable blockers. */
function useMissingRequirements(status: CourseCompletionStatus, zone: string) {
  const { t, i18n } = useTranslation("learning");
  const reasons: string[] = [];
  if (!status.enrolment_completed)
    reasons.push(t("completionRequirementEnrolment"));
  if (status.session_count === 0)
    reasons.push(t("completionRequirementNoSessions"));
  if (status.ends_at && status.ended_count < status.session_count) {
    const end = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(status.ends_at));
    reasons.push(t("completionRequirementEnd", { end }));
  }
  if (status.verified_count < status.session_count) {
    reasons.push(
      t("completionRequirementAttendance", {
        verified: status.verified_count,
        total: status.session_count,
      }),
    );
  }
  if (!status.quiz_passed) {
    reasons.push(
      t("completionRequirementQuiz", { version: status.quiz_version }),
    );
  }
  if (status.reverify_required)
    reasons.push(t("completionRequirementReverification"));
  return reasons;
}

/** Use the course time zone for schedule information across device locales. */
function CompletionChecklist({
  status,
  zone,
  refresh,
  fetching,
}: {
  status: CourseCompletionStatus;
  zone: string;
  refresh: () => void;
  fetching: boolean;
}) {
  const { t } = useTranslation("learning");
  const reasons = useMissingRequirements(status, zone);
  switch (status.state) {
    case "issued":
      return <p role="status">{t("completionIssuedStatus")}</p>;
    case "ready":
      return <p role="status">{t("completionReadyStatus")}</p>;
    case "pending":
      return (
        <div className="space-y-2">
          <p role="status">{t("completionPendingStatus")}</p>
          <ul className="list-disc ps-5">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <Button
            type="button"
            variant="secondary"
            disabled={fetching}
            onClick={refresh}
          >
            {t("refresh")}
          </Button>
        </div>
      );
  }
}

/** Do not display cached completion facts while offline or after read denial. */
export function CompletionRequirements({
  query,
  zone,
}: {
  query: StatusQuery;
  zone: string;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  if (!online) return <p role="status">{t("completionRequirementsOffline")}</p>;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data) return <Loading />;
  return (
    <CompletionChecklist
      status={query.data}
      zone={zone}
      refresh={() => void query.refetch()}
      fetching={query.isFetching}
    />
  );
}

/** Inspect one current learner at a time without projecting a private status roster. */
export function StaffCompletionRequirements({
  course,
  actor,
}: {
  course: CourseWorkspace;
  actor: string;
}) {
  const { t } = useTranslation("learning");
  const labelId = useId();
  const [learner, setLearner] = useState("");
  const selected = course.roster.some(({ user_id }) => user_id === learner)
    ? learner
    : null;
  const query = useCourseCompletionStatus(
    course,
    actor,
    selected,
    selected !== null,
  );
  if (!course.roster.length) return null;
  return (
    <section
      className="panel learning-panel space-y-2"
      aria-labelledby={labelId}
    >
      <h2 id={labelId}>{t("completionRequirements")}</h2>
      <label>
        {t("completionSelectLearner")}
        <select
          value={selected ?? ""}
          onChange={(event) => setLearner(event.currentTarget.value)}
        >
          <option value="">{t("completionSelectPlaceholder")}</option>
          {course.roster.map(({ user_id, name }) => (
            <option key={user_id} value={user_id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <CompletionRequirements query={query} zone={course.time_zone} />
      )}
    </section>
  );
}
