/** Operational course workspace: scoped preparation, contacts, dates and exact shared file versions. */
import {useEffect, useRef, useState} from "react";
import {Link, useLocation, useParams} from "react-router-dom";
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query";
import {useTranslation} from "react-i18next";
import {CalendarDays, CheckCircle2, ChevronLeft, Clock, Plus, Video} from "lucide-react";
import {DateTime} from "luxon";
import {useAuth} from "../auth/auth-context";
import {isParticipantOnly} from "../auth/guest-navigation";
import {useOnline} from "../../lib/online";
import {portalInternalEdition} from "../../lib/installation-brand";
import {userRolesQuery} from "../../lib/queries";
import {dateTime, zonedInstant} from "../../lib/dates";
import {Button} from "../../components/ui/button";
import {ErrorState, Field, Loading, Notice, PageHeading,} from "../../components/common";
import {contactEmailLink, contactPhoneLink} from "../profile/contact-api";
import {courseAction, type CourseWorkspace, type QuizQuestion, courseWorkspaceKey, courseWorkspaceQuery, repeatCourse,} from "./api";
import "./i18n";
import "./learning.css";
import {CourseDestinations} from "./destinations";
import {CourseWelcomeContent} from "./welcome-content";
import {CourseMeetingLinkEditor} from "./meeting-link";
import {courseClassroom} from "./meeting-url";
import {CourseExams} from "./exams";
import {AttendancePanel} from "./attendance";
import {AcademyInstructors} from "./academy-instructors";
import {CourseEnrolmentsPanel, CourseWithdrawal} from "./enrolments";
import {CourseChat} from "./course-chat";
import {DownloadButton, Resources} from "./resources";

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
            client.invalidateQueries({queryKey: courseWorkspaceKey(actor, course)}),
    });
}

/** Presents confirmed mutation status without translating authored course content. */
function Result({error, success}: { error: boolean; success?: boolean }) {
    const {t} = useTranslation("learning");
    return error ? (
        <Notice kind="error">{t("saveError")}</Notice>
    ) : success ? (
        <Notice>{t("saved")}</Notice>
    ) : null;
}

/** Shows client-visible shared preparation and server-confirmed staff checklist changes. */
function Preparation({course, actor}: WorkProps) {
    const {t} = useTranslation("learning");
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
                                        payload: {id: item.id, done: event.target.checked},
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
                                payload: {label, client_visible: visible},
                            },
                            {onSuccess: () => setLabel("")},
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
            <Result error={save.isError}/>
        </section>
    );
}

/** Lets a manager explicitly select a same-organisation contact for this course. */
function CourseContact({course, actor, url}: WorkProps & {url: string | null}) {
    const {t} = useTranslation("learning");
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
                                setCopyStatus({url, status: "success"});
                            } catch {
                                setCopyStatus({url, status: "error"});
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
            {course.meeting_link?.can_edit && (
                <CourseMeetingLinkEditor actor={actor} courseId={course.id} current={course.meeting_link}/>
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
                            payload: {contact_id: selected || null},
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
            <Result error={save.isError}/>
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
function RepeatBooking({course}: WorkProps) {
    const {t} = useTranslation("learning");
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
                .plus({days: 7})
                .diff(first, "days").days,
        );
        return request.sessions.map((item) => ({
            starts_at: DateTime.fromISO(item.starts_at, {zone: course.time_zone})
                .plus({days: shift})
                .toFormat("yyyy-MM-dd'T'HH:mm"),
            ends_at: DateTime.fromISO(item.ends_at, {zone: course.time_zone})
                .plus({days: shift})
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
                return {starts_at, ends_at};
            });
            const signature = JSON.stringify(values);
            if (retry.current?.signature !== signature)
                retry.current = {signature, key: crypto.randomUUID()};
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
                            {t("sessionNumber", {number: index + 1})} · {course.time_zone}
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
                                                    ? {...item, [key]: event.target.value}
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
                <Result error={save.isError} success={save.isSuccess}/>
                {save.isSuccess && <Link to="/client">{t("viewRequest")}</Link>}
            </form>
        </section>
    );
}

/** Keep non-Premium course facts separate from learning files and interactions. */
function CourseBasics({course}: { course: CourseWorkspace }) {
    const {t, i18n} = useTranslation("learning");
    return (
        <section className="panel learning-panel">
            <h2>{t("courseOverview")}</h2>
            <p className="preserve-text">{course.description}</p>
            <p className="preserve-text">{course.syllabus}</p>
            {course.delivery_type !== "online" && course.venue && <p>{course.venue}</p>}
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
        </section>
    );
}

/** Keep the sections mounted so anchor navigation preserves forms and draft state. */
function CourseWorkspaceLayout({
    course, actor, now, refreshing, refresh,
}: WorkProps & { now: number; refreshing: boolean; refresh: () => void }) {
    const {t, i18n} = useTranslation("learning");
    const location = useLocation();
    const learner = course.access.learner;
    const editor = course.access.staff || course.access.client;
    const examVisible = Boolean(course.exams && (course.exams.required || course.exams.can_edit));
    const hasActivities = learner || editor;
    const hasRegister = editor && course.sessions.length > 0;
    const canManageEnrolments = course.access.manager || course.access.client;
    const sections = [
        {id: "course-overview", label: t("courseOverview")},
        {id: "course-materials", label: t("workspaceMaterials")},
        ...(examVisible ? [{id: "course-exam", label: t("workspaceExam")}] : []),
        ...(canManageEnrolments ? [{id: "course-enrolments", label: t("workspaceParticipants")}] : []),
        ...(hasRegister ? [{id: "course-register", label: t("workspaceRegister")}] : []),
        {id: "course-chat", label: t("courseChat")},
        ...(hasActivities ? [{id: "course-learning", label: t("workspaceActivities")}] : []),
    ];
    const currentSection = sections.find(({id}) => location.hash === "#" + id)?.id ?? "course-overview";
    const next = course.sessions.find((session) => Date.parse(session.ends_at) > now);
    const classroom = courseClassroom(course);
    const pageTarget = learner ? "/learning" : "/courses";

    // React Router may resolve a deep link before the scoped course data
    // loads. Apply that hash when its destination first becomes available.
    useEffect(() => {
        if (location.hash !== "#" + currentSection) return;
        const target = document.getElementById(currentSection);
        target?.scrollIntoView?.({block: "start"});
    }, [currentSection, location.hash]);

    return (
        <div className="course-room">
            <div className="course-room-toolbar">
                <Button asChild variant="ghost">
                    <Link to={pageTarget}><ChevronLeft size={18} aria-hidden="true"/>{t("back")}</Link>
                </Button>
                <Button variant="secondary" onClick={refresh} disabled={refreshing}>
                    {t("refresh")}
                </Button>
            </div>
            <header className="course-room-header">
                <div className="course-room-title">
                    <h1>{course.title}</h1>
                    <div className="course-room-meta">
                        <span><Clock size={17} aria-hidden="true"/>{course.time_zone}</span>
                        <span>{t(course.delivery_type === "online" ? "workspaceOnline" : "workspaceOnSite")}</span>
                    </div>
                </div>
                {next && (
                    <div className="course-room-next">
                        <CalendarDays size={22} aria-hidden="true"/>
                        <div>
                            <span>{t(Date.parse(next.starts_at) <= now ? "workspaceInSession" : "workspaceNextSession")}</span>
                            <strong>{dateTime(next.starts_at, i18n.language, course.time_zone)}</strong>
                        </div>
                    </div>
                )}
                {classroom && learner && !course.ended && (
                    <Button asChild>
                        <a href={classroom} target="_blank" rel="noopener noreferrer">
                            <Video size={18} aria-hidden="true"/>{t("joinClassroom")}
                        </a>
                    </Button>
                )}
            </header>
            {!learner && (
                <div className="page-actions">
                    {editor && <Button asChild variant="secondary">
                        <Link to={`/courses?run=${course.id}`}>{t("manageCourse")}</Link>
                    </Button>}
                    {editor && <Button asChild variant="secondary">
                        <Link to={`/readiness/${course.id}`}>{t("courseReadiness")}</Link>
                    </Button>}
                </div>
            )}
            <div className="course-room-layout">
                <nav className="course-room-navigation" aria-label={t("workspaceNavigation")}>
                    <ul>
                        {sections.map(({id, label}) => (
                            <li key={id}>
                                <Link
                                    to={{pathname: location.pathname, search: location.search, hash: "#" + id}}
                                    aria-current={id === currentSection ? "location" : undefined}
                                >{label}</Link>
                            </li>
                        ))}
                    </ul>
                </nav>
                <div className="course-room-content">
                    <div className="course-room-section" id="course-overview">
                        <CourseBasics course={course}/>
                        <CourseWelcomeContent key={course.id} actor={actor} courseId={course.id}
                            zone={course.time_zone} canEdit={editor}/>
                        <CourseDestinations actor={actor} courseId={course.id} learner={learner || !portalInternalEdition}/>
                        {!portalInternalEdition && course.access.manager && <AcademyInstructors courseId={course.id} actor={actor}/>}
                        <CourseContact course={course} actor={actor} url={classroom}/>
                        {editor && <Preparation course={course} actor={actor}/>}
                        {learner && <CourseWithdrawal course={course} actor={actor}/>}
                    </div>
                    <div className="course-room-section" id="course-materials">
                        <Resources course={course} actor={actor}/>
                    </div>
                    {examVisible && (
                        <div className="course-room-section" id="course-exam">
                            <CourseExams key={course.exams.version ?? course.exams.required.toString()}
                                course={course} actor={actor}/>
                        </div>
                    )}
                    {canManageEnrolments && (
                        <div className="course-room-section" id="course-enrolments">
                            <CourseEnrolmentsPanel course={course} actor={actor}/>
                        </div>
                    )}
                    {hasRegister && (
                        <div className="course-room-section" id="course-register">
                            <AttendancePanel course={course} actor={actor}/>
                        </div>
                    )}
                    <CourseChat run={course.id} actor={actor}/>
                    {hasActivities && (
                        <div className="course-room-section" id="course-learning">
                            <Feedback key={`${course.id}:${course.feedback?.version ?? 0}`} course={course} actor={actor}/>
                            {(course.access.staff || (learner && course.quiz?.published)) && <Quiz course={course} actor={actor}/>}
                            {learner && <Completion course={course} actor={actor}/>}
                            {course.access.client && course.ended && course.repeat_request && <RepeatBooking course={course} actor={actor}/>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/** Revalidate the signed-in actor's course and entitlement before rendering any protected panels. */
export function CourseWorkspacePage() {
    const {id = ""} = useParams();
    const actor = useAuth().session!.user.id;
    const {t} = useTranslation("learning");
    const online = useOnline();
    const roles = useQuery(userRolesQuery(actor));
    const query = useQuery({
        ...courseWorkspaceQuery(actor, id),
        enabled: online,
        staleTime: 0,
        refetchOnMount: "always",
        refetchInterval: 10_000,
    });
    if (!online) return <Notice>{t("workspaceOffline")}</Notice>;
    if (query.isPending || (query.isFetching && !query.isFetchedAfterMount)) return <Loading/>;
    if (query.error?.message?.includes("company_premium_lms_off") ||
        (query.isSuccess && !query.data.lms_enabled)) {
        return (
            <section className="panel">
                <PageHeading title={t("workspaceDisabledTitle")}/>
                <Notice>{t("premiumOff")}</Notice>
                <Button asChild variant="secondary">
                    <Link to={isParticipantOnly(roles.data) ? "/learning" : "/courses"}>{t("back")}</Link>
                </Button>
            </section>
        );
    }
    if (query.isError) return <ErrorState retry={() => void query.refetch()}/>;
    return <CourseWorkspaceLayout key={id} course={query.data} actor={actor}
        now={query.dataUpdatedAt} refreshing={query.isFetching} refresh={() => void query.refetch()}/>;
}
