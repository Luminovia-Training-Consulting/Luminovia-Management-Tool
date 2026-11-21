/** Staff exercises use the same local example records the learner sees. */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileCheck2,
  MessagesSquare,
  Users,
} from "lucide-react";
import { Field } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import {
  attendanceValues,
  demoRoleLabel,
  inviteCandidates,
  type Attendance,
  type CoursePractice,
  type DemoRole,
  type FictionalCourse,
} from "./learner-demo-data";
import "./learner-demo-i18n";
import "./learner-demo.css";

export function SampleLesson() {
  const { t } = useTranslation("learnerDemo");
  return (
    <details className="demo-learner-disclosure">
      <summary>{t("labSheet")}</summary>
      <p>{t("labSheetBody")}</p>
    </details>
  );
}

export function SampleMeeting() {
  const { t } = useTranslation("learnerDemo");
  const [joined, setJoined] = useState(false);
  return (
    <div className="demo-learner-actions">
      <Button variant="secondary" onClick={() => setJoined(!joined)}>
        {t(joined ? "leaveMeeting" : "joinMeeting")}
      </Button>
      {joined && <p role="status">{t("meetingJoined")}</p>}
    </div>
  );
}

export function CourseMessages({
  messages,
}: {
  messages: CoursePractice["messages"];
}) {
  const { t } = useTranslation("learnerDemo");
  const { t: demo } = useTranslation("demo");
  return (
    <ol className="demo-messages">
      <li>
        <strong>{t("contactName")}</strong>
        <p>{t("chatPrompt")}</p>
      </li>
      {messages.map(({ role, text }, index) => (
        <li key={index}>
          <strong>
            {role === "participant" ? "Demo Alex" : demo(demoRoleLabel[role])}
          </strong>
          <p>{text}</p>
        </li>
      ))}
    </ol>
  );
}

const sections = {
  delivery: CalendarDays,
  materials: BookOpen,
  exam: FileCheck2,
  attendance: ClipboardList,
  enrolment: Users,
  chat: MessagesSquare,
};

type Section = keyof typeof sections;

function PracticeSection({
  section,
  children,
  open = false,
}: {
  section: Section;
  children: ReactNode;
  open?: boolean;
}) {
  const { t } = useTranslation("learnerDemo");
  const Icon = sections[section];
  return (
    <details className="panel demo-practice-section" open={open || undefined}>
      <summary>
        <Icon size={21} aria-hidden="true" />
        <h2>{t(section)}</h2>
      </summary>
      <div className="demo-practice-section-body">{children}</div>
    </details>
  );
}

export function StaffCoursePractice({
  role,
  course,
  practice,
  update,
}: {
  role: Exclude<DemoRole, "participant">;
  course: FictionalCourse;
  practice: CoursePractice;
  update: (change: (current: CoursePractice) => CoursePractice) => void;
}) {
  const { t, i18n } = useTranslation("learnerDemo");
  const [welcome, setWelcome] = useState(practice.welcome);
  const [className, setClassName] = useState(practice.className);
  const [invitee, setInvitee] = useState("");
  const [session, setSession] = useState<string>(course.dates[0]);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState<Section | null>(null);
  const canEnrol = role !== "lecturer";
  const availableInvitations = inviteCandidates.filter(
    (name) =>
      !practice.invited.includes(name) && !practice.enrolled.includes(name),
  );

  function change(fields: Partial<CoursePractice>, section: Section) {
    update((current) => ({ ...current, ...fields }));
    setNotice(section);
  }

  const saved = (section: Section) =>
    notice === section ? <p role="status">{t("localChangeSaved")}</p> : null;

  return (
    <div className="demo-learner-workspace">
      <Link to="/demo/courses">{t("backStaff")}</Link>
      <div className="demo-practice-stats">
        <div>
          <span>{t("dates")}</span>
          <strong>{course.dates.length}</strong>
        </div>
        <div>
          <span>{t("learners")}</span>
          <strong>{practice.enrolled.length}</strong>
        </div>
        <div>
          <span>{t("exam")}</span>
          <strong>{t(practice.examRequired ? "enabled" : "disabled")}</strong>
        </div>
      </div>
      <PracticeSection section="delivery" open>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const text = welcome.trim();
            setWelcome(text);
            change({ welcome: text }, "delivery");
          }}
        >
          <Field id="demo-staff-welcome" label={t("welcome")}>
            <textarea
              id="demo-staff-welcome"
              rows={3}
              maxLength={240}
              placeholder={t(course.welcome)}
              value={welcome}
              onChange={(event) => setWelcome(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" disabled={welcome.trim() === practice.welcome}>
            {t("publishWelcome")}
          </Button>
        </form>
        <div className="demo-learner-actions">
          <Button
            variant="secondary"
            onClick={() => change({ meeting: !practice.meeting }, "delivery")}
          >
            {t(practice.meeting ? "unshareMeeting" : "shareMeeting")}
          </Button>
          {practice.meeting && <SampleMeeting />}
        </div>
        {saved("delivery")}
      </PracticeSection>
      <PracticeSection section="materials">
        {practice.materials && <SampleLesson />}
        <Button
          variant="secondary"
          onClick={() =>
            change({ materials: !practice.materials }, "materials")
          }
        >
          {t(practice.materials ? "unshareMaterial" : "shareMaterial")}
        </Button>
        {saved("materials")}
      </PracticeSection>
      <PracticeSection section="exam">
        <label className="demo-learner-choice">
          <input
            type="checkbox"
            checked={practice.examRequired}
            onChange={(event) =>
              change({ examRequired: event.currentTarget.checked }, "exam")
            }
          />
          {t("examRequired")}
        </label>
        <Button
          variant="secondary"
          disabled={!practice.examRequired}
          onClick={() =>
            change({ examPublished: !practice.examPublished }, "exam")
          }
        >
          {t(practice.examPublished ? "withdrawExam" : "publishExam")}
        </Button>
        {saved("exam")}
      </PracticeSection>
      <PracticeSection section="attendance">
        <Field id="demo-attendance-session" label={t("dates")}>
          <select
            id="demo-attendance-session"
            value={session}
            onChange={(event) => setSession(event.currentTarget.value)}
          >
            {course.dates.map((date) => (
              <option key={date} value={date}>
                {dateTime(date, i18n.language, "Europe/Berlin")}
              </option>
            ))}
          </select>
        </Field>
        <div className="demo-practice-roster">
          {practice.enrolled.map((name, index) => (
            <Field
              key={name}
              id={`demo-attendance-status-${index}`}
              label={name}
            >
              <select
                id={`demo-attendance-status-${index}`}
                value={practice.attendance[session]?.[name] ?? "unmarked"}
                onChange={(event) => {
                  const value = event.currentTarget.value as Attendance;
                  update((current) => ({
                    ...current,
                    attendance: {
                      ...current.attendance,
                      [session]: {
                        ...current.attendance[session],
                        [name]: value,
                      },
                    },
                  }));
                  setNotice("attendance");
                }}
              >
                {attendanceValues.map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </Field>
          ))}
        </div>
        {saved("attendance")}
      </PracticeSection>
      {canEnrol && (
        <PracticeSection section="enrolment">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!availableInvitations.includes(invitee)) return;
              change({ invited: [...practice.invited, invitee] }, "enrolment");
              setInvitee("");
            }}
          >
            <Field id="demo-invitee" label={t("selectInvitee")}>
              <select
                id="demo-invitee"
                value={invitee}
                onChange={(event) => setInvitee(event.currentTarget.value)}
              >
                <option value="">{t("chooseLearner")}</option>
                {availableInvitations.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
            <Button type="submit" disabled={!invitee}>
              {t("inviteLearner")}
            </Button>
          </form>
          {practice.invited.length > 0 && (
            <ul className="demo-practice-invited">
              {practice.invited.map((name) => (
                <li key={name}>
                  <span>{name}</span>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      change(
                        {
                          invited: practice.invited.filter(
                            (person) => person !== name,
                          ),
                          enrolled: [...practice.enrolled, name],
                        },
                        "enrolment",
                      )
                    }
                  >
                    {t("enrolLearner", { name })}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setClassName(className.trim());
              change({ className: className.trim() }, "enrolment");
            }}
          >
            <Field id="demo-class-name" label={t("classLabel")}>
              <input
                id="demo-class-name"
                value={className}
                maxLength={80}
                onChange={(event) => setClassName(event.currentTarget.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              disabled={className.trim() === practice.className}
            >
              {t("saveClass")}
            </Button>
          </form>
          {saved("enrolment")}
        </PracticeSection>
      )}
      <PracticeSection section="chat">
        <CourseMessages messages={practice.messages} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            change(
              {
                messages: [
                  ...practice.messages,
                  { role, text: message.trim() },
                ],
              },
              "chat",
            );
            setMessage("");
          }}
        >
          <Field id="demo-staff-message" label={t("chatMessage")}>
            <textarea
              id="demo-staff-message"
              value={message}
              maxLength={280}
              onChange={(event) => setMessage(event.currentTarget.value)}
            />
          </Field>
          <Button type="submit" disabled={!message.trim()}>
            {t("chatSend")}
          </Button>
        </form>
        {saved("chat")}
      </PracticeSection>
    </div>
  );
}
