import { useId, useState, type FormEvent } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseStartInput, courseStartResponse } from "./course-start-schema";
import "./i18n";

const labels = {
  ready: "startReady",
  pending: "startPending",
  overdue: "startOverdue",
  unscheduled: "startUnscheduled",
} as const;

type Plan = z.infer<typeof courseStartResponse>;
type Course = Plan["items"][number];

function courseStartQuery(actor: string, run?: string) {
  return queryOptions({
    queryKey: ["course-start", actor, run ?? "upcoming"],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_start_planning", run ? { p_course_run_id: run } : {}, {
          get: true,
        })
        .abortSignal(signal);
      if (error) throw error;
      return courseStartResponse.parse(data);
    },
    retry: false,
    refetchInterval: 30000,
  });
}

function CourseStartFacts({ course }: { course: Course }) {
  const { t, i18n } = useTranslation("readiness");
  return (
    <>
      <p>
        <strong>{t(labels[course.status])}</strong>
      </p>
      <dl className="commercial-facts">
        <dt>{t("startOwner")}</dt>
        <dd>{course.responsible ?? t("startUnassigned")}</dd>
        <dt>{t("startBackup")}</dt>
        <dd>{course.backup ?? t("management")}</dd>
        {course.deadline && (
          <>
            <dt>{t("startDeadline")}</dt>
            <dd>
              {dateTime(course.deadline, i18n.language, course.time_zone)}
            </dd>
          </>
        )}
      </dl>
      {course.missing.length > 0 && (
        <p>
          {t("startMissing", {
            items: course.missing
              .map((code) => t(`requirements.${code}`))
              .join(", "),
          })}
        </p>
      )}
    </>
  );
}

function ResponsibilityForm({
  course,
  staff,
}: {
  course: Course;
  staff: Plan["staff"];
}) {
  const { t } = useTranslation("readiness");
  const online = useOnline();
  const cache = useQueryClient();
  const id = useId();
  const [owner, setOwner] = useState(course.responsible_id ?? "");
  const [backup, setBackup] = useState(course.backup_id ?? "");
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const args = courseStartInput.parse({
        p_course_run_id: course.id,
        p_responsible: owner,
        p_backup: backup || null,
        p_version: course.version,
      });
      const { error } = await db().rpc("set_course_start_responsibility", args);
      if (error) throw error;
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: ["course-start"] }),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (online && owner && owner !== backup && !save.isPending) save.mutate();
  }
  return (
    <form className="stack" onSubmit={submit}>
      <Field id={id + "-owner"} label={t("startOwner")}>
        <select
          id={id + "-owner"}
          required
          value={owner}
          onChange={(event) => {
            const id = event.currentTarget.value;
            setOwner(id);
            if (id === backup) setBackup("");
          }}
        >
          <option value="">{t("startUnassigned")}</option>
          {staff.map((person) => (
            <option value={person.id} key={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </Field>
      <Field id={id + "-backup"} label={t("startBackup")}>
        <select
          id={id + "-backup"}
          value={backup}
          onChange={(event) => setBackup(event.currentTarget.value)}
        >
          <option value="">{t("management")}</option>
          {staff
            .filter((person) => person.id !== owner)
            .map((person) => (
              <option value={person.id} key={person.id}>
                {person.name}
              </option>
            ))}
        </select>
      </Field>
      {save.isError && <Notice kind="error">{t("startSaveError")}</Notice>}
      <div className="page-actions">
        <Button
          type="submit"
          disabled={
            !online ||
            !owner ||
            owner === backup ||
            save.isPending ||
            (owner === course.responsible_id &&
              (backup || null) === course.backup_id)
          }
        >
          {t("startSave")}
        </Button>
      </div>
    </form>
  );
}

export function CourseStartPanel({
  actor,
  run,
}: {
  actor: string;
  run?: string;
}) {
  const { t } = useTranslation("readiness");
  const query = useQuery(courseStartQuery(actor, run));
  const first = query.data?.items[0];
  return (
    <section className="panel" aria-label={t("courseStart")}>
      <h2>{t("courseStart")}</h2>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : run && first ? (
        <>
          <CourseStartFacts course={first} />
          {query.data.can_manage && (
            <ResponsibilityForm
              key={`${first.version}:${first.responsible_id}:${first.backup_id}`}
              course={first}
              staff={query.data.staff}
            />
          )}
        </>
      ) : query.data.items.length ? (
        <ul className="stack">
          {query.data.items.map((course) => (
            <li key={course.id}>
              <Link to={`/readiness/${course.id}`}>{course.title}</Link>
              <CourseStartFacts course={course} />
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("startNoOpen")}</p>
      )}
    </section>
  );
}
