/** Online-only course policy publishing, explicit pinning and reasoned staff attestation. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { zonedInstantForScheduleEdit } from "../../lib/dates";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseCompletionStatusKey } from "./api";
import {
  courseCompletionPolicyProjection,
  type CompletionPinnedPolicy,
  type CompletionPolicyAction,
  type CompletionPolicyPayload,
  type CompletionPolicyProjection,
  type CompletionExceptionRequirement,
  type CompletionReviewDecision,
} from "./course-completion-policy-schema";
import "./course-completion-policy-i18n";

const completionPolicyKey = (actor: string, course: string) => [
  "course-completion-policy",
  actor,
  course,
];

/** Every operation is bound to the current course identity and live server authority. */
function usePolicyQuery(actor: string, course: string) {
  return useQuery({
    queryKey: completionPolicyKey(actor, course),
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_completion_policy", { p_run_id: course })
        .abortSignal(signal);
      if (error) throw error;
      return courseCompletionPolicyProjection.parse(data);
    },
    gcTime: 0,
    retry: false,
  });
}

function usePolicyAction(actor: string, course: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (request: CompletionPolicyAction) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "course_completion_policy_action",
        request,
      );
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({
          queryKey: completionPolicyKey(actor, course),
        }),
        cache.invalidateQueries({
          queryKey: courseCompletionStatusKey(actor, course),
        }),
      ]);
    },
  });
}

function PolicyError({ error }: { error: unknown }) {
  const { t } = useTranslation("learning");
  if (!error) return null;
  const conflict =
    typeof error === "object" && "code" in error && error.code === "PT409";
  return (
    <Notice kind="error">
      {t(conflict ? "completionPolicyConflict" : "saveError")}
    </Notice>
  );
}

const localMinute = (instant: string, zone: string) =>
  DateTime.fromISO(instant).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");

function EditPolicy({
  data,
  actor,
  course,
  zone,
}: {
  data: CompletionPolicyProjection;
  actor: string;
  course: string;
  zone: string;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const { head, assignments, framework } = data;
  const previousPin = Boolean(
    head?.competency_pin && head.competency_pin !== framework?.pin_version,
  );
  const [attendance, setAttendance] = useState(head?.attendance_percent ?? 80);
  const [assignment, setAssignment] = useState(head?.assignment_id ?? "");
  const [competency, setCompetency] = useState(
    previousPin ? "previous" : (head?.competency_id ?? ""),
  );
  const [level, setLevel] = useState(
    previousPin ? "" : (head?.minimum_level_id ?? ""),
  );
  const [teacher, setTeacher] = useState(head?.lecturer_verification ?? false);
  const [target, setTarget] = useState(
    head?.target_at ? localMinute(head.target_at, zone) : "",
  );
  const [invalid, setInvalid] = useState(false);
  const action = usePolicyAction(actor, course);
  function publish(event: FormEvent) {
    event.preventDefault();
    const instant = target
      ? zonedInstantForScheduleEdit(
          target,
          zone,
          head?.target_at ?? undefined,
          zone,
        )
      : null;
    const validCompetency =
      competency !== "previous" && (!competency || Boolean(level && framework));
    setInvalid(Boolean(target && !instant) || !validCompetency);
    if ((target && !instant) || !validCompetency || action.isPending) return;
    const payload: CompletionPolicyPayload = {
      attendance_percent: attendance,
      assignment_id: assignment || null,
      competency_pin: competency ? (framework?.pin_version ?? null) : null,
      competency_id: competency || null,
      minimum_level_id: competency ? level || null : null,
      lecturer_verification: teacher,
      target_at: instant,
    };
    action.mutate({
      p_run_id: course,
      p_action: "publish",
      p_expected_version: head?.version ?? 0,
      p_payload: payload,
    });
  }
  return (
    <form onSubmit={publish} className="space-y-3">
      <fieldset
        disabled={action.isPending}
        className="grid grid-cols-[minmax(0,1fr)] gap-3"
      >
        <Field id={id + "-attendance"} label={t("completionPolicyAttendance")}>
          <input
            type="number"
            required
            min={1}
            max={100}
            value={Number.isNaN(attendance) ? "" : attendance}
            onChange={(event) =>
              setAttendance(event.currentTarget.valueAsNumber)
            }
          />
        </Field>
        <Field id={id + "-assignment"} label={t("completionPolicyAssignment")}>
          <select
            value={assignment}
            onChange={(event) => setAssignment(event.currentTarget.value)}
          >
            <option value="">{t("completionPolicyNoAdditional")}</option>
            {assignments.map(({ id, title }) => (
              <option key={id} value={id}>
                {title}
              </option>
            ))}
          </select>
        </Field>
        {previousPin && <Notice>{t("completionPolicyPastCompetency")}</Notice>}
        {(framework || previousPin) && (
          <Field
            id={id + "-competency"}
            label={t("completionPolicyCompetency")}
          >
            <select
              value={competency}
              onChange={(event) => {
                setCompetency(event.currentTarget.value);
                setLevel("");
              }}
            >
              <option value="">{t("completionPolicyNoAdditional")}</option>
              {previousPin && (
                <option disabled value="previous">
                  {t("completionPolicyPastCompetency")}
                </option>
              )}
              {framework?.competencies.map(({ id, title, code }) => (
                <option key={id} value={id}>
                  {code} · {title}
                </option>
              ))}
            </select>
          </Field>
        )}
        {framework && competency && competency !== "previous" && (
          <Field
            id={id + "-level"}
            label={t("completionPolicyCompetencyLevel")}
          >
            <select
              required
              value={level}
              onChange={(event) => setLevel(event.currentTarget.value)}
            >
              <option value="">{t("completionPolicyCompetencyLevel")}</option>
              {framework.levels.map(({ id, title }) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <label>
          <input
            type="checkbox"
            checked={teacher}
            onChange={(event) => setTeacher(event.currentTarget.checked)}
          />{" "}
          {t("completionPolicyRequireLecturer")}
        </label>
        <Field
          id={id + "-target"}
          label={t("completionPolicyTarget", { zone })}
          hint={t("completionPolicyTargetHelp")}
        >
          <input
            type="datetime-local"
            value={target}
            onChange={(event) => setTarget(event.currentTarget.value)}
          />
        </Field>
        <div>
          <Button type="submit" disabled={competency === "previous"}>
            {t("completionPolicyPublish")}
          </Button>
        </div>
      </fieldset>
      {invalid && <Notice kind="error">{t("completionPolicyInvalid")}</Notice>}
      <PolicyError error={action.error} />
    </form>
  );
}

/** Publish whole policies for future enrolments; existing enrolments use the scoped action below. */
export function CourseCompletionPolicyEditor({
  actor,
  course,
  zone,
  readOnly,
}: {
  actor: string;
  course: string;
  zone: string;
  readOnly: boolean;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const query = usePolicyQuery(actor, course);
  return (
    <section aria-labelledby={id} className="panel learning-panel space-y-3">
      <h2 id={id}>{t("completionPolicyTitle")}</h2>
      {query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : !query.data ? (
        <Loading />
      ) : (
        <>
          <p>{t("completionPolicyNew")}</p>
          {query.data.head && (
            <p>
              {t("completionPolicyLatest", {
                version: query.data.head.version,
              })}
            </p>
          )}
          {!readOnly && query.data.can_manage && (
            <EditPolicy
              key={query.data.head?.version ?? 0}
              data={query.data}
              actor={actor}
              course={course}
              zone={zone}
            />
          )}
        </>
      )}
    </section>
  );
}

/** Explain the configured inputs using only the learner/staff evaluator projection. */
export function CompletionPolicySummary({
  policy,
  zone,
}: {
  policy: CompletionPinnedPolicy;
  zone: string;
}) {
  const { t, i18n } = useTranslation("learning");
  return (
    <div className="space-y-2">
      <p>{t("completionPolicyVersion", { version: policy.version })}</p>
      {policy.target_at && (
        <p>
          {t("completionPolicyTargetShow", {
            date: new Intl.DateTimeFormat(i18n.language, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: zone,
            }).format(new Date(policy.target_at)),
          })}
        </p>
      )}
      <ul className="list-disc ps-5">
        <li>
          {t("completionPolicyAttendance")}: {policy.attendance_percent}%
        </li>
        {policy.assignment && (
          <li>
            {t(
              policy.assignment.met
                ? "completionPolicyAssignmentMet"
                : policy.assignment.exception.accepted
                  ? "completionPolicyAssignmentException"
                  : "completionPolicyAssignmentPending",
              { title: policy.assignment.title },
            )}
          </li>
        )}
        {policy.competency && (
          <>
            <li>
              {t(
                policy.competency.met
                  ? "completionPolicyCompetencyMet"
                  : policy.competency.exception.accepted
                    ? "completionPolicyCompetencyException"
                    : "completionPolicyCompetencyPending",
                {
                  title: policy.competency.title,
                  level: policy.competency.minimum_level,
                },
              )}
            </li>
            {!policy.competency.met &&
              !policy.competency.exception.accepted &&
              !policy.competency.review_available && (
                <li>{t("completionPolicyCompetencyChanged")}</li>
              )}
          </>
        )}
        {policy.verification && (
          <li>
            {t(
              policy.verification.accepted
                ? "completionPolicyVerificationMet"
                : "completionPolicyVerificationPending",
            )}
          </li>
        )}
      </ul>
    </div>
  );
}

function ReviewCompletion({
  actor,
  course,
  learner,
  policyVersion,
  decision,
  requirement,
}: {
  actor: string;
  course: string;
  learner: string;
  policyVersion: number;
  decision: CompletionReviewDecision;
  requirement?: CompletionExceptionRequirement;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const [reason, setReason] = useState("");
  const action = usePolicyAction(actor, course);
  const heading =
    requirement === "assignment"
      ? "completionPolicyAssignmentExceptionTitle"
      : requirement === "competency"
        ? "completionPolicyCompetencyExceptionTitle"
        : "completionPolicyVerifyTitle";
  const buttonLabel = requirement
    ? decision.accepted
      ? "completionPolicyWithdrawException"
      : "completionPolicyGrantException"
    : decision.accepted
      ? "completionPolicyUnverify"
      : "completionPolicyVerify";
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length < 3 || action.isPending) return;
        const request = {
          p_run_id: course,
          p_expected_version: decision.revision,
        };
        const review = {
          user_id: learner,
          policy_version: policyVersion,
          accepted: !decision.accepted,
          reason: reason.trim(),
        };
        action.mutate(
          requirement
            ? {
                ...request,
                p_action: "exception",
                p_payload: { ...review, requirement },
              }
            : { ...request, p_action: "verify", p_payload: review },
          { onSuccess: () => setReason("") },
        );
      }}
    >
      <fieldset disabled={action.isPending} className="space-y-2">
        <legend>{t(heading)}</legend>
        <Field id={id} label={t("completionPolicyReason")}>
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        </Field>
        <Button type="submit" disabled={reason.trim().length < 3}>
          {t(buttonLabel)}
        </Button>
      </fieldset>
      <PolicyError error={action.error} />
    </form>
  );
}

function PinCompletion({
  actor,
  course,
  learner,
  policy,
}: {
  actor: string;
  course: string;
  learner: string;
  policy?: CompletionPinnedPolicy;
}) {
  const { t } = useTranslation("learning");
  const query = usePolicyQuery(actor, course);
  const action = usePolicyAction(actor, course);
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data?.can_manage || !query.data.head) return null;
  const { head } = query.data;
  if (head.version === policy?.version)
    return <p>{t("completionPolicyCurrent")}</p>;
  return (
    <div className="space-y-2">
      {!policy && <p>{t("completionPolicyLegacy")}</p>}
      <Button
        type="button"
        variant="secondary"
        disabled={action.isPending}
        onClick={() =>
          action.mutate({
            p_run_id: course,
            p_action: "pin",
            p_expected_version: policy?.version ?? 0,
            p_payload: { user_id: learner, policy_version: head.version },
          })
        }
      >
        {t("completionPolicyPin", { version: head.version })}
      </Button>
      <PolicyError error={action.error} />
    </div>
  );
}

/** Manage only the selected enrolment; a current certificate hides all mutation controls. */
export function CompletionEnrolmentControls({
  actor,
  course,
  learner,
  manager,
  policy,
}: {
  actor: string;
  course: string;
  learner: string;
  manager: boolean;
  policy?: CompletionPinnedPolicy;
}) {
  const { t } = useTranslation("learning");
  const exceptions = (["assignment", "competency"] as const).filter(
    (requirement) => {
      const evidence = policy?.[requirement];
      return evidence && (!evidence.met || evidence.exception.accepted);
    },
  );
  return (
    <>
      {manager && (
        <PinCompletion
          actor={actor}
          course={course}
          learner={learner}
          policy={policy}
        />
      )}
      {policy?.verification && (
        <ReviewCompletion
          key={
            learner + ":" + policy.version + ":" + policy.verification.revision
          }
          actor={actor}
          course={course}
          learner={learner}
          policyVersion={policy.version}
          decision={policy.verification}
        />
      )}
      {manager && policy && exceptions.length > 0 && (
        <details>
          <summary>{t("completionPolicyExceptions")}</summary>
          <div className="space-y-3 pt-2">
            {exceptions.map((requirement) => {
              const decision = policy[requirement]?.exception;
              return (
                decision && (
                  <ReviewCompletion
                    key={`${learner}:${policy.version}:${requirement}:${decision.revision}`}
                    actor={actor}
                    course={course}
                    learner={learner}
                    policyVersion={policy.version}
                    decision={decision}
                    requirement={requirement}
                  />
                )
              );
            })}
          </div>
        </details>
      )}
    </>
  );
}
