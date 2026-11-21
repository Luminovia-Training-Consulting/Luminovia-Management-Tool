/** Resolve real course relationships using fresh server resource authority. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { ErrorState, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";

import { courseDestinationsSchema } from "./destinations-schema";

export function CourseDestinations({
  actor,
  courseId,
  learner = false,
}: {
  actor: string;
  courseId: string;
  learner?: boolean;
}) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const query = useQuery({
    queryKey: ["course-operation-destinations", actor, courseId],
    retry: false,
    refetchInterval: 15000,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_operation_destinations", { p_run_id: courseId })
        .abortSignal(signal);
      if (error) throw error;
      return courseDestinationsSchema.parse(data);
    },
  });
  return (
    <section className="panel learning-panel">
      <h2>{de ? "Unternehmen & Lehrteam" : "Company & teaching team"}</h2>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          <dl className="course-relationship-details">
            <dt>{de ? "Unternehmen" : "Company"}</dt>
            <dd>{query.data.organisation?.name ?? "—"}</dd>
            <dt>{de ? "Zugewiesene Dozent:innen" : "Assigned lecturers"}</dt>
            <dd>{query.data.lecturers.map((p) => p.name).join(", ") || "—"}</dd>
          </dl>
          {!learner && (
            <>
              <h3>{de ? "Kurs-Chat" : "Course chat"}</h3>
              {query.data.rooms.length ? (
                query.data.rooms.map((room) => (
                  <Button key={room.id} asChild variant="secondary">
                    <Link to={`/chats?room=${room.id}`}>
                      {room.name ||
                        (de ? "Kurs-Chat öffnen" : "Open course chat")}
                    </Link>
                  </Button>
                ))
              ) : (
                <p>
                  {de
                    ? "Kein Kurs-Chat für dein Konto freigegeben."
                    : "No course chat is available to your account."}
                </p>
              )}
              <h3>{de ? "Aufträge & Änderungen" : "Assignments & changes"}</h3>
              {query.data.jobs.length ? (
                query.data.jobs.map((job) => (
                  <Button key={job.id} asChild variant="secondary">
                    <Link to={`/jobs/${job.id}`}>{job.title}</Link>
                  </Button>
                ))
              ) : (
                <p>
                  {de
                    ? "Keine Aufträge für dein Konto freigegeben."
                    : "No assignments are available to your account."}
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
