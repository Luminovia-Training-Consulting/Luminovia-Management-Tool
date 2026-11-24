import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { closeoutCopy } from "./course-closeout-i18n";
import { courseCloseoutFollowupSchema } from "./course-closeout-schema";

type Task = z.infer<typeof courseCloseoutFollowupSchema>;
type State = Exclude<Task["state"], "cancelled">;

function Followup({ taskId }: { taskId: string }) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const online = useOnline();
  const actor = useAuth().session!.user.id;
  const client = useQueryClient();
  const key = ["course-closeout-followup", actor, taskId];
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_closeout_followup", { p_task_id: taskId }, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return courseCloseoutFollowupSchema.parse(data);
    },
    retry: false,
  });
  const save = useMutation({
    mutationFn: async ({
      version,
      state,
    }: {
      version: number;
      state: State;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "set_course_closeout_followup_state",
        {
          p_task_id: taskId,
          p_state: state,
          p_version: version,
        },
      );
      if (error) throw error;
      return courseCloseoutFollowupSchema.parse(data);
    },
    onSuccess: (task) => {
      client.setQueryData(key, task);
      void client.invalidateQueries({ queryKey: ["course-closeout"] });
    },
  });

  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const task = query.data;
  const labels = closeoutCopy[de ? "de" : "en"];
  const actions = de
    ? {
        open: "Wieder öffnen",
        doing: "In Arbeit nehmen",
        done: "Als erledigt markieren",
      }
    : { open: "Reopen", doing: "Start work", done: "Mark complete" };
  return (
    <>
      <PageHeading title={task.title} />
      <section className="panel stack">
        <p>
          <strong>{labels[task.state]}</strong>
        </p>
        {task.due_at && (
          <p>
            {de ? "Fällig am" : "Due"}{" "}
            {dateTime(task.due_at, i18n.language, task.time_zone)}
          </p>
        )}
        <Link to={`/courses/${task.course_run_id}/workspace#course-closeout`}>
          {de ? "Zum Kursabschluss" : "Open course closeout"}
        </Link>
        {save.isError && (
          <ErrorState
            retry={() => {
              save.reset();
              void query.refetch();
            }}
          />
        )}
        {save.isSuccess && (
          <Notice kind="success">
            {de ? "Status gespeichert." : "Status saved."}
          </Notice>
        )}
        {task.can_update && (
          <div className="page-actions">
            {(["open", "doing", "done"] as const)
              .filter((state) => state !== task.state)
              .map((state) => (
                <Button
                  type="button"
                  variant="secondary"
                  key={state}
                  disabled={!online || save.isPending}
                  onClick={() => save.mutate({ version: task.version, state })}
                >
                  {actions[state]}
                </Button>
              ))}
          </div>
        )}
      </section>
    </>
  );
}

export function CourseCloseoutFollowupRoute() {
  const [params] = useSearchParams();
  const task = z.uuid().safeParse(params.get("task"));
  return task.success ? (
    <Followup key={task.data} taskId={task.data} />
  ) : (
    <Navigate to="/" replace />
  );
}
