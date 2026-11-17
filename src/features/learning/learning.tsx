/** Bilingual course workspace using server-scoped roles, exact resources and confirmed learner state. */
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, BookOpen, CheckCircle2, Download } from "lucide-react";
import { DateTime } from "luxon";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../../lib/online";
import { dateTime, zonedInstant } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
  Field,
} from "../../components/common";
import { contactEmailLink, contactPhoneLink } from "../profile/contact-api";
import { teachingLink } from "../dashboard/personal-api";
import {
  courseAction,
  courseHubQuery,
  courseWorkspaceKey,
  courseWorkspaceQuery,
  downloadCourseDocument,
  repeatCourse,
  type CourseWorkspace,
  type QuizQuestion,
  type CourseSession,
} from "./api";
import "./i18n";
import "./learning.css";
type WorkProps = { course: CourseWorkspace; actor: string };
/** Confirms an authorized course mutation before invalidating only this account’s workspace. */
function useAction(course: string, actor: string) {
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
    }) => courseAction(course, action, payload, version),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: courseWorkspaceKey(actor, course) }),
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
/** Routes an explicit document request through the protected byte/fact gateway. */
function DownloadButton({
  kind,
  id,
  name,
}: {
  kind: "resource" | "attendance" | "completion";
  id: string;
  name: string;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const download = useMutation({
    mutationFn: () => downloadCourseDocument(kind, id, name),
  });
  return (
    <>
      <Button
        variant="secondary"
        disabled={!online || download.isPending}
        onClick={() => download.mutate()}
      >
        <Download size={16} aria-hidden="true" />
        {t("download")}
      </Button>
      {download.isError && (
        <Notice kind="error">
          {t(
            download.error.message === "unsupported_glyph"
              ? "unsupportedGlyph"
              : "downloadError",
          )}
        </Notice>
      )}
    </>
  );
}
/** Lists course access granted by current enrolment, assignment or organisation membership. */
export function LearningHubPage() {
  const actor = useAuth().session!.user.id;
  const { t, i18n } = useTranslation("learning");
  const query = useQuery(courseHubQuery(actor));
  return (
    <>
      <PageHeading title={t("hub")} description={t("hubHelp")} />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : !query.data.length ? (
        <div className="empty-state">{t("noCourses")}</div>
      ) : (
        <div className="learning-grid">
          {query.data.map((course) => (
            <article className="panel learning-card" key={course.id}>
              <BookOpen aria-hidden="true" />
              <h2>
                <Link to={`/courses/${course.id}/workspace`}>
                  {course.title}
                </Link>
              </h2>
              <p>
                {course.starts_at
                  ? dateTime(course.starts_at, i18n.language, course.time_zone)
                  : t("unscheduled")}
              </p>
              <p>
                {course.venue} · {course.time_zone}
              </p>
              <Button asChild>
                <Link to={`/courses/${course.id}/workspace`}>
                  {t("openWorkspace")}
                </Link>
              </Button>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
/** Shows client-visible shared preparation and server-confirmed staff checklist changes. */
function Preparation({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [label, setLabel] = useState("");
  const [visible, setVisible] = useState(true);
  return (
    <section className="panel learning-panel" aria-label={t("preparation")}>
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
                disabled={!online || !course.access.staff || save.isPending}
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
      {course.access.manager && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(
              {
                action: "preparation_create",
                payload: { label, client_visible: visible },
              },
              { onSuccess: () => setLabel("") },
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
/** Lets a manager explicitly select a same-organisation contact for this course. */
function CourseContact({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [selected, setSelected] = useState("");
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
  const url =
    course.delivery_type === "online" ? teachingLink(course.venue) : null;
  return (
    <section className="panel learning-panel" aria-label={t("courseInfo")}>
      <h2>{t("courseInfo")}</h2>
      <p>{course.description}</p>
      <p className="preserve-text">{course.syllabus}</p>
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
      {course.access.manager && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              action: "contact_select",
              payload: { contact_id: selected || null },
              version: course.settings_version,
            });
          }}
        >
          <Field id="course-contact" label={t("selectContact")}>
            <select
              id="course-contact"
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              <option value="">{t("noContact")}</option>
              {course.contact_options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="muted">{t("contactHelp")}</p>
          <Button disabled={!online || save.isPending}>{t("save")}</Button>
        </form>
      )}
      <Result error={save.isError} />
    </section>
  );
}
/** Shares only reviewed clean versions and records acknowledgement of that exact version. */
function Resources({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [version, setVersion] = useState("");
  const [audience, setAudience] = useState("all");
  const [category, setCategory] = useState("material");
  return (
    <section className="panel learning-panel" aria-label={t("resources")}>
      <h2>{t("resources")}</h2>
      <p>{t("resourceHelp")}</p>
      {!course.resources.length && <p>{t("noResources")}</p>}
      <ul className="learning-resources">
        {course.resources.map((resource) => (
          <li key={resource.id}>
            <strong>{resource.name}</strong>
            <small>
              {t("version", { version: resource.version })} ·{" "}
              {t(resource.category)}
            </small>
            <div className="form-actions">
              <DownloadButton
                kind="resource"
                id={resource.id}
                name={resource.name}
              />
              <Button
                variant="ghost"
                disabled={!online || save.isPending || resource.acknowledged}
                onClick={() =>
                  save.mutate({
                    action: "resource_acknowledge",
                    payload: { id: resource.id },
                  })
                }
              >
                {t(resource.acknowledged ? "acknowledged" : "acknowledge")}
              </Button>
              {course.access.manager && (
                <Button
                  variant="ghost"
                  disabled={!online || save.isPending}
                  onClick={() =>
                    save.mutate({
                      action: "resource_remove",
                      payload: { id: resource.id },
                    })
                  }
                >
                  {t("unshare")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {course.access.manager && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({
              action: "resource_share",
              payload: { version_id: version, audience, category },
            });
          }}
        >
          <Field id="share-version" label={t("reviewedVersion")}>
            <select
              id="share-version"
              value={version}
              required
              onChange={(event) => setVersion(event.target.value)}
            >
              <option value="">{t("choose")}</option>
              {course.share_options.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.version}
                </option>
              ))}
            </select>
          </Field>
          <Field id="resource-audience" label={t("audience")}>
            <select
              id="resource-audience"
              value={audience}
              onChange={(event) => setAudience(event.target.value)}
            >
              {["all", "staff", "client", "participants"].map((value) => (
                <option value={value} key={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="resource-category" label={t("category")}>
            <select
              id="resource-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="material">{t("material")}</option>
              <option value="report">{t("report")}</option>
            </select>
          </Field>
          <Button disabled={!online || save.isPending || !version}>
            {t("share")}
          </Button>
        </form>
      )}
      <Result error={save.isError} />
    </section>
  );
}
/** Sends a reasoned CAS correction; the server checks ended-session scope and completion locks. */
function AttendanceEditor({
  course,
  actor,
  person,
  session,
  entry,
}: WorkProps & {
  person: CourseWorkspace["roster"][number];
  session: CourseSession;
  entry: CourseWorkspace["roster"][number]["sessions"][number];
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [state, setState] = useState(
    entry.state === "absent" ? "absent" : "attended",
  );
  const [minutes, setMinutes] = useState(
    entry.minutes ??
      Math.round(
        (Date.parse(session.ends_at) - Date.parse(session.starts_at)) / 60000,
      ),
  );
  const [reason, setReason] = useState("");
  return (
    <form
      className="learning-attendance-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          action: "attendance_verify",
          payload: {
            session_id: session.id,
            user_id: person.user_id,
            state,
            minutes: state === "absent" ? 0 : minutes,
            reason,
          },
          version: entry.version,
        });
      }}
    >
      <label>
        {t("attendanceState")}
        <select
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          <option value="attended">{t("attended")}</option>
          <option value="absent">{t("absent")}</option>
        </select>
      </label>
      <label>
        {t("minutes")}
        <input
          type="number"
          min={0}
          max={Math.ceil(
            (Date.parse(session.ends_at) - Date.parse(session.starts_at)) /
              60000,
          )}
          value={minutes}
          onChange={(event) => setMinutes(Number(event.target.value))}
        />
      </label>
      <label>
        {t("correctionReason")}
        <input
          value={reason}
          required
          minLength={3}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <Button
        disabled={
          !online ||
          save.isPending ||
          reason.trim().length < 3 ||
          !session.can_verify
        }
      >
        {t("verifyAttendance")}
      </Button>
      <Result error={save.isError} />
    </form>
  );
}
/** Requires staff intent and a reason before revoking an issued immutable completion record. */
function CompletionRevoke({ course, actor, id }: WorkProps & { id: string }) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [reason, setReason] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({ action: "completion_revoke", payload: { id, reason } });
      }}
    >
      <label>
        {t("revocationReason")}
        <input
          required
          minLength={3}
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <Button
        variant="ghost"
        disabled={!online || save.isPending || reason.trim().length < 3}
      >
        {t("revokeCompletion")}
      </Button>
      <Result error={save.isError} />
    </form>
  );
}
/** Separates self-reported presence from verified staff attendance and its audit history. */
function Attendance({ course, actor }: WorkProps) {
  const { t, i18n } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  return (
    <section className="panel learning-panel" aria-label={t("attendance")}>
      <h2>{t("attendance")}</h2>
      <p>{t("attendanceHelp")}</p>
      <ol className="learning-sessions">
        {course.sessions.map((session) => (
          <li key={session.id}>
            <strong>
              {dateTime(session.starts_at, i18n.language, course.time_zone)} –{" "}
              {dateTime(session.ends_at, i18n.language, course.time_zone)}
            </strong>
            {course.access.learner && (
              <>
                <p>
                  {t(session.attendance ?? "unreported")} ·{" "}
                  {session.minutes ?? 0} {t("minutes")}
                </p>
                <Button
                  disabled={!online || save.isPending || !session.can_check_in}
                  onClick={() =>
                    save.mutate({
                      action: "attendance_report",
                      payload: { session_id: session.id },
                    })
                  }
                >
                  {t("checkIn")}
                </Button>
              </>
            )}
          </li>
        ))}
      </ol>
      {(course.access.staff || course.access.client) && (
        <>
          <DownloadButton
            kind="attendance"
            id={course.id}
            name="course-attendance.pdf"
          />
          {course.roster.map((person) => (
            <details key={person.user_id}>
              <summary>
                {person.name} · {t(person.status)}
              </summary>
              {person.sessions.map((entry) => {
                const session = course.sessions.find(
                  (item) => item.id === entry.session_id,
                )!;
                return (
                  <div className="learning-roster-entry" key={entry.session_id}>
                    <p>
                      {dateTime(
                        session.starts_at,
                        i18n.language,
                        course.time_zone,
                      )}{" "}
                      · {t(entry.state ?? "unreported")} · {entry.minutes ?? 0}{" "}
                      {t("minutes")}
                    </p>
                    {course.access.staff && (
                      <AttendanceEditor
                        key={`${entry.session_id}:${entry.version}`}
                        course={course}
                        actor={actor}
                        person={person}
                        session={session}
                        entry={entry}
                      />
                    )}
                  </div>
                );
              })}
              {person.completion_id && (
                <>
                  <DownloadButton
                    kind="completion"
                    id={person.completion_id}
                    name="course-completion.pdf"
                  />
                  {course.access.staff && (
                    <CompletionRevoke
                      course={course}
                      actor={actor}
                      id={person.completion_id}
                    />
                  )}
                </>
              )}
            </details>
          ))}
          {course.access.staff && course.attendance_history.length > 0 && (
            <details>
              <summary>{t("attendanceHistory")}</summary>
              <ul>
                {course.attendance_history.map((item) => (
                  <li key={item.id}>
                    {dateTime(item.created_at, i18n.language, course.time_zone)}{" "}
                    · {item.new_state.state} · {item.new_state.minutes}{" "}
                    {t("minutes")} · {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      <Result error={save.isError} />
    </section>
  );
}
/** Retains private draft text and its version until confirmed save or explicit server reload. */
function Notebook({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [body, setBody] = useState(course.notebook.body);
  const [version, setVersion] = useState(course.notebook.version);
  const client = useQueryClient();
  return (
    <section className="panel learning-panel">
      <h2>{t("notebook")}</h2>
      <p>{t("notebookHelp")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            {
              action: "notebook",
              payload: { body },
              version,
            },
            { onSuccess: () => setVersion((value) => value + 1) },
          );
        }}
      >
        <Field id="course-notebook" label={t("notes")}>
          <textarea
            id="course-notebook"
            rows={5}
            maxLength={12000}
            value={body}
            disabled={save.isPending}
            onChange={(event) => {
              setBody(event.target.value);
              save.reset();
            }}
          />
        </Field>
        <Button disabled={!online || save.isPending}>{t("save")}</Button>
        <Result error={save.isError} success={save.isSuccess} />
        {save.isError && (
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              void client
                .invalidateQueries({
                  queryKey: courseWorkspaceKey(actor, course.id),
                })
                .then(() => {
                  const current = client.getQueryData<CourseWorkspace>(
                    courseWorkspaceKey(actor, course.id),
                  );
                  if (current) {
                    setBody(current.notebook.body);
                    setVersion(current.notebook.version);
                    save.reset();
                  }
                })
            }
          >
            {t("reloadNotebook")}
          </Button>
        )}
      </form>
    </section>
  );
}
/** Submits one versioned staff answer to a course question. */
function Answer({
  course,
  actor,
  question,
}: WorkProps & { question: CourseWorkspace["questions"][number] }) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [answer, setAnswer] = useState(question.answer);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          action: "answer",
          payload: { id: question.id, answer },
          version: question.version,
        });
      }}
    >
      <label>
        {t("answer")}
        <textarea
          maxLength={4000}
          required
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
        />
      </label>
      <Button disabled={!online || save.isPending || !answer.trim()}>
        {t("saveAnswer")}
      </Button>
      <Result error={save.isError} />
    </form>
  );
}
/** Exposes course questions only to server-authorized staff and enrolled learners. */
function Questions({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [body, setBody] = useState("");
  return (
    <section className="panel learning-panel" aria-label={t("questions")}>
      <h2>{t("questions")}</h2>
      <p>{t("questionHelp")}</p>
      <ul className="learning-resources">
        {course.questions.map((question) => (
          <li key={question.id}>
            <p className="preserve-text">{question.body}</p>
            <p className="preserve-text">
              {question.answer || t("unanswered")}
            </p>
            {course.access.staff && (
              <Answer
                key={`${question.id}:${question.version}`}
                course={course}
                actor={actor}
                question={question}
              />
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            { action: "question", payload: { body } },
            { onSuccess: () => setBody("") },
          );
        }}
      >
        <Field id="course-question" label={t("newQuestion")}>
          <textarea
            id="course-question"
            required
            maxLength={2000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </Field>
        <Button disabled={!online || save.isPending || !body.trim()}>
          {t("ask")}
        </Button>
        <Result error={save.isError} />
      </form>
    </section>
  );
}
/** Discloses server-held identity and the minimum-three aggregate policy accurately. */
function Feedback({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [rating, setRating] = useState(String(course.feedback?.rating ?? 5));
  const [comment, setComment] = useState(course.feedback?.comment ?? "");
  return (
    <section className="panel learning-panel" aria-label={t("feedback")}>
      <h2>{t("feedback")}</h2>
      <p>{t("feedbackPolicy")}</p>
      {(course.access.learner || course.access.client) && course.ended && (
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
function QuizEditor({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
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
  return (
    <form
      className="learning-quiz-editor"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          action: "quiz_config",
          payload: {
            questions,
            pass_percent: pass,
            max_attempts: attempts,
            published,
          },
          version: course.quiz?.version ?? 0,
        });
      }}
    >
      {questions.map((question, index) => (
        <fieldset key={index}>
          <legend>{t("quizQuestion", { number: index + 1 })}</legend>
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
          {questions.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setQuestions((items) => items.filter((_, i) => i !== index))
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
        disabled={questions.length >= 20}
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
      <Button disabled={!online || save.isPending}>{t("saveQuiz")}</Button>
      <Result error={save.isError} success={save.isSuccess} />
    </form>
  );
}
/** Submits an eligible attempt with a stable retry ID; correct answers remain server-private. */
function QuizAttempt({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
  const [answers, setAnswers] = useState<number[]>([]);
  const [request] = useState(() => crypto.randomUUID());
  const quiz = course.quiz!;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate({
          action: "quiz_attempt",
          payload: { answers, request_id: request },
          version: quiz.version,
        });
      }}
    >
      {quiz.questions.map((question, index) => (
        <fieldset key={index}>
          <legend>{question.prompt}</legend>
          {question.options.map((option, n) => (
            <label className="checkbox-label" key={n}>
              <input
                type="radio"
                required
                name={`quiz-question-${index}`}
                checked={answers[index] === n}
                onChange={() =>
                  setAnswers((items) => {
                    const next = [...items];
                    next[index] = n;
                    return next;
                  })
                }
              />
              {option}
            </label>
          ))}
        </fieldset>
      ))}
      <p>
        {t("quizLimits", {
          attempts: quiz.attempts,
          max: quiz.max_attempts,
          pass: quiz.pass_percent,
        })}
      </p>
      {quiz.last_score !== null && (
        <p>
          {t("score", { score: quiz.last_score })} ·{" "}
          {t(quiz.passed ? "passed" : "notPassed")}
        </p>
      )}
      <Button
        disabled={
          !online ||
          save.isPending ||
          quiz.attempts >= quiz.max_attempts ||
          quiz.passed
        }
      >
        {t("submitQuiz")}
      </Button>
      <Result error={save.isError} />
    </form>
  );
}
/** Chooses authoring or attempt controls from the authorized course DTO. */
function Quiz({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  return (
    <section className="panel learning-panel" aria-label={t("quiz")}>
      <h2>{t("quiz")}</h2>
      {course.access.staff ? (
        <QuizEditor
          key={course.quiz?.version ?? 0}
          course={course}
          actor={actor}
        />
      ) : course.quiz?.published && course.access.learner ? (
        <QuizAttempt
          key={`${course.quiz.version}:${course.quiz.attempts}`}
          course={course}
          actor={actor}
        />
      ) : (
        <p>{t("noQuiz")}</p>
      )}
    </section>
  );
}
/** Requests completion only after server attendance and current-quiz eligibility checks. */
function Completion({ course, actor }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const save = useAction(course.id, actor);
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
      ) : (
        <Button
          disabled={!online || save.isPending || !course.ended}
          onClick={() => save.mutate({ action: "completion_issue" })}
        >
          {t("issueCompletion")}
        </Button>
      )}
      <Result error={save.isError} />
    </section>
  );
}
/** Creates a new future request from the client’s delivered course without copying private learner data. */
function RepeatBooking({ course }: WorkProps) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const request = course.repeat_request!;
  const retry = useRef<{ signature: string; key: string } | null>(null);
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
      if (retry.current?.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      return repeatCourse(request.id, values, retry.current.key);
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
/** Loads the current account’s scoped course and removes content when access is unavailable. */
export function CourseWorkspacePage() {
  const { id = "" } = useParams();
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("learning");
  const query = useQuery(courseWorkspaceQuery(actor, id));
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const course = query.data;
  return (
    <>
      <PageHeading title={course.title} description={t("workspaceHelp")} />
      <div className="page-actions">
        <Button asChild variant="ghost">
          <Link to="/learning">{t("back")}</Link>
        </Button>
        <Button
          variant="secondary"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          {t("refresh")}
        </Button>
      </div>
      <div className="learning-workspace">
        <CourseContact course={course} actor={actor} />
        {(course.access.staff || course.access.client) && (
          <Preparation course={course} actor={actor} />
        )}
        <Resources course={course} actor={actor} />
        <Attendance course={course} actor={actor} />
        <Notebook key={course.id} course={course} actor={actor} />
        {(course.access.staff || course.access.learner) && (
          <Questions course={course} actor={actor} />
        )}
        <Feedback
          key={course.feedback?.version ?? 0}
          course={course}
          actor={actor}
        />
        {(course.access.staff || course.access.learner) && (
          <Quiz course={course} actor={actor} />
        )}{" "}
        {course.access.learner && <Completion course={course} actor={actor} />}{" "}
        {course.access.client && course.ended && course.repeat_request && (
          <RepeatBooking course={course} actor={actor} />
        )}
      </div>
    </>
  );
}
