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
import {
  courseCloseoutFollowupSchema,
  trainingEscalationDetailSchema,
} from "./course-closeout-schema";

type Task = z.infer<typeof courseCloseoutFollowupSchema>;
type State = Exclude<Task["state"], "cancelled">;

function Followup({
  taskId,
  escalation,
}: {
  taskId: string;
  escalation: boolean;
}) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const online = useOnline();
  const actor = useAuth().session!.user.id;
  const client = useQueryClient();
  const key = ["course-closeout-followup", actor, taskId, escalation];
  const schema = courseCloseoutFollowupSchema.extend({
    description: trainingEscalationDetailSchema.shape.description.optional(),
  });
  const query = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc(
          escalation
            ? "training_escalation_detail"
            : "course_closeout_followup",
          { p_task_id: taskId },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return schema.parse(data);
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
        escalation
          ? "set_training_escalation_state"
          : "set_course_closeout_followup_state",
        {
          p_task_id: taskId,
          p_state: state,
          p_version: version,
        },
      );
      if (error) throw error;
      return schema.parse(data);
    },
    onSuccess: (task) => {
      client.setQueryData(key, task);
      void client.invalidateQueries({
        queryKey: escalation ? ["training-control"] : ["course-closeout"],
      });
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
        {task.description && <p>{task.description}</p>}
        <Link
          to={
            escalation
              ? `/courses?run=${task.course_run_id}`
              : `/courses/${task.course_run_id}/workspace#course-closeout`
          }
        >
          {escalation
            ? de
              ? "Zum Kurs"
              : "Open course"
            : de
              ? "Zum Kursabschluss"
              : "Open course closeout"}
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
  const escalation = params.has("escalation");
  const task = z
    .uuid()
    .safeParse(params.get(escalation ? "escalation" : "task"));
  return task.success ? (
    <Followup
      key={`${task.data}:${escalation}`}
      taskId={task.data}
      escalation={escalation}
    />
  ) : (
    <Navigate to="/" replace />
  );
}
