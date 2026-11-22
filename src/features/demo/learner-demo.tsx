/**
 * Fictional Premium workspace using the learner's actual navigation structure.
 * All sample actions stay in React state and all links stay within the demo.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  FileCheck2,
  ClipboardList,
  GraduationCap,
  MessagesSquare,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/common";
import { dateTime } from "../../lib/dates";
import {
  CourseMessages,
  SampleLesson,
  SampleMeeting,
  SampleSubmission,
} from "./course-practice";
import {
  courses,
  demoLearner,
  demoCoursePath,
  type CoursePractice,
  type FictionalCourse,
} from "./learner-demo-data";
import "./learner-demo-i18n";
import "./learner-demo.css";

const workspaceSections = [
  { id: "course-overview", label: "overview", Icon: CalendarDays },
  { id: "course-materials", label: "materials", Icon: BookOpen },
  { id: "course-submissions", label: "submissions", Icon: ClipboardList },
  { id: "course-exam", label: "exam", Icon: FileCheck2 },
  { id: "course-chat", label: "chat", Icon: MessagesSquare },
  { id: "course-learning", label: "learning", Icon: GraduationCap },
] as const;

/** Keep each course's exercises independent while the participant browses between routes. */
export function LearnerDemo({
  path,
  course,
  practice,
  update,
}: {
  path: string;
  course?: FictionalCourse;
  practice?: CoursePractice;
  update: (change: (current: CoursePractice) => CoursePractice) => void;
}) {
  const { t, i18n } = useTranslation("learnerDemo");
  const { t: demo } = useTranslation("demo");
  const location = useLocation();
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [quizResults, setQuizResults] = useState<
    Record<string, "passed" | "retry">
  >({});
  const [completed, setCompleted] = useState(false);
  const [read, setRead] = useState(false);
  const [rating, setRating] = useState("");
  const [comment, setComment] = useState("");
  const [review, setReview] = useState<{ rating: string; comment: string }>();
  const examVisible = practice?.examRequired === true;
  const sections = workspaceSections.filter(
    (section) => examVisible || section.id !== "course-exam",
  );

  useEffect(() => {
    if (!course) return;
    const id = location.hash.slice(1);
    const section = workspaceSections.find((item) => item.id === id);
    if (!section || (section.id === "course-exam" && !examVisible)) return;
    const target = document.getElementById(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "start" });
  }, [course, examVisible, location.hash]);

  /** Match the real course panel headings and their stable deep-link targets. */
  function panel(
    id: (typeof workspaceSections)[number]["id"],
    children: ReactNode,
  ) {
    const section = workspaceSections.find((item) => item.id === id)!;
    return (
      <section
        className="panel demo-learner-course-panel"
        id={id}
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
      >
        <h2 id={`${id}-title`}>
          <section.Icon aria-hidden="true" size={21} />
          {t(section.label)}
        </h2>
        {children}
      </section>
    );
  }

  if (course && practice) {
    const draft = drafts[course.id] ?? "";
    const answer = answers[course.id] ?? "";
    const result = quizResults[course.id];
    return (
      <div className="demo-learner-workspace">
        <Link to="/demo/learning">{t("back")}</Link>
        <nav
          className="demo-learner-sections"
          aria-label={t("sectionNavigation")}
        >
          {sections.map(({ id, label, Icon }) => (
            <Link
              key={id}
              to={`${demoCoursePath(course)}#${id}`}
              aria-current={location.hash === `#${id}` ? "location" : undefined}
            >
              <Icon size={18} aria-hidden="true" />
              {t(label)}
            </Link>
          ))}
        </nav>
        {panel(
          "course-overview",
          <>
            <div className="demo-learner-welcome">
              <h3>{t("welcome")}</h3>
              <p>{practice.welcome || t(course.welcome)}</p>
            </div>
            <div className="demo-learner-overview-grid">
              <div>
                <h3>{t("dates")}</h3>
                <ul>
                  {course.dates.map((iso) => (
                    <li key={iso}>
                      <time dateTime={iso}>
                        {dateTime(iso, i18n.language, "Europe/Berlin")}
                      </time>
                      {practice.attendance[iso]?.[demoLearner] && (
                        <span className="demo-learner-own-attendance">
                          {t(practice.attendance[iso][demoLearner])}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <p className="muted">{t("mode")}</p>
              </div>
              <div>
                <h3>{t("contact")}</h3>
                <p>{t("contactName")}</p>
                {practice.className && (
                  <p>
                    {t("classLabel")}: {practice.className}
                  </p>
                )}
              </div>
            </div>
            {practice.meeting && <SampleMeeting />}
          </>,
        )}
        {panel(
          "course-materials",
          <>
            <details className="demo-learner-disclosure">
              <summary>
                {t("openMaterial")}: {t(course.resource)}
              </summary>
              <p>{t(course.resourceBody)}</p>
            </details>
            {practice.materials && <SampleLesson />}
          </>,
        )}
        {panel(
          "course-submissions",
          <>
            <p>
              {t(
                practice.submissionsOpen
                  ? "submissionsOpen"
                  : "submissionsClosed",
              )}
            </p>
            {practice.sampleSubmitted && <SampleSubmission />}
            {practice.submissionsOpen && course.phase === "upcoming" && (
              <Button
                variant="secondary"
                onClick={() =>
                  update((current) => ({
                    ...current,
                    sampleSubmitted: !current.sampleSubmitted,
                  }))
                }
              >
                {t(
                  practice.sampleSubmitted ? "withdrawSample" : "submitSample",
                )}
              </Button>
            )}
          </>,
        )}
        {examVisible &&
          panel(
            "course-exam",
            practice.examPublished ? (
              <details className="demo-learner-disclosure">
                <summary>{t("examPreview")}</summary>
                <p>
                  {t(
                    course.id === "linux-basics"
                      ? "examBody"
                      : "networkQuestion",
                  )}
                </p>
              </details>
            ) : (
              <p>{t("examNotPublished")}</p>
            ),
          )}
        {panel(
          "course-chat",
          <>
            <CourseMessages messages={practice.messages} />
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!draft.trim()) return;
                update((current) => ({
                  ...current,
                  messages: [
                    ...current.messages,
                    { role: "participant", text: draft.trim() },
                  ],
                }));
                setDrafts((current) => ({ ...current, [course.id]: "" }));
              }}
            >
              <Field id="demo-learner-message" label={t("chatMessage")}>
                <textarea
                  id="demo-learner-message"
                  maxLength={280}
                  value={draft}
                  onChange={(event) =>
                    setDrafts({
                      ...drafts,
                      [course.id]: event.currentTarget.value,
                    })
                  }
                />
              </Field>
              <Button type="submit" disabled={!draft.trim()}>
                {t("chatSend")}
              </Button>
            </form>
          </>,
        )}
        {panel(
          "course-learning",
          <>
            <h3>{t("quiz")}</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!answer) return;
                setQuizResults({
                  ...quizResults,
                  [course.id]: answer === course.correct ? "passed" : "retry",
                });
              }}
            >
              <fieldset>
                <legend>{t(course.question)}</legend>
                {course.answers.map((option) => (
                  <label key={option} className="demo-learner-choice">
                    <input
                      type="radio"
                      name={`answer-${course.id}`}
                      value={option}
                      checked={answer === option}
                      onChange={() =>
                        setAnswers({ ...answers, [course.id]: option })
                      }
                    />
                    {option}
                  </label>
                ))}
              </fieldset>
              <Button type="submit" disabled={!answer}>
                {t("quizCheck")}
              </Button>
              {result && <p role="status">{t(result)}</p>}
            </form>
            <h3>{t("completion")}</h3>
            {course.phase !== "completed" ? (
              <p>{t("completionAfterCourse")}</p>
            ) : completed ? (
              <p role="status">{t("completionResult")}</p>
            ) : result === "passed" ? (
              <Button variant="secondary" onClick={() => setCompleted(true)}>
                {t("issueCompletion")}
              </Button>
            ) : (
              <p>{t("completionAfterQuiz")}</p>
            )}
          </>,
        )}
      </div>
    );
  }

  if (path === "/my-reviews") {
    return (
      <section
        className="panel demo-learner-course-panel"
        aria-label={t("reviewsHelp")}
      >
        <h2>{demo(courses[1].title)}</h2>
        <p>{t("contactName")}</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (rating) setReview({ rating, comment: comment.trim() });
          }}
        >
          <Field id="demo-learner-rating" label={t("rating")}>
            <select
              id="demo-learner-rating"
              value={rating}
              onChange={(event) => setRating(event.currentTarget.value)}
            >
              <option value="" />
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <Field id="demo-learner-comment" label={t("comment")}>
            <textarea
              id="demo-learner-comment"
              maxLength={280}
              value={comment}
              onChange={(event) => setComment(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" disabled={!rating}>
            {t("reviewSave")}
          </Button>
        </form>
        {review && (
          <div className="demo-learner-review">
            <p role="status">
              {t("reviewStored")} {review.rating}/5
            </p>
            {review.comment && <p>{review.comment}</p>}
            <Button
              variant="secondary"
              onClick={() => {
                setReview(undefined);
                setRating("");
                setComment("");
              }}
            >
              {t("reviewWithdraw")}
            </Button>
          </div>
        )}
      </section>
    );
  }

  if (path === "/notifications") {
    return (
      <section
        className="panel demo-learner-course-panel"
        aria-label={t("inboxHelp")}
      >
        <h2>{t("notice")}</h2>
        <p role="status">{t(read ? "read" : "unread")}</p>
        <div className="demo-learner-actions">
          <Button asChild variant="secondary">
            <Link to={`${demoCoursePath(courses[0])}#course-materials`}>
              {t("openMaterial")}
            </Link>
          </Button>
          <Button variant="ghost" disabled={read} onClick={() => setRead(true)}>
            {t("markRead")}
          </Button>
        </div>
      </section>
    );
  }

  if (path === "/profile") return null;

  const listed = courses.filter(
    (item) => filter === "all" || item.phase === filter,
  );
  return (
    <div className="demo-learner-workspace">
      <div className="demo-learner-filter">
        <Field id="demo-learner-filter" label={demo("courseFilter")}>
          <select
            id="demo-learner-filter"
            value={filter}
            onChange={(event) => setFilter(event.currentTarget.value)}
          >
            <option value="all">{demo("filterAll")}</option>
            <option value="upcoming">{t("upcoming")}</option>
            <option value="completed">{t("completed")}</option>
          </select>
        </Field>
      </div>
      {listed.map((item) => (
        <section key={item.id} aria-labelledby={`demo-learner-${item.phase}`}>
          <h2 id={`demo-learner-${item.phase}`}>{t(item.phase)}</h2>
          <article className="panel demo-learner-card" data-phase={item.phase}>
            <div>
              <h3>{demo(item.title)}</h3>
              <p>
                <time dateTime={item.dates[0]}>
                  {dateTime(item.dates[0], i18n.language, "Europe/Berlin")}
                </time>{" "}
                · {t("mode")}
              </p>
            </div>
            <Button asChild variant="secondary">
              <Link
                to={demoCoursePath(item)}
                aria-label={`${t("openWorkspace")}: ${demo(item.title)}`}
              >
                {t("openWorkspace")} <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </Button>
          </article>
        </section>
      ))}
    </div>
  );
}
