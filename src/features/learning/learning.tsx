import { CourseCloseout } from "./course-closeout";
import { SessionScroll } from "../../components/session-scroll";
/** Operational course workspace: scoped preparation, contacts, dates and exact shared file versions. */
import { useRequestKey } from "../../lib/request-key";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  Clock,
  Plus,
  Video,
} from "lucide-react";
import { DateTime } from "luxon";
import { useAuth } from "../auth/auth-context";
import { isParticipantOnly } from "../auth/guest-navigation";
import { useOnline } from "../../lib/online";
import { permissionsQuery, userRolesQuery } from "../../lib/queries";
import { dateTime, zonedInstant } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { contactEmailLink, contactPhoneLink } from "../profile/contact-api";
import {
  courseAction,
  type CourseWorkspace,
  type QuizQuestion,
  courseCompletionStatusKey,
  useCourseCompletionStatus,
  courseWorkspaceKey,
  courseWorkspaceQuery,
  repeatCourse,
} from "./api";
import "./i18n";
import "./learning.css";
import { CourseDestinations } from "./destinations";
import { CourseCompetencies } from "./competencies";
import { CoursePeerFeedback } from "./peer-feedback";
import { CourseXapiExport } from "./course-xapi-export";
import { CourseWelcomeContent } from "./welcome-content";
import { QuizAttempt } from "./quiz-attempt";
import { QuestionBank } from "./question-bank";
import { questionBankAction, questionBankKey } from "./question-bank-api";
import { CourseMeetingLinkEditor } from "./meeting-link";
import { CourseTeachingChecklist } from "./course-teaching-checklist";
import { courseClassroom } from "./meeting-url";
import { CourseExams } from "./exams";
import {
  ExamGrades,
  ExamSchedule,
  ExamTimeAllowance,
  LearnerExam,
  PublishedExamResults,
} from "./timed-exam";
import { timedExamQuery } from "./timed-exam-api";
import { AttendancePanel } from "./attendance";
import { CourseParticipationReport } from "./course-participation-report";
import { AcademyInstructors } from "./academy-instructors";
import { AcademyCoursePublication } from "./academy-publication";
import { AcademyCompanyInvitation } from "./academy-company-invitation";
import { CourseEnrolmentsPanel, CourseWithdrawal } from "./enrolments";
import { CourseChat } from "./course-chat";
import { CourseClasses } from "./course-classes";
import { DownloadButton, Resources } from "./resources";
import { CourseAssignments } from "./course-assignments";
import { CourseSubmissions } from "./course-submissions";
import { CourseEvaluations } from "./course-evaluations";
import { CourseAuthoring } from "./course-authoring";
import { CourseGradebook } from "./course-gradebook";
import { CoursePortfolio } from "./portfolio";
import {
  CompletionRequirements,
  StaffCompletionRequirements,
} from "./course-completion-status";

declare const __PORTAL_INTERNAL_EDITION__: boolean;

const CourseOfferForm = __PORTAL_INTERNAL_EDITION__
  ? lazy(() =>
      import("../admin/admin").then((module) => ({
        default: module.CourseOfferForm,
      })),
    )
  : null;

type WorkProps = { course: CourseWorkspace; actor: string };
type ActivityProps = WorkProps & { academy?: "active" | "grace" };

/** Confirms an authorized course mutation before invalidating only this account’s workspace. */
function useAction(course: string, actor: string, academy = false) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      payload = {},
      version = 0,
    }: {
      action: string;
      payload?: Record<string, unknown>;
      version?: number;
    }) =>
      academy
        ? courseAction(course, action, payload, version, true)
        : courseAction(course, action, payload, version),
    onSuccess: async (_, { action }) => {
      await client.invalidateQueries({
        queryKey: courseWorkspaceKey(actor, course),
      });
      if (
        action === "quiz_attempt" ||
        action === "quiz_config" ||
        action === "completion_issue" ||
        action === "completion_revoke"
      ) {
        await client.invalidateQueries({
          queryKey: courseCompletionStatusKey(actor, course),
        });
      }
      if (action === "contact_select") {
        await Promise.all(
          ["job-briefing", "job-lifecycle", "teaching-day"].map((key) =>
            client.invalidateQueries({ queryKey: [key, actor] }),
          ),
        );
      }
    },
  });
}

/** Presents confirmed mutation status without translating authored course content. */
function Result({ error, success }: { error: boolean; success?: boolean }) {
  const { t } = useTranslation("learning");
  return error ? (
    <Notice kind="error">{t("saveError")}</Notice>
  ) : success ? (
    <Notice>{t("saved")}</Notice>
  ) : null;
}

/** Shows client-visible shared preparation and server-confirmed staff checklist changes. */
function Preparation({ course, actor, academy }: ActivityProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor, Boolean(academy));
  const [label, setLabel] = useState("");
  const [visible, setVisible] = useState(true);
  const request = useRequestKey();
  return (
    <section
      id="teaching-preparation"
      className="panel learning-panel"
      aria-label={t("preparation")}
    >
      <h2>{t("preparation")}</h2>
      <p>{t("preparationHelp")}</p>
      <p className="learning-progress">
        {t("preparationCount", {
          done: course.preparation.filter((x) => x.done).length,
          total: course.preparation.length,
        })}
      </p>
      <ul className="learning-checklist">
        {course.preparation.map((item) => (
          <li key={item.id}>
            <label>
              <input
                type="checkbox"
                checked={item.done}
                disabled={
                  !online ||
                  academy === "grace" ||
                  !course.access.staff ||
                  save.isPending
                }
                onChange={(event) =>
                  save.mutate({
                    action: "preparation_toggle",
                    payload: { id: item.id, done: event.target.checked },
                    version: item.version,
                  })
                }
              />
              {item.label}
            </label>
          </li>
        ))}
      </ul>
      {course.access.manager && academy !== "grace" && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const values = { label: label.trim(), client_visible: visible };
            save.mutate(
              {
                action: "preparation_create",
                payload: academy
                  ? {
                      ...values,
                      request_id: request.forInput(JSON.stringify(values)),
                    }
                  : values,
              },
              {
                onSuccess: () => {
                  setLabel("");
                  request.clear();
                },
              },
            );
          }}
        >
          <Field id="preparation-label" label={t("newPreparation")}>
            <input
              id="preparation-label"
              value={label}
              maxLength={300}
              required
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={visible}
              onChange={(event) => setVisible(event.target.checked)}
            />
            {t("clientVisible")}
          </label>
          <Button disabled={!online || save.isPending || !label.trim()}>
            {t("add")}
          </Button>
        </form>
      )}
      <Result error={save.isError} />
    </section>
  );
}

/** Save only the current caller's course notebook. The server owns its revision. */
function AcademyNotebook({ course, actor, academy }: ActivityProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const note = course.notebook;
  const [body, setBody] = useState(note?.body ?? "");
  const save = useAction(course.id, actor, true);
  return (
    <section className="panel learning-panel" aria-label={t("notebook")}>
      <h2>{t("notebook")}</h2>
      <p>{t("notebookHelp")}</p>
      {academy === "grace" ? (
        <p className="learning-pre">
          {note?.body || t("academyNotebookEmpty")}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              action: "notebook",
              payload: { body },
              version: note?.version ?? 0,
            });
          }}
        >
          <Field id="academy-notebook-body" label={t("academyNotebookBody")}>
            <textarea
              rows={5}
              maxLength={12000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </Field>
          <Button
            type="submit"
            disabled={!online || save.isPending || body === (note?.body ?? "")}
          >
            {t("academySaveNotebook")}
          </Button>
          <Result error={save.isError} success={save.isSuccess} />
        </form>
      )}
    </section>
  );
}

/** Lets a manager explicitly select a same-organisation contact for this course. */
function CourseContact({
  course,
  actor,
  url,
  canEditContact = course.access.manager,
  canEditMeeting = course.meeting_link?.can_edit === true,
}: WorkProps & {
  url: string | null;
  canEditContact?: boolean;
  canEditMeeting?: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [draftContact, setDraftContact] = useState<{
    id: string;
    version: number;
  }>();
  const selected = draftContact?.id ?? course.selected_contact_id ?? "";
  const [copyStatus, setCopyStatus] = useState<{
    url: string;
    status: "success" | "error";
  } | null>(null);
  const email = course.contact?.email
    ? contactEmailLink(course.contact.email)
    : null;
  const phone = course.contact?.phone
    ? contactPhoneLink(course.contact.phone)
    : null;
  return (
    <section className="panel learning-panel" aria-label={t("courseInfo")}>
      <h2>{t("courseInfo")}</h2>
      {url ? (
        <div className="form-actions">
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t("teachingLink")}
          </a>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              setCopyStatus(null);
              try {
                await navigator.clipboard.writeText(url);
                setCopyStatus({ url, status: "success" });
              } catch {
                setCopyStatus({ url, status: "error" });
              }
            }}
          >
            {t("copyTeachingLink")}
          </Button>
          {copyStatus?.url === url && (
            <span role={copyStatus.status === "error" ? "alert" : "status"}>
              {t(
                copyStatus.status === "success"
                  ? "teachingLinkCopied"
                  : "teachingLinkCopyFailed",
              )}
              {copyStatus.status === "error" && <code> {url}</code>}
            </span>
          )}
        </div>
      ) : (
        <p>{course.venue}</p>
      )}
      {canEditMeeting && course.meeting_link && (
        <CourseMeetingLinkEditor
          actor={actor}
          courseId={course.id}
          current={course.meeting_link}
        />
      )}
      <h3>{t("contact")}</h3>
      {course.contact ? (
        <>
          <p>{course.contact.name}</p>
          <p>
            {course.contact.email} · {course.contact.phone}
          </p>
          <div className="form-actions">
            {email && <a href={email}>{t("writeEmail")}</a>}
            {phone && <a href={phone}>{t("call")}</a>}
          </div>
        </>
      ) : (
        <p>{t("noContact")}</p>
      )}
      {canEditContact && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(
              {
                action: "contact_select",
                payload: { contact_id: selected || null },
                version: draftContact?.version ?? course.settings_version,
              },
              { onSuccess: () => setDraftContact(undefined) },
            );
          }}
        >
          <Field id="course-contact" label={t("selectContact")}>
            <select
              id="course-contact"
              value={selected}
              onChange={(event) =>
                setDraftContact({
                  id: event.target.value,
                  version: draftContact?.version ?? course.settings_version,
                })
              }
            >
              <option value="">{t("defaultCourseContact")}</option>
              {course.contact_options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="muted">{t("contactHelp")}</p>
          <Button disabled={!online || save.isPending || !draftContact}>
            {t("save")}
          </Button>
        </form>
      )}
      <Result error={save.isError} success={save.isSuccess} />
    </section>
  );
}

/** Discloses server-held identity and the minimum-three aggregate policy accurately. */
function Feedback({ course, actor, academy }: ActivityProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor, Boolean(academy));
  const [rating, setRating] = useState(String(course.feedback?.rating ?? 5));
  const [comment, setComment] = useState(course.feedback?.comment ?? "");
  return (
    <section className="panel learning-panel" aria-label={t("feedback")}>
      <h2>{t("feedback")}</h2>
      <p>{t("feedbackPolicy")}</p>
      {academy === "grace" && course.feedback && (
        <>
          <p>{course.feedback.rating}/5</p>
          <p>{course.feedback.comment}</p>
        </>
      )}
      {academy !== "grace" &&
        (course.access.learner || course.access.client) &&
        course.ended && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate({
                action: "feedback",
                payload: { rating: Number(rating), comment },
                version: course.feedback?.version ?? 0,
              });
            }}
          >
            <Field id="course-feedback-rating" label={t("rating")}>
              <select
                id="course-feedback-rating"
                value={rating}
                onChange={(event) => setRating(event.target.value)}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option value={n} key={n}>
                    {n}/5
                  </option>
                ))}
              </select>
            </Field>
            <Field id="course-feedback-comment" label={t("comment")}>
              <textarea
                id="course-feedback-comment"
                maxLength={2000}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </Field>
            <Button disabled={!online || save.isPending}>
              {t("saveFeedback")}
            </Button>
            <Result error={save.isError} success={save.isSuccess} />
          </form>
        )}
      {course.feedback_summary && (
        <>
          <p>{t("feedbackCount", { count: course.feedback_summary.count })}</p>
          {course.feedback_summary.average === null ? (
            <p>{t("feedbackThreshold")}</p>
          ) : (
            <>
              <strong>{course.feedback_summary.average}/5</strong>
              <ul>
                {course.feedback_summary.comments?.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
/** Publishes immutable quiz revisions rather than editing already accepted learner attempts. */
function QuizEditor({ course, actor, academy }: ActivityProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor, Boolean(academy));
  const [shuffle, setShuffle] = useState(false);
  const cache = useQueryClient();
  const saveFromBank = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      questionBankAction(
        course.id,
        "configure",
        payload,
        course.quiz?.version ?? 0,
      ),
    onSuccess: () =>
      cache.invalidateQueries({
        queryKey: courseWorkspaceKey(actor, course.id),
      }),
  });
  const pending = save.isPending || saveFromBank.isPending;
  const conflict =
    typeof saveFromBank.error === "object" &&
    saveFromBank.error !== null &&
    "code" in saveFromBank.error &&
    saveFromBank.error.code === "PT409";
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    course.quiz?.questions ?? [{ prompt: "", options: ["", ""], correct: 0 }],
  );
  const [pass, setPass] = useState(course.quiz?.pass_percent ?? 80);
  const [attempts, setAttempts] = useState(course.quiz?.max_attempts ?? 3);
  const [published, setPublished] = useState(course.quiz?.published ?? false);
  function update(index: number, patch: Partial<QuizQuestion>) {
    setQuestions((items) =>
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  }
  const selected = new Set(
    questions.flatMap((question) =>
      question.source ? [question.source.question_id] : [],
    ),
  );
  const hasOnlyPlaceholder =
    questions.length === 1 &&
    !questions[0].source &&
    !questions[0].prompt &&
    questions[0].options.every((option) => !option);
  return (
    <>
      {course.lms_enabled && (
        <QuestionBank
          actor={actor}
          courseId={course.id}
          selected={selected}
          canSelect={!pending && questions.length < 20}
          onSelect={(question) => {
            const selectedQuestion = {
              ...question.content,
              source: { question_id: question.id, revision: question.revision },
            };
            setQuestions((items) =>
              hasOnlyPlaceholder
                ? [selectedQuestion]
                : [...items, selectedQuestion],
            );
          }}
        />
      )}
      <form
        className="learning-quiz-editor"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || !online) return;
          const settings = {
            pass_percent: pass,
            max_attempts: attempts,
            published,
          };
          if (selected.size || shuffle) {
            save.reset();
            saveFromBank.mutate({
              ...settings,
              entries: questions.map((question) => question.source ?? question),
              shuffle,
            });
          } else {
            saveFromBank.reset();
            save.mutate({
              action: "quiz_config",
              payload: { ...settings, questions },
              version: course.quiz?.version ?? 0,
            });
          }
        }}
      >
        {questions.map((question, index) => (
          <fieldset key={index} disabled={pending}>
            <legend>{t("quizQuestion", { number: index + 1 })}</legend>
            {question.source ? (
              <>
                <p>{question.prompt}</p>
                <ol className="list-decimal ps-6">
                  {question.options.map((option, position) => (
                    <li key={position}>
                      {position === question.correct ? (
                        <strong>{option}</strong>
                      ) : (
                        option
                      )}
                    </li>
                  ))}
                </ol>
                <p>
                  {t("correctAnswer")}:{" "}
                  {question.options[question.correct ?? 0]}
                </p>
                <p>
                  {t("questionBankSource", {
                    revision: question.source.revision,
                  })}
                </p>
              </>
            ) : (
              <>
                <label>
                  {t("prompt")}
                  <input
                    required
                    maxLength={500}
                    value={question.prompt}
                    onChange={(event) =>
                      update(index, { prompt: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t("options")}
                  <textarea
                    required
                    value={question.options.join("\n")}
                    onChange={(event) =>
                      update(index, { options: event.target.value.split("\n") })
                    }
                  />
                </label>
                <label>
                  {t("correctAnswer")}
                  <select
                    value={question.correct ?? 0}
                    onChange={(event) =>
                      update(index, { correct: Number(event.target.value) })
                    }
                  >
                    {question.options.map((option, i) => (
                      <option value={i} key={i}>
                        {i + 1}. {option}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {(questions.length > 1 || question.source) && (
              <Button
                type="button"
                variant="ghost"
                onClick={() =>
                  setQuestions((items) =>
                    items.length === 1
                      ? [{ prompt: "", options: ["", ""], correct: 0 }]
                      : items.filter((_, i) => i !== index),
                  )
                }
              >
                {t("removeQuestion")}
              </Button>
            )}
          </fieldset>
        ))}
        <Button
          type="button"
          variant="secondary"
          disabled={pending || questions.length >= 20}
          onClick={() =>
            setQuestions((items) => [
              ...items,
              { prompt: "", options: ["", ""], correct: 0 },
            ])
          }
        >
          <Plus size={16} />
          {t("addQuestion")}
        </Button>
        <label>
          {t("passPercent")}
          <input
            type="number"
            min={50}
            max={100}
            value={pass}
            onChange={(event) => setPass(Number(event.target.value))}
          />
        </label>
        <label>
          {t("maxAttempts")}
          <input
            type="number"
            min={1}
            max={10}
            value={attempts}
            onChange={(event) => setAttempts(Number(event.target.value))}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
          />
          {t("publishQuiz")}
        </label>
        {course.lms_enabled && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={shuffle}
              onChange={(event) => setShuffle(event.target.checked)}
            />
            {t("questionBankShuffle")}
          </label>
        )}
        <Button disabled={!online || pending}>{t("saveQuiz")}</Button>
        {conflict && (
          <Notice kind="error">
            {t("questionBankConflict")}
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                saveFromBank.reset();
                void cache.invalidateQueries({
                  queryKey: courseWorkspaceKey(actor, course.id),
                });
                void cache.invalidateQueries({
                  queryKey: questionBankKey(actor, course.id),
                });
              }}
            >
              {t("questionBankReload")}
            </Button>
          </Notice>
        )}
        <Result
          error={save.isError || (saveFromBank.isError && !conflict)}
          success={save.isSuccess || saveFromBank.isSuccess}
        />
      </form>
    </>
  );
}
/** Chooses authoring or attempt controls from the authorized course DTO. */
function Quiz({ course, actor, academy }: ActivityProps) {
  const { t } = useTranslation("learning");
  return (
    <section className="panel learning-panel" aria-label={t("quiz")}>
      <h2>{t("quiz")}</h2>
      {academy === "grace" ? (
        course.quiz ? (
          <div>
            <ol>
              {course.quiz.questions.map((question, index) => (
                <li key={index}>{question.prompt}</li>
              ))}
            </ol>
            {course.quiz.last_score !== null && (
              <p>{t("score", { score: course.quiz.last_score })}</p>
            )}
          </div>
        ) : (
          <p>{t("noQuiz")}</p>
        )
      ) : course.access.staff ? (
        <QuizEditor
          key={course.quiz?.version ?? 0}
          course={course}
          actor={actor}
          academy={academy}
        />
      ) : course.quiz?.published && course.access.learner ? (
        <QuizAttempt
          key={`${course.quiz.version}:${course.quiz.attempts}`}
          course={course}
          actor={actor}
          academy={academy === "active"}
        />
      ) : (
        <p>{t("noQuiz")}</p>
      )}
    </section>
  );
}
/** Requests completion only after server attendance and current-quiz eligibility checks. */
function Completion({
  course,
  actor,
  academy,
  active,
}: ActivityProps & { active: boolean }) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor, Boolean(academy));
  const status = useCourseCompletionStatus(
    course,
    actor,
    null,
    active && !course.completion,
  );
  return (
    <section className="panel learning-panel" aria-label={t("completion")}>
      <h2>{t("completion")}</h2>
      <p>{t("completionHelp")}</p>
      {course.completion ? (
        <>
          <CheckCircle2 aria-hidden="true" />
          <DownloadButton
            kind="completion"
            id={course.completion.id}
            name="course-completion.pdf"
          />
        </>
      ) : active ? (
        <>
          <CompletionRequirements query={status} zone={course.time_zone} />
          {academy !== "grace" && (
            <Button
              disabled={
                !online ||
                save.isPending ||
                status.isError ||
                status.data?.state !== "ready"
              }
              onClick={() => save.mutate({ action: "completion_issue" })}
            >
              {t("issueCompletion")}
            </Button>
          )}
        </>
      ) : null}
      <Result error={save.isError} />
    </section>
  );
}

/** List the course's issued completion documents and confirm an authorised revocation. */
function AcademyCompletionRegister({ course, actor, academy }: ActivityProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor, true);
  const [selected, setSelected] = useState<{ id: string; name: string }>();
  const [reason, setReason] = useState("");
  const issued = course.roster.flatMap(({ user_id, name, completion_id }) =>
    completion_id ? [{ user_id, name, id: completion_id }] : [],
  );
  if (!issued.length && !selected) return null;
  return (
    <section
      className="panel learning-panel"
      aria-label={t("courseCompletionDocuments")}
    >
      <h2>{t("courseCompletionDocuments")}</h2>
      <ul className="course-enrolment-roster">
        {issued.map(({ user_id, name, id }) => (
          <li key={user_id}>
            <strong>{name}</strong>
            <div className="course-enrolment-actions">
              <DownloadButton
                kind="completion"
                id={id}
                name="course-completion.pdf"
                label={t("downloadCompletionFor", { name })}
              />
              {academy === "active" && course.access.staff && (
                <Button
                  variant="secondary"
                  disabled={!online || save.isPending}
                  aria-label={t("revokeCompletionFor", { name })}
                  onClick={() => {
                    setSelected({ id, name });
                    setReason("");
                    save.reset();
                  }}
                >
                  {t("revokeCompletion")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <Dialog
        open={academy === "active" && Boolean(selected)}
        title={t("revokeCompletion")}
        description={t("revokeCompletionFor", { name: selected?.name })}
        onOpenChange={(open) =>
          !open && !save.isPending && setSelected(undefined)
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!selected || reason.trim().length < 3) return;
            save.mutate(
              {
                action: "completion_revoke",
                payload: { id: selected.id, reason: reason.trim() },
              },
              {
                onSuccess: () => setSelected(undefined),
              },
            );
          }}
        >
          <Field id="academy-completion-reason" label={t("revocationReason")}>
            <textarea
              value={reason}
              required
              minLength={3}
              maxLength={500}
              disabled={save.isPending}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <Result error={save.isError} />
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => setSelected(undefined)}
            >
              {t("enrolmentCancel")}
            </Button>
            <Button
              type="submit"
              disabled={!online || save.isPending || reason.trim().length < 3}
            >
              {t("enrolmentConfirm")}
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

/** Creates a new future request from the client’s delivered course without copying private learner data. */
function RepeatBooking({ course }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const request = course.repeat_request!;
  const retry = useRequestKey();
  const [sessions, setSessions] = useState(() => {
    const first = DateTime.fromISO(request.sessions[0].starts_at, {
      zone: course.time_zone,
    });
    const shift = Math.ceil(
      DateTime.now()
        .setZone(course.time_zone)
        .plus({ days: 7 })
        .diff(first, "days").days,
    );
    return request.sessions.map((item) => ({
      starts_at: DateTime.fromISO(item.starts_at, { zone: course.time_zone })
        .plus({ days: shift })
        .toFormat("yyyy-MM-dd'T'HH:mm"),
      ends_at: DateTime.fromISO(item.ends_at, { zone: course.time_zone })
        .plus({ days: shift })
        .toFormat("yyyy-MM-dd'T'HH:mm"),
    }));
  });
  const save = useMutation({
    mutationFn: async () => {
      const values = sessions.map((item) => {
        const starts_at = zonedInstant(item.starts_at, course.time_zone),
          ends_at = zonedInstant(item.ends_at, course.time_zone);
        if (!starts_at || !ends_at || ends_at <= starts_at)
          throw new Error("invalid_dates");
        return { starts_at, ends_at };
      });
      const signature = JSON.stringify(values);
      const retryId = retry.forInput(signature);
      return repeatCourse(request.id, values, retryId);
    },
  });
  return (
    <section className="panel learning-panel">
      <h2>{t("repeatBooking")}</h2>
      <p>{t("repeatHelp")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        {sessions.map((session, index) => (
          <fieldset key={index}>
            <legend>
              {t("sessionNumber", { number: index + 1 })} · {course.time_zone}
            </legend>
            {(["starts_at", "ends_at"] as const).map((key) => (
              <label key={key}>
                {t(key)}
                <input
                  type="datetime-local"
                  required
                  value={session[key]}
                  onChange={(event) =>
                    setSessions((items) =>
                      items.map((item, n) =>
                        n === index
                          ? { ...item, [key]: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </fieldset>
        ))}
        <Button disabled={!online || save.isPending}>
          {t("requestRepeat")}
        </Button>
        <Result error={save.isError} success={save.isSuccess} />
        {save.isSuccess && <Link to="/client">{t("viewRequest")}</Link>}
      </form>
    </section>
  );
}

/** Keep non-Premium course facts separate from learning files and interactions. */
function CourseBasics({ course }: { course: CourseWorkspace }) {
  const { t, i18n } = useTranslation("learning");
  return (
    <section className="panel learning-panel">
      <h2>{t("courseOverview")}</h2>
      <p className="preserve-text">{course.description}</p>
      <p className="preserve-text">{course.syllabus}</p>
      {course.delivery_type !== "online" && course.venue && (
        <p>{course.venue}</p>
      )}
      <SessionScroll label={i18n.t("translation:sessions")}>
        <ol className="course-workspace-sessions">
          {course.sessions.map((session) => (
            <li key={session.id}>
              <strong>
                {dateTime(session.starts_at, i18n.language, course.time_zone)}
              </strong>
              <span>
                {dateTime(session.ends_at, i18n.language, course.time_zone)}
              </span>
            </li>
          ))}
        </ol>
      </SessionScroll>
    </section>
  );
}

/** Keep sections mounted so mobile navigation preserves forms and draft state. */
function CourseWorkspaceLayout({
  course,
  actor,
  now,
  refreshing,
  refresh,
  academy,
}: WorkProps & {
  now: number;
  refreshing: boolean;
  refresh: () => void;
  academy?: "active" | "grace";
}) {
  const { t, i18n } = useTranslation("learning");
  const location = useLocation();
  const navigate = useNavigate();
  const learner = course.access.learner;
  const editor = course.access.staff || course.access.client;
  const canEdit = academy !== "grace";
  const offerPermissions = useQuery({
    ...permissionsQuery(actor),
    enabled: __PORTAL_INTERNAL_EDITION__ && !academy && course.access.manager,
  });
  const canPrepareOffer =
    __PORTAL_INTERNAL_EDITION__ &&
    !academy &&
    course.access.manager &&
    offerPermissions.data?.includes("jobs.manage") &&
    offerPermissions.data.includes("courses.manage");
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerTrigger, setOfferTrigger] = useState<HTMLButtonElement | null>(
    null,
  );
  const queryClient = useQueryClient();
  const online = useOnline();
  const examState = useQuery({
    ...timedExamQuery(actor, course.id),
    enabled: course.lms_enabled && online,
  });
  const exam = examState.isError ? null : examState.data;
  const examWindow = exam?.open;
  useEffect(() => {
    if (online && learner) {
      void queryClient.invalidateQueries({
        queryKey: courseWorkspaceKey(actor, course.id),
      });
    }
  }, [actor, course.id, examWindow, learner, online, queryClient]);
  const examVisible = Boolean(
    course.exams &&
    (exam ||
      course.exams.required ||
      course.exams.can_edit ||
      (academy && editor)),
  );
  const hasActivities = learner || editor;
  const hasSubmissions = course.lms_enabled && hasActivities;
  const hasEvaluations = course.lms_enabled && course.ended && hasActivities;
  const hasExamGrades = Boolean(
    exam?.required && (exam.can_grade || exam.published || exam.rows.length),
  );
  const hasRatingSection = hasEvaluations || hasExamGrades;
  const hasRegister = editor && course.sessions.length > 0;
  const hasCloseout =
    __PORTAL_INTERNAL_EDITION__ &&
    !academy &&
    course.ended &&
    course.lms_enabled &&
    course.access.manager;
  const canManageEnrolments =
    canEdit && (course.access.manager || course.access.client);
  const hasCurriculum =
    course.lms_enabled && (learner || (canEdit && course.access.staff));
  const hasGradebook = course.lms_enabled && (learner || course.access.staff);
  const hasPortfolioShares = course.lms_enabled && course.access.teacher;
  const sections = [
    { id: "course-overview", label: t("courseOverview") },
    ...(hasCurriculum
      ? [{ id: "course-curriculum", label: t("curriculum") }]
      : []),
    { id: "course-materials", label: t("workspaceMaterials") },
    ...(hasSubmissions
      ? [{ id: "course-submissions", label: t("submissions") }]
      : []),
    ...(examVisible ? [{ id: "course-exam", label: t("workspaceExam") }] : []),
    ...(canManageEnrolments
      ? [{ id: "course-enrolments", label: t("workspaceParticipants") }]
      : []),
    ...(hasRegister
      ? [{ id: "course-register", label: t("workspaceRegister") }]
      : []),
    { id: "course-chat", label: t("courseChat") },
    ...(hasCloseout
      ? [{ id: "course-closeout", label: t("courseCloseout") }]
      : []),
    ...(hasActivities
      ? [{ id: "course-learning", label: t("workspaceActivities") }]
      : []),
    ...(hasRatingSection
      ? [{ id: "course-evaluations", label: t("evaluations") }]
      : []),
    ...(hasPortfolioShares
      ? [{ id: "course-portfolio", label: t("portfolioShared") }]
      : []),
    ...(hasGradebook
      ? [{ id: "course-gradebook", label: t("gradebookTitle") }]
      : []),
  ];
  const currentSection =
    sections.find(({ id }) => location.hash === "#" + id)?.id ??
    "course-overview";
  const sectionClass = (id: string) =>
    id === currentSection
      ? "course-room-section"
      : "course-room-section course-room-section-inactive";
  const next = course.sessions.find(
    (session) => Date.parse(session.ends_at) > now,
  );
  const classroom = courseClassroom(course);
  const pageTarget = academy || learner ? "/learning" : "/courses";
  const showManagementActions =
    __PORTAL_INTERNAL_EDITION__ && !academy && !learner;
  const showReadiness =
    __PORTAL_INTERNAL_EDITION__ &&
    !academy &&
    (course.access.manager || course.access.teacher);

  // React Router may resolve a deep link before the scoped course data
  // loads. Apply that hash when its destination first becomes available.
  useEffect(() => {
    if (location.hash !== "#" + currentSection) return;
    const mobile = window.matchMedia?.("(max-width: 850px)").matches;
    const target = document.getElementById(
      mobile ? "course-room-navigation" : currentSection,
    );
    target?.scrollIntoView?.({ block: "start" });
  }, [currentSection, location.hash]);

  return (
    <div className="course-room">
      <div className="course-room-toolbar">
        <Button asChild variant="ghost">
          <Link to={pageTarget}>
            <ChevronLeft size={18} aria-hidden="true" />
            {t("back")}
          </Link>
        </Button>
        <Button variant="secondary" onClick={refresh} disabled={refreshing}>
          {t("refresh")}
        </Button>
      </div>
      <header className="course-room-header">
        <div className="course-room-title">
          <h1>{course.title}</h1>
          <div className="course-room-meta">
            <span>
              <Clock size={17} aria-hidden="true" />
              {course.time_zone}
            </span>
            <span>
              {t(
                course.delivery_type === "online"
                  ? "workspaceOnline"
                  : "workspaceOnSite",
              )}
            </span>
          </div>
        </div>
        {next && (
          <div className="course-room-next">
            <CalendarDays size={22} aria-hidden="true" />
            <div>
              <span>
                {t(
                  Date.parse(next.starts_at) <= now
                    ? "workspaceInSession"
                    : "workspaceNextSession",
                )}
              </span>
              <strong>
                {dateTime(next.starts_at, i18n.language, course.time_zone)}
              </strong>
            </div>
          </div>
        )}
        {classroom && learner && !course.ended && (
          <Button asChild>
            <a href={classroom} target="_blank" rel="noopener noreferrer">
              <Video size={18} aria-hidden="true" />
              {t("joinClassroom")}
            </a>
          </Button>
        )}
      </header>
      {((showManagementActions && (canPrepareOffer || hasRegister || editor)) ||
        showReadiness) && (
        <div className="page-actions course-room-actions">
          {showManagementActions && canPrepareOffer && (
            <Button
              onClick={(event) => {
                setOfferTrigger(event.currentTarget);
                setOfferOpen(true);
              }}
            >
              {t("prepareOffer")}
            </Button>
          )}
          {showManagementActions && hasRegister && (
            <Button asChild variant="secondary">
              <Link to="#course-register">{t("workspaceRegister")}</Link>
            </Button>
          )}
          {showManagementActions && editor && (
            <Button asChild variant="secondary">
              <Link to={`/courses?run=${course.id}`}>{t("manageCourse")}</Link>
            </Button>
          )}
          {showReadiness && (
            <Button asChild variant="secondary">
              <Link to={`/readiness/${course.id}`}>{t("courseReadiness")}</Link>
            </Button>
          )}
        </div>
      )}
      {CourseOfferForm && canPrepareOffer && (
        <Dialog
          open={offerOpen}
          onOpenChange={setOfferOpen}
          returnFocusTo={offerTrigger}
          title={t("prepareOffer")}
          description={t("prepareOfferHint")}
        >
          <Suspense fallback={<Loading />}>
            <CourseOfferForm runId={course.id} />
          </Suspense>
        </Dialog>
      )}
      <div className="course-room-layout">
        <nav
          id="course-room-navigation"
          className="course-room-navigation"
          aria-label={t("workspaceNavigation")}
        >
          <div className="course-room-mobile-navigation">
            <Field
              id="course-room-section-select"
              label={t("workspaceSection")}
            >
              <select
                id="course-room-section-select"
                value={currentSection}
                onChange={(event) =>
                  void navigate({
                    pathname: location.pathname,
                    search: location.search,
                    hash: "#" + event.target.value,
                  })
                }
              >
                {sections.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {currentSection === "course-overview" &&
              (learner || (hasRegister && !showManagementActions)) && (
                <Link
                  to={{
                    search: location.search,
                    hash: learner ? "#course-materials" : "#course-register",
                  }}
                >
                  {t(learner ? "workspaceMaterials" : "workspaceRegister")}
                </Link>
              )}
          </div>
          <ul>
            {sections.map(({ id, label }) => (
              <li key={id}>
                <Link
                  to={{
                    pathname: location.pathname,
                    search: location.search,
                    hash: "#" + id,
                  }}
                  aria-current={id === currentSection ? "location" : undefined}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="course-room-content">
          <div className={sectionClass("course-overview")} id="course-overview">
            {course.access.teacher && (
              <CourseTeachingChecklist course={course} classroom={classroom} />
            )}
            <CourseBasics course={course} />
            <CourseClasses
              key={`classes:${actor}:${course.id}`}
              actor={actor}
              courseId={course.id}
              editor={course.access.manager || course.access.client}
            />
            <CourseWelcomeContent
              key={`welcome:${actor}:${course.id}`}
              actor={actor}
              courseId={course.id}
              zone={course.time_zone}
              canEdit={canEdit && editor}
              canProtect={course.access.manager || course.access.client}
              resources={course.resources}
            />
            {__PORTAL_INTERNAL_EDITION__ && !academy && (
              <CourseDestinations
                actor={actor}
                courseId={course.id}
                learner={learner}
              />
            )}
            {academy === "active" && course.access.manager && (
              <AcademyInstructors courseId={course.id} actor={actor} />
            )}
            {academy && course.access.manager && (
              <AcademyCoursePublication
                courseId={course.id}
                actor={actor}
                readOnly={academy === "grace"}
              />
            )}
            <CourseContact
              key={`${actor}:${course.id}`}
              course={course}
              actor={actor}
              url={classroom}
              canEditContact={
                !academy &&
                course.access.manager &&
                course.lms_enabled !== false
              }
              canEditMeeting={canEdit && course.meeting_link?.can_edit === true}
            />
            {editor && (
              <Preparation course={course} actor={actor} academy={academy} />
            )}
            {academy && editor && !hasRegister && (
              <CourseParticipationReport key={course.id} courseId={course.id} />
            )}
            {learner && (
              <CourseWithdrawal
                key={academy ?? "internal"}
                course={course}
                actor={actor}
                academy={academy}
              />
            )}
          </div>
          {hasCurriculum && (
            <div
              className={sectionClass("course-curriculum")}
              id="course-curriculum"
            >
              <CourseAuthoring
                key={`curriculum:${actor}:${course.id}`}
                actor={actor}
                courseId={course.id}
                editable={canEdit && course.access.staff}
                manager={course.access.manager}
                roster={course.roster}
                resources={course.resources}
                zone={course.time_zone}
              />
            </div>
          )}
          {hasPortfolioShares && currentSection === "course-portfolio" && (
            <div
              id="course-portfolio"
              className={sectionClass("course-portfolio")}
            >
              <CoursePortfolio
                key={course.id}
                actor={actor}
                course={course.id}
              />
            </div>
          )}
          {hasGradebook && (
            <div
              className={sectionClass("course-gradebook")}
              id="course-gradebook"
            >
              <CourseGradebook
                key={`${actor}:${course.id}:${course.access.staff}`}
                actor={actor}
                courseId={course.id}
                active={currentSection === "course-gradebook"}
                academy={Boolean(academy)}
                staff={course.access.staff}
                readOnly={!canEdit}
              />
            </div>
          )}
          <div
            className={sectionClass("course-materials")}
            id="course-materials"
          >
            <Resources
              course={course}
              actor={actor}
              readOnly={Boolean(academy)}
              academy={academy === "active"}
              academyCanUpload={
                academy === "active" &&
                (course.access.manager ||
                  course.access.teacher ||
                  course.access.client)
              }
            />
          </div>
          {hasSubmissions && (
            <div
              className={sectionClass("course-submissions")}
              id="course-submissions"
            >
              {currentSection === "course-submissions" &&
                (learner || course.access.staff) && (
                  <CourseAssignments
                    key={`${actor}:${course.id}:assignments`}
                    actor={actor}
                    course={course.id}
                    zone={course.time_zone}
                    staff={course.access.staff}
                    participants={course.roster}
                    readOnly={academy === "grace"}
                  />
                )}
              <CourseSubmissions
                key={`${actor}:${course.id}`}
                actor={actor}
                courseId={course.id}
                readOnly={academy === "grace"}
              />
            </div>
          )}
          {examVisible && (
            <div className={sectionClass("course-exam")} id="course-exam">
              {course.exams.can_edit && canEdit && (
                <ExamSchedule
                  key={exam?.version ?? 0}
                  actor={actor}
                  run={course.id}
                  zone={course.time_zone}
                  exam={exam}
                />
              )}
              {canEdit && exam?.can_set_extra_time && (
                <ExamTimeAllowance actor={actor} run={course.id} exam={exam} />
              )}
              {learner && exam?.required && (
                <LearnerExam
                  key={course.id}
                  actor={actor}
                  run={course.id}
                  zone={course.time_zone}
                  exam={exam}
                  now={now}
                />
              )}
              <CourseExams
                key={`${actor}:${course.id}:${course.exams.version ?? course.exams.required}`}
                course={course}
                examTitle={exam?.title}
                examPaperOpen={exam?.open}
                actor={actor}
                academy={academy}
              />
            </div>
          )}
          {canManageEnrolments && (
            <div
              className={sectionClass("course-enrolments")}
              id="course-enrolments"
            >
              {academy === "active" &&
                course.lms_enabled &&
                course.access.client && (
                  <AcademyCompanyInvitation
                    key={`${actor}:${course.id}`}
                    courseId={course.id}
                  />
                )}
              <CourseEnrolmentsPanel
                course={course}
                actor={actor}
                academy={Boolean(academy)}
              />
            </div>
          )}
          {hasRegister && (
            <div
              className={sectionClass("course-register")}
              id="course-register"
            >
              <AttendancePanel
                course={course}
                actor={actor}
                academy={academy}
              />
              {academy && editor && (
                <CourseParticipationReport
                  key={course.id}
                  courseId={course.id}
                />
              )}
            </div>
          )}
          {hasCloseout && currentSection === "course-closeout" && (
            <div
              className={sectionClass("course-closeout")}
              id="course-closeout"
            >
              <CourseCloseout
                run={course.id}
                actor={actor}
                zone={course.time_zone}
              />
            </div>
          )}
          <div className={sectionClass("course-chat")}>
            <CourseChat
              run={course.id}
              actor={actor}
              canCreate={academy === "active" && course.access.manager}
              showProtection={course.access.client || course.access.manager}
              readOnly={!canEdit}
            />
          </div>
          {hasActivities && (
            <div
              className={sectionClass("course-learning")}
              id="course-learning"
            >
              {academy && (learner || course.access.staff) && (
                <AcademyNotebook
                  key={`notebook:${actor}:${course.id}:${course.notebook?.version ?? 0}`}
                  course={course}
                  actor={actor}
                  academy={academy}
                />
              )}
              <Feedback
                key={`feedback:${actor}:${course.id}:${course.feedback?.version ?? 0}`}
                course={course}
                actor={actor}
                academy={academy}
              />
              {(course.access.staff || (learner && course.quiz?.published)) && (
                <Quiz course={course} actor={actor} academy={academy} />
              )}
              {(course.access.staff || learner) && (
                <CourseCompetencies
                  course={course}
                  actor={actor}
                  editable={canEdit}
                />
              )}
              {(course.access.staff || learner) &&
                currentSection === "course-learning" && (
                  <CoursePeerFeedback
                    course={course.id}
                    actor={actor}
                    staff={course.access.staff}
                  />
                )}
              {course.access.manager &&
                course.lms_enabled &&
                currentSection === "course-learning" && (
                  <CourseXapiExport
                    key={course.id}
                    runId={course.id}
                    zone={course.time_zone}
                  />
                )}
              {learner && (
                <Completion
                  course={course}
                  actor={actor}
                  academy={academy}
                  active={currentSection === "course-learning"}
                />
              )}
              {course.access.staff &&
                course.lms_enabled &&
                currentSection === "course-learning" && (
                  <StaffCompletionRequirements
                    key={course.id}
                    course={course}
                    actor={actor}
                  />
                )}
              {academy && editor && (
                <AcademyCompletionRegister
                  key={course.id}
                  course={course}
                  actor={actor}
                  academy={academy}
                />
              )}
              {__PORTAL_INTERNAL_EDITION__ &&
                !academy &&
                course.access.client &&
                course.ended &&
                course.repeat_request && (
                  <RepeatBooking course={course} actor={actor} />
                )}
            </div>
          )}
          {hasRatingSection && (
            <div
              className={sectionClass("course-evaluations")}
              id="course-evaluations"
            >
              {hasExamGrades &&
                exam &&
                (learner ? (
                  <PublishedExamResults actor={actor} run={course.id} />
                ) : (
                  <ExamGrades actor={actor} run={course.id} exam={exam} />
                ))}
              {hasEvaluations && (
                <CourseEvaluations
                  actor={actor}
                  courseId={course.id}
                  readOnly={!canEdit}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Standard access renders operational course facts only, even on an old Premium deep link. */
function StandardCourseWorkspace({
  course,
  internal,
}: {
  course: CourseWorkspace;
  internal: boolean;
}) {
  const { t } = useTranslation("learning");
  return (
    <div className="section-stack">
      <PageHeading
        title={course.title}
        description={course.time_zone}
        action={
          <div className="page-actions course-room-actions">
            {internal && (course.access.manager || course.access.teacher) && (
              <Button asChild>
                <Link to={`/readiness/${course.id}`}>
                  {t("courseReadiness")}
                </Link>
              </Button>
            )}
            <Button asChild variant="secondary">
              <Link
                to={
                  course.access.manager
                    ? `/courses?run=${course.id}`
                    : "/learning"
                }
              >
                {t(course.access.manager ? "manageCourse" : "back")}
              </Link>
            </Button>
          </div>
        }
      />
      <Notice>{t("premiumOff")}</Notice>
      <div id="course-overview">
        <CourseBasics course={course} />
      </div>
    </div>
  );
}

/** Remount the protected course query on reconnect so cached panels wait for a current entitlement check. */
export function CourseWorkspacePage({
  academy,
}: {
  academy?: "active" | "grace";
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  return online ? (
    <ConnectedCourseWorkspace academy={academy} />
  ) : (
    <Notice>{t("workspaceOffline")}</Notice>
  );
}

function ConnectedCourseWorkspace({
  academy,
}: {
  academy?: "active" | "grace";
}) {
  const { id = "" } = useParams();
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("learning");
  const roles = useQuery({ ...userRolesQuery(actor), enabled: !academy });
  const query = useQuery({
    ...courseWorkspaceQuery(actor, id),
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 10_000,
  });
  if (query.isPending || !query.isFetchedAfterMount) return <Loading />;
  if (
    query.error?.message?.includes("company_premium_lms_off") ||
    (academy && query.isSuccess && !query.data.lms_enabled)
  ) {
    return (
      <section className="panel">
        <PageHeading title={t("workspaceDisabledTitle")} />
        <Notice>{t("premiumOff")}</Notice>
        <Button asChild variant="secondary">
          <Link
            to={
              academy || isParticipantOnly(roles.data)
                ? "/learning"
                : "/courses"
            }
          >
            {t("back")}
          </Link>
        </Button>
      </section>
    );
  }
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data.lms_enabled)
    return (
      <StandardCourseWorkspace
        course={query.data}
        internal={__PORTAL_INTERNAL_EDITION__ && !academy}
      />
    );
  return (
    <CourseWorkspaceLayout
      key={id}
      course={query.data}
      actor={actor}
      now={query.dataUpdatedAt}
      refreshing={query.isFetching}
      refresh={() => void query.refetch()}
      academy={academy}
    />
  );
}
