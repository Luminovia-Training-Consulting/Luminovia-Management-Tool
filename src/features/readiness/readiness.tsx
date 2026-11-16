import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ClipboardCheck,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { DocumentAttachment } from "../files/document-attachment";
import { useOnline } from "../../lib/online";
import { dateTime, zonedInstant } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
  TextLink,
} from "../../components/common";
import {
  acknowledgeCourseInstructions,
  completeReadinessTask,
  confirmCourseSessions,
  meetingHref,
  readinessQuery,
  refreshReadiness,
  saveReadinessSettings,
  saveReadinessTask,
  type CourseReadiness,
  type ReadinessTask,
} from "./api";
import "./i18n";
import "./readiness.css";

const flags = [
  "materials_required",
  "customer_required",
  "contact_required",
  "agreement_required",
  "instructions_required",
] as const;
const settingsFormSchema = z.object({
  materials_required: z.boolean(),
  customer_required: z.boolean(),
  contact_required: z.boolean(),
  agreement_required: z.boolean(),
  instructions_required: z.boolean(),
  instructions: z.string().max(20000),
  meeting_url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => !v || Boolean(meetingHref(v))),
  preparation_deadline: z.string(),
});
const taskFormSchema = z.object({
  title: z.string().trim().min(1).max(500),
  responsible_user_id: z.string().uuid(),
  required: z.boolean(),
  due_at: z.string(),
  archived: z.boolean(),
});
function localTime(value: string | null, zone: string) {
  return value
    ? DateTime.fromISO(value).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
    : "";
}
function useRequestKey() {
  const current = useRef<{ payload: string; id: string } | null>(null);
  return (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    if (current.current?.payload !== serialized)
      current.current = { payload: serialized, id: crypto.randomUUID() };
    return current.current!.id;
  };
}
function WriteError({ error }: { error: unknown }) {
  const { t } = useTranslation("readiness");
  const stale = Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "40001",
  );
  return <Notice kind="error">{t(stale ? "stale" : "error")}</Notice>;
}
function Status({ value }: { value: CourseReadiness["status"] }) {
  const { t } = useTranslation("readiness");
  return (
    <span className={`readiness-status readiness-status-${value}`}>
      {value === "ready" || value === "completed" ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <CircleAlert size={16} aria-hidden="true" />
      )}
      {t(value)}
    </span>
  );
}
function Progress({ course }: { course: CourseReadiness }) {
  const { t } = useTranslation("readiness");
  return (
    <div className="readiness-progress">
      <div>
        <strong>{t("percent", { value: course.percentage })}</strong>
        <span>
          {t("progress", {
            complete: course.completed_count,
            total: course.applicable_count,
          })}
        </span>
      </div>
      <progress
        max={100}
        value={course.percentage}
        aria-label={t("percent", { value: course.percentage })}
      />
    </div>
  );
}
function Action({
  children,
  write,
  disabled = false,
}: {
  children: string;
  write: (request: string) => Promise<string>;
  disabled?: boolean;
}) {
  const { t } = useTranslation("readiness");
  const online = useOnline();
  const client = useQueryClient();
  const [request] = useState(() => crypto.randomUUID());
  const mutation = useMutation({
    mutationFn: () => write(request),
    onSuccess: () => refreshReadiness(client),
  });
  return (
    <div className="readiness-action">
      <Button
        variant="secondary"
        disabled={disabled || !online || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {children}
      </Button>
      {mutation.isError && <WriteError error={mutation.error} />}{" "}
      {mutation.isSuccess && <Notice>{t("saved")}</Notice>}
    </div>
  );
}
function SettingsForm({
  course,
  onDone,
}: {
  course: CourseReadiness;
  onDone: () => void;
}) {
  const { t } = useTranslation("readiness");
  const client = useQueryClient();
  const online = useOnline();
  const request = useRequestKey();
  const [timeError, setTimeError] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof settingsFormSchema>>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: {
      ...course.settings,
      preparation_deadline: localTime(
        course.settings.preparation_deadline,
        course.time_zone,
      ),
    },
  });
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof settingsFormSchema>) => {
      setTimeError(false);
      const deadline = values.preparation_deadline
        ? zonedInstant(values.preparation_deadline, course.time_zone)
        : null;
      if (values.preparation_deadline && !deadline) {
        setTimeError(true);
        throw new Error("invalid_time");
      }
      const payload = { ...values, preparation_deadline: deadline };
      return saveReadinessSettings(
        course.id,
        payload,
        course.settings.version,
        request(payload),
      );
    },
    onSuccess: async () => {
      await refreshReadiness(client);
      onDone();
    },
  });
  return (
    <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))}>
      <p className="muted">{t("policyHint")}</p>
      <fieldset className="readiness-options">
        <legend>{t("settings")}</legend>
        {flags.map((flag) => (
          <label key={flag} className="checkbox-label">
            <input type="checkbox" {...register(flag)} />
            {t(flag)}
          </label>
        ))}
      </fieldset>
      <Field
        id="readiness-meeting"
        label={t("meeting")}
        error={Boolean(errors.meeting_url)}
      >
        <input id="readiness-meeting" type="url" {...register("meeting_url")} />
      </Field>
      <Field
        id="readiness-deadline"
        label={t("deadline")}
        hint={t("deadlineHint", { zone: course.time_zone })}
        error={Boolean(errors.preparation_deadline) || timeError}
      >
        <input
          id="readiness-deadline"
          type="datetime-local"
          {...register("preparation_deadline")}
        />
      </Field>
      <Field
        id="readiness-instructions"
        label={t("instructions")}
        error={Boolean(errors.instructions)}
      >
        <textarea
          id="readiness-instructions"
          rows={7}
          {...register("instructions")}
        />
      </Field>
      <div className="readiness-controls">
        <Button disabled={!online || save.isPending}>{t("save")}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
      {save.isError && <WriteError error={save.error} />}
    </form>
  );
}
function TaskForm({
  course,
  task,
  onDone,
}: {
  course: CourseReadiness;
  task: ReadinessTask | null;
  onDone: () => void;
}) {
  const { t } = useTranslation("readiness");
  const client = useQueryClient();
  const online = useOnline();
  const request = useRequestKey();
  const [timeError, setTimeError] = useState(false);
  const people = Array.from(
    new Map(
      [
        ...course.responsible_people,
        ...(task
          ? [
              {
                id: task.responsible_user_id,
                display_name: task.responsible_name,
              },
            ]
          : []),
      ].map((person) => [person.id, person]),
    ).values(),
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof taskFormSchema>>({
    resolver: zodResolver(taskFormSchema),
    defaultValues: {
      title: task?.title ?? "",
      responsible_user_id: task?.responsible_user_id ?? people[0]?.id ?? "",
      required: task?.required ?? true,
      due_at: localTime(task?.due_at ?? null, course.time_zone),
      archived: false,
    },
  });
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof taskFormSchema>) => {
      setTimeError(false);
      const due = values.due_at
        ? zonedInstant(values.due_at, course.time_zone)
        : null;
      if (values.due_at && !due) {
        setTimeError(true);
        throw new Error("invalid_time");
      }
      const payload = { ...values, due_at: due };
      return saveReadinessTask(
        course.id,
        task?.id ?? null,
        payload,
        task?.version ?? 0,
        request(payload),
      );
    },
    onSuccess: async () => {
      await refreshReadiness(client);
      onDone();
    },
  });
  return (
    <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))}>
      <Field
        id="readiness-task-title"
        label={t("taskTitle")}
        error={Boolean(errors.title)}
      >
        <input id="readiness-task-title" {...register("title")} />
      </Field>
      <Field
        id="readiness-task-owner"
        label={t("taskOwner")}
        error={Boolean(errors.responsible_user_id)}
      >
        <select id="readiness-task-owner" {...register("responsible_user_id")}>
          {people.map((person) => (
            <option value={person.id} key={person.id}>
              {person.display_name}
            </option>
          ))}
        </select>
      </Field>
      <Field
        id="readiness-task-due"
        label={t("taskDue")}
        hint={t("deadlineHint", { zone: course.time_zone })}
        error={Boolean(errors.due_at) || timeError}
      >
        <input
          id="readiness-task-due"
          type="datetime-local"
          {...register("due_at")}
        />
      </Field>
      <label className="checkbox-label">
        <input type="checkbox" {...register("required")} />
        {t("required")}
      </label>
      {task && (
        <label className="checkbox-label">
          <input type="checkbox" {...register("archived")} />
          {t("archiveTask")}
        </label>
      )}
      <div className="readiness-controls">
        <Button disabled={!online || save.isPending}>{t("save")}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
      {save.isError && <WriteError error={save.error} />}
    </form>
  );
}
function CourseDetail({
  course,
  actor,
}: {
  course: CourseReadiness;
  actor: string;
}) {
  const { t, i18n } = useTranslation("readiness");
  const online = useOnline();
  const [settingsEdit, setSettingsEdit] = useState<CourseReadiness>();
  const [taskEdit, setTaskEdit] = useState<{
    course: CourseReadiness;
    task: ReadinessTask | null;
  }>();
  const href = meetingHref(course.meeting_url);
  const ownReceipt = course.lecturers.find(
    (person) => person.id === actor,
  )?.acknowledged;
  return (
    <>
      <div className="readiness-detail-header panel">
        <Status value={course.status} />
        <Progress course={course} />
        <p className="muted">{t("missingHelp")}</p>
        {course.settings.preparation_deadline && (
          <p>
            <strong>{t("deadline")}: </strong>
            {dateTime(
              course.settings.preparation_deadline,
              i18n.language,
              course.time_zone,
            )}
          </p>
        )}
        <p className="muted">
          {t("asOf", {
            date: dateTime(course.as_of, i18n.language, course.time_zone),
          })}
        </p>
      </div>
      <div className="readiness-detail-grid">
        <section
          className="panel readiness-checklist"
          aria-label={t("checklist")}
        >
          <div className="section-heading">
            <h2>{t("checklist")}</h2>
            <ClipboardCheck aria-hidden="true" />
          </div>
          <ul>
            {course.checks.map((check) => (
              <li
                key={check.code}
                className={
                  check.applicable && !check.complete
                    ? "readiness-check-missing"
                    : ""
                }
              >
                <div className="readiness-check-label">
                  <span
                    className={`readiness-check-icon ${check.applicable && check.complete ? "readiness-check-ok" : ""}`}
                    aria-hidden="true"
                  >
                    {check.applicable && check.complete ? (
                      <Check size={18} />
                    ) : check.applicable ? (
                      <CircleAlert size={18} />
                    ) : (
                      "—"
                    )}
                  </span>
                  <div>
                    <strong>{t(`requirements.${check.code}`)}</strong>
                    <small>
                      {t("responsible", { name: t(check.responsible) })}
                    </small>
                  </div>
                </div>
                <div className="readiness-check-result">
                  <span>
                    {t(
                      !check.applicable
                        ? "notApplicable"
                        : check.complete
                          ? "complete"
                          : "missing",
                    )}
                  </span>
                  {check.applicable && !check.complete && check.href && (
                    <Link
                      to={check.href}
                      aria-label={`${t("openRequirement")}: ${t(`requirements.${check.code}`)}`}
                    >
                      <ArrowRight size={18} aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="muted">{t("sessionsHint")}</p>
          {course.can_manage && !course.settings.sessions_confirmed && (
            <Action
              key={`confirm-${course.settings.version}`}
              write={(request) =>
                confirmCourseSessions(
                  course.id,
                  course.settings.version,
                  request,
                )
              }
            >
              {t("confirmSessions")}
            </Action>
          )}
          {course.can_manage && (
            <Button
              variant="secondary"
              disabled={!online}
              onClick={() => setSettingsEdit(course)}
            >
              {t("editSettings")}
            </Button>
          )}
        </section>
        <aside className="readiness-context">
          <section className="panel">
            <h2>{t(course.delivery_type)}</h2>
            {course.starts_at ? (
              <p>
                {dateTime(course.starts_at, i18n.language, course.time_zone)}
                {course.ends_at && (
                  <>
                    {" "}
                    —{" "}
                    {dateTime(course.ends_at, i18n.language, course.time_zone)}
                  </>
                )}
              </p>
            ) : (
              <p className="muted">{t("noDate")}</p>
            )}
            <p className="muted">{course.time_zone}</p>
            {course.venue && (
              <p>
                <strong>{t("venue")}: </strong>
                {course.venue}
              </p>
            )}
            {href && (
              <a
                className="text-link"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("meetingOpen")}
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            )}
            <TextLink to={`/courses?run=${course.id}`}>{t("detail")}</TextLink>
          </section>
          <section className="panel">
            <h2>{t("documents")}</h2>
            {course.documents.length ? (
              <ul className="readiness-documents">
                {course.documents.map((document) => (
                  <li key={document.id}>
                    <DocumentAttachment documentId={document.id} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t("noDocuments")}</p>
            )}
            <TextLink to="/files">{t("openFiles")}</TextLink>
          </section>
          {course.jobs.length > 0 && (
            <section className="panel">
              <h2>{t("jobs")}</h2>
              <ul className="readiness-documents">
                {course.jobs.map((job) => (
                  <li key={job.id}>
                    <Link to={`/jobs/${job.id}`}>{job.title}</Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
      <section
        className="panel readiness-instructions"
        aria-label={t("instructions")}
      >
        <h2>
          {t("instructionsVersion", {
            version: course.settings.instruction_version,
          })}
        </h2>
        <p className="readiness-authored">
          {course.settings.instructions || t("noInstructions")}
        </p>
        <h3>{t("people")}</h3>
        <ul className="readiness-people">
          {course.lecturers.map((person) => (
            <li key={person.id}>
              <span>{person.display_name}</span>
              <span>
                {t(person.acknowledged ? "acknowledged" : "awaiting")}
              </span>
            </li>
          ))}
        </ul>
        {course.can_acknowledge &&
          Boolean(course.settings.instructions) &&
          !ownReceipt && (
            <>
              <p className="muted">{t("acknowledgeHint")}</p>
              <Action
                key={`ack-${course.settings.instruction_version}`}
                write={(request) =>
                  acknowledgeCourseInstructions(
                    course.id,
                    course.settings.instruction_version,
                    request,
                  )
                }
              >
                {t("acknowledge")}
              </Action>
            </>
          )}
      </section>
      <section className="panel readiness-tasks" aria-label={t("tasks")}>
        <div className="section-heading">
          <h2>{t("tasks")}</h2>
          {course.can_manage && (
            <Button
              variant="secondary"
              disabled={!online}
              onClick={() => setTaskEdit({ course, task: null })}
            >
              {t("newTask")}
            </Button>
          )}
        </div>
        {course.tasks.length ? (
          <ul>
            {course.tasks.map((task) => (
              <li key={task.id}>
                <div>
                  <h3>{task.title}</h3>
                  <p className="muted">
                    {t("responsible", { name: task.responsible_name })} ·{" "}
                    {t(task.required ? "required" : "optional")}
                  </p>
                  <p>
                    {task.due_at
                      ? `${t("taskDue")}: ${dateTime(task.due_at, i18n.language, course.time_zone)}`
                      : t("noDeadline")}
                  </p>
                  {task.completed_at && (
                    <p>
                      {t("doneAt", {
                        date: dateTime(
                          task.completed_at,
                          i18n.language,
                          course.time_zone,
                        ),
                      })}
                    </p>
                  )}
                </div>
                <div className="readiness-controls">
                  {task.can_complete && (
                    <Action
                      key={`${task.id}-${task.version}`}
                      write={(request) =>
                        completeReadinessTask(
                          task.id,
                          !task.completed_at,
                          task.version,
                          request,
                        )
                      }
                    >
                      {t(task.completed_at ? "reopenTask" : "markComplete")}
                    </Action>
                  )}
                  {course.can_manage && (
                    <Button
                      variant="ghost"
                      disabled={!online}
                      onClick={() => setTaskEdit({ course, task })}
                    >
                      {t("editTask")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("noTasks")}</p>
        )}
      </section>
      <p className="muted readiness-completion-hint">{t("completionHint")}</p>
      <Dialog
        open={Boolean(settingsEdit)}
        onOpenChange={(value) => {
          if (!value) setSettingsEdit(undefined);
        }}
        title={t("settings")}
        description={t("policyHint")}
      >
        {settingsEdit && (
          <SettingsForm
            course={settingsEdit}
            onDone={() => setSettingsEdit(undefined)}
          />
        )}
      </Dialog>
      <Dialog
        open={Boolean(taskEdit)}
        onOpenChange={(value) => {
          if (!value) setTaskEdit(undefined);
        }}
        title={t(taskEdit?.task ? "editTask" : "newTask")}
        description={t("sessionsHint")}
      >
        {taskEdit && (
          <TaskForm
            course={taskEdit.course}
            task={taskEdit.task}
            onDone={() => setTaskEdit(undefined)}
          />
        )}
      </Dialog>
    </>
  );
}
function Overview({ courses }: { courses: CourseReadiness[] }) {
  const { t, i18n } = useTranslation("readiness");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [past, setPast] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const now = Math.max(
    openedAt,
    ...courses.map((course) => Date.parse(course.as_of)),
  );
  const filtered = courses.filter(
    (course) =>
      (past || !course.ends_at || Date.parse(course.ends_at) >= now) &&
      (!status || status === course.status) &&
      [course.title, course.organisation_name]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <section className="panel readiness-filters">
        <Field id="readiness-search" label={t("search")}>
          <input
            type="search"
            id="readiness-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field id="readiness-filter" label={t("filter")}>
          <select
            id="readiness-filter"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">{t("all")}</option>
            {(
              ["ready", "attention_required", "blocked", "completed"] as const
            ).map((value) => (
              <option key={value} value={value}>
                {t(value)}
              </option>
            ))}
          </select>
        </Field>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={past}
            onChange={(event) => setPast(event.target.checked)}
          />
          {t("includePast")}
        </label>
      </section>
      {!courses.length ? (
        <section className="panel">
          <p>{t("empty")}</p>
        </section>
      ) : !filtered.length ? (
        <section className="panel">
          <p>{t("noMatches")}</p>
        </section>
      ) : (
        <div className="readiness-cards">
          {filtered.map((course) => (
            <article className="panel readiness-card" key={course.id}>
              <div className="section-heading">
                <ClipboardCheck className="blue" aria-hidden="true" />
                <Status value={course.status} />
              </div>
              <h2>
                <Link to={`/readiness/${course.id}`}>{course.title}</Link>
              </h2>
              <p className="muted">
                {course.organisation_name ?? t("noCustomer")}
              </p>
              <p>
                {course.starts_at
                  ? dateTime(course.starts_at, i18n.language, course.time_zone)
                  : t("noDate")}
              </p>
              <Progress course={course} />
              <ul className="readiness-missing-preview">
                {course.checks
                  .filter((check) => check.applicable && !check.complete)
                  .slice(0, 3)
                  .map((check) => (
                    <li key={check.code}>{t(`requirements.${check.code}`)}</li>
                  ))}
              </ul>
              {course.settings.preparation_deadline && (
                <p className="muted">
                  {t("deadline")}:{" "}
                  {dateTime(
                    course.settings.preparation_deadline,
                    i18n.language,
                    course.time_zone,
                  )}
                </p>
              )}
              <TextLink to={`/readiness/${course.id}`}>{t("detail")}</TextLink>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
export function CourseReadinessPage() {
  const { t } = useTranslation("readiness");
  const { session } = useAuth();
  const { id } = useParams<{ id: string }>();
  const valid = !id || z.string().uuid().safeParse(id).success;
  const online = useOnline();
  const courses = useQuery({
    ...readinessQuery(session!.user.id, id),
    enabled: valid,
  });
  const course = courses.data?.[0];
  if (!valid || courses.isError)
    return <ErrorState retry={() => void courses.refetch()} />;
  if (courses.isPending) return <Loading />;
  if (id && !course) return <ErrorState retry={() => void courses.refetch()} />;
  return (
    <>
      <PageHeading
        title={id ? course!.title : t("title")}
        description={t("intro")}
        action={
          <Button
            variant="secondary"
            disabled={!online || courses.isFetching}
            onClick={() => void courses.refetch()}
          >
            <RefreshCw size={17} aria-hidden="true" />
            {t("refresh")}
          </Button>
        }
      />
      {!online && <Notice kind="error">{t("offline")}</Notice>}
      {id && (
        <Link className="text-link readiness-back" to="/readiness">
          <ArrowLeft size={16} aria-hidden="true" />
          {t("overview")}
        </Link>
      )}
      {id ? (
        <CourseDetail course={course!} actor={session!.user.id} />
      ) : (
        <Overview courses={courses.data} />
      )}
    </>
  );
}
