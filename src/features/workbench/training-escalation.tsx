/** File a time-bound operations task for the reviewed training exception. */
import { useId, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { zonedInstant } from "../../lib/dates";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import type { FinancePeriod } from "./finance-api";
import {
  type TrainingIssue,
  trainingEscalationSchema,
} from "./training-control-schema";

const assignees = z.object({
  assignees: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export default function TrainingEscalation({
  actor,
  issue,
  period,
  zone,
  organisation,
  topic,
  close,
  refresh,
}: {
  actor: string;
  issue: TrainingIssue;
  period: FinancePeriod;
  zone: string;
  organisation: string;
  topic: string;
  close: () => void;
  refresh: () => void;
}) {
  const { t } = useTranslation("trainingControl");
  const id = useId();
  const [now] = useState(Date.now);
  const online = useOnline();
  const [assignee, setAssignee] = useState(actor);
  const [deadline, setDeadline] = useState("");
  const [reason, setReason] = useState("");
  const options = useQuery({
    queryKey: ["training-escalation-assignees", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("work_tasks", { p_limit: 1 })
        .abortSignal(signal);
      if (error) throw error;
      return assignees.parse(data).assignees;
    },
  });
  const due = deadline ? zonedInstant(deadline, zone) : null;
  const valid =
    due &&
    Date.parse(due) > now &&
    Date.parse(due) <= Date.parse(issue.starts_at) &&
    reason.trim().length >= 3;
  const create = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("escalate_training_issue", {
        p_run_id: issue.run_id,
        p_issue: issue.code,
        p_fingerprint: issue.fingerprint,
        p_from: period.from,
        p_until: period.until,
        p_assignee_id: assignee,
        p_due_at: due,
        p_reason: reason.trim(),
        p_organisation_id: organisation || null,
        p_topic_id: topic || null,
      });
      if (error) throw error;
      return trainingEscalationSchema.parse(data);
    },
    onSuccess: () => {
      refresh();
      close();
    },
  });
  return (
    <Dialog
      open
      title={t("escalate")}
      description={t("escalateHelp", { title: issue.title })}
      closeDisabled={create.isPending}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {options.isPending && <Loading />}
      {options.isError && <ErrorState retry={() => void options.refetch()} />}
      {options.data && (
        <form
          className="section-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && online) create.mutate();
          }}
        >
          <div className="form-row">
            <Field id={`${id}-staff`} label={t("escalationAssignee")}>
              <select
                id={`${id}-staff`}
                value={assignee}
                required
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">{t("selectAssignee")}</option>
                {options.data.map((staff) => (
                  <option key={staff.id} value={staff.id}>
                    {staff.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-due`} label={t("escalationDue", { zone })}>
              <input
                id={`${id}-due`}
                type="datetime-local"
                value={deadline}
                required
                onChange={(event) => setDeadline(event.target.value)}
              />
            </Field>
          </div>
          <Field id={`${id}-reason`} label={t("escalationReason")}>
            <textarea
              id={`${id}-reason`}
              maxLength={1000}
              rows={3}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {deadline &&
            (!due ||
              Date.parse(due) > Date.parse(issue.starts_at) ||
              Date.parse(due) <= now) && (
              <Notice kind="error">{t("escalationDueError")}</Notice>
            )}
          {create.isError && (
            <Notice kind="error">{t("escalationError")}</Notice>
          )}
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={create.isPending}
              onClick={close}
            >
              {t("cancelEscalation")}
            </Button>
            <Button
              type="submit"
              disabled={
                !online ||
                !valid ||
                !options.data.some((staff) => staff.id === assignee) ||
                create.isPending
              }
            >
              {t("escalate")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
