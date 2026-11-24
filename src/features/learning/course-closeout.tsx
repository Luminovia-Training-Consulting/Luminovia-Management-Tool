import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Field, ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { useOnline, requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  courseCloseoutKind,
  courseCloseoutRequest,
  courseCloseoutResponse,
} from "./course-closeout-schema";

type Review = z.infer<typeof courseCloseoutResponse>;
type Kind = z.infer<typeof courseCloseoutKind>;

const copy = {
  de: {
    title: "Kursabschluss",
    intro:
      "Prüfe die Nachweise und weise offene Nacharbeiten zu. Die Aufgaben erscheinen im Arbeitsbereich der zuständigen Personen.",
    attendance: "Fehlende Anwesenheitseinträge",
    grade: "Fehlende Prüfungsbewertungen",
    submission: "Fehlende Kursabgaben",
    none: "Alle erforderlichen Nachweise sind vorhanden.",
    assignee: "Verantwortliche Person",
    choose: "Bitte auswählen",
    write: "Kursabschluss bestätigen",
    confirmed: "Abschluss bestätigt",
    error:
      "Der Abschluss wurde nicht bestätigt. Prüfe den aktuellen Stand und versuche es erneut.",
    open: "Offen",
    doing: "In Arbeit",
    done: "Erledigt",
    cancelled: "Abgebrochen",
  },
  en: {
    title: "Course closeout",
    intro:
      "Review the evidence and assign outstanding follow-up. Tasks appear in the workspace of the responsible staff.",
    attendance: "Missing attendance records",
    grade: "Missing assessment results",
    submission: "Missing course submissions",
    none: "All required evidence is present.",
    assignee: "Responsible person",
    choose: "Select a person",
    write: "Confirm course closeout",
    confirmed: "Closeout confirmed",
    error:
      "Closeout was not confirmed. Review the current records and try again.",
    open: "Open",
    doing: "In progress",
    done: "Completed",
    cancelled: "Cancelled",
  },
};

function CloseoutReview({
  review,
  run,
  actor,
  zone,
}: {
  review: Review;
  run: string;
  actor: string;
  zone: string;
}) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const words = copy[language.startsWith("de") ? "de" : "en"];
  const id = useId();
  const online = useOnline();
  const cache = useQueryClient();
  const key = ["course-closeout", actor, run];
  const [assignees, setAssignees] = useState<Partial<Record<Kind, string>>>({});
  const outstanding = courseCloseoutKind.options.filter((kind) =>
    review.items.some((item) => item.kind === kind),
  );
  const displayed = courseCloseoutKind.options.filter(
    (kind) => outstanding.includes(kind) || review.followups[kind],
  );
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const args = courseCloseoutRequest.parse({
        p_course_run_id: run,
        p_review_token: review.review_token,
        p_assignees: Object.fromEntries(
          outstanding.map((kind) => [kind, assignees[kind]]),
        ),
      });
      const { data, error } = await db().rpc("confirm_course_closeout", args);
      if (error) throw error;
      return courseCloseoutResponse.parse(data);
    },
    onSuccess: (data) => {
      cache.setQueryData(key, data);
    },
  });
  return (
    <>
      <p>{words.intro}</p>
      {review.confirmed_at && (
        <Notice kind="success">
          {words.confirmed} · {dateTime(review.confirmed_at, language, zone)}
        </Notice>
      )}
      {outstanding.length === 0 && <p>{words.none}</p>}
      {displayed.map((kind) => {
        const items = review.items.filter((item) => item.kind === kind);
        const followup = review.followups[kind];
        const input = `${id}-${kind}`;
        return (
          <section key={kind} className="stack">
            <h3>
              {words[kind]} ({items.length})
            </h3>
            {items.length > 0 && (
              <ul>
                {items.map((item) => (
                  <li key={item.person_id + (item.session_id ?? "")}>
                    {item.person}
                    {item.session_start
                      ? " · " + dateTime(item.session_start, language, zone)
                      : ""}
                  </li>
                ))}
              </ul>
            )}
            {followup && (
              <Link to={`/workbench?task=${followup.task_id}`}>
                {followup.name} · {words[followup.state]}
              </Link>
            )}
            {items.length > 0 && !review.confirmed_at && review.can_close && (
              <Field id={input} label={words.assignee + " · " + words[kind]}>
                <select
                  id={input}
                  value={assignees[kind] ?? ""}
                  onChange={(event) =>
                    setAssignees({ ...assignees, [kind]: event.target.value })
                  }
                >
                  <option value="">{words.choose}</option>
                  {review.staff.map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </section>
        );
      })}
      {save.isError && <Notice kind="error">{words.error}</Notice>}
      {review.can_close && !review.confirmed_at && (
        <div className="page-actions">
          <Button
            type="button"
            disabled={
              !online ||
              save.isPending ||
              outstanding.some((kind) => !assignees[kind])
            }
            onClick={() => save.mutate()}
          >
            {words.write}
          </Button>
        </div>
      )}
    </>
  );
}

export function CourseCloseout({
  run,
  actor,
  zone,
}: {
  run: string;
  actor: string;
  zone: string;
}) {
  const { i18n } = useTranslation();
  const words = copy[i18n.language.startsWith("de") ? "de" : "en"];
  const review = useQuery({
    queryKey: ["course-closeout", actor, run],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_closeout", { p_course_run_id: run }, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return courseCloseoutResponse.parse(data);
    },
    refetchOnMount: "always",
    retry: false,
  });
  return (
    <section className="panel stack">
      <h2>{words.title}</h2>
      {review.isPending ? (
        <Loading />
      ) : review.isError ? (
        <ErrorState retry={() => void review.refetch()} />
      ) : (
        <CloseoutReview
          key={review.data.review_token}
          review={review.data}
          run={run}
          actor={actor}
          zone={zone}
        />
      )}
    </section>
  );
}
