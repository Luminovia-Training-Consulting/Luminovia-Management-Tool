import { useId, useState, type MouseEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { db } from "../../lib/supabase";
import type { Claim } from "../../lib/types";
import { refreshJobState } from "./lifecycle-api";
import "./sick-day-i18n";

const receipt = z.object({
  job_id: z.uuid(),
  released_sessions: z.number().int().positive(),
  teaching_date: z.iso.date(),
});

export function JobSickDay({ claim, zone }: { claim: Claim; zone: string }) {
  const { t, i18n } = useTranslation("sickDay");
  const navigate = useNavigate();
  const client = useQueryClient();
  const online = useOnline();
  const dayId = useId();
  const retry = useRequestKey();
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [selected, setSelected] = useState("");
  const days = new Map<string, { id: string; label: string }>();
  for (const session of claim.assignment_sessions) {
    if (session.released_at || Date.parse(session.starts_at) <= now) continue;
    const local = DateTime.fromISO(session.starts_at, { zone });
    const date = local.toISODate();
    if (date && !days.has(date))
      days.set(date, {
        id: session.id,
        label: local
          .setLocale(i18n.language)
          .toLocaleString(DateTime.DATE_HUGE),
      });
  }
  const dates = [...days.keys()].sort();
  const session = days.get(selected);
  const report = useMutation({
    mutationFn: async (sessionId: string) => {
      requireOnline();
      const { data, error } = await db().rpc("report_assignment_sick_day", {
        p_claim_id: claim.id,
        p_session_id: sessionId,
        p_request_id: retry.forInput(sessionId),
      });
      if (error) throw error;
      return receipt.parse(data);
    },
    onSuccess: () => {
      void refreshJobState(client);
      navigate("/jobs", { state: { sickDayReleased: true } });
    },
  });

  const needsReview =
    report.error &&
    "message" in report.error &&
    report.error.message === "emergency_financial_review_required";

  function open(event: MouseEvent<HTMLButtonElement>) {
    setTrigger(event.currentTarget);
    setNow(Date.now());
    setDialogOpen(true);
    setSelected(dates[0] ?? "");
    report.reset();
  }

  if (!dates.length && !dialogOpen) return null;
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={!online}
        onClick={open}
      >
        {t("report")}
      </Button>
      <Dialog
        open={dialogOpen}
        title={t("report")}
        description={t("help")}
        returnFocusTo={trigger}
        closeDisabled={report.isPending}
        onOpenChange={(value) => {
          if (!value && !report.isPending) setDialogOpen(false);
        }}
      >
        <form
          className="job-life-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (session) report.mutate(session.id);
          }}
        >
          <Field id={dayId} label={t("day")}>
            <select
              id={dayId}
              value={selected}
              disabled={report.isPending}
              onChange={(event) => setSelected(event.target.value)}
            >
              {dates.map((date) => (
                <option key={date} value={date}>
                  {days.get(date)?.label}
                </option>
              ))}
            </select>
          </Field>
          {report.isError && (
            <Notice kind="error">
              {t(needsReview ? "financialReview" : "failed")}
            </Notice>
          )}
          <div className="form-actions">
            <Button
              type="submit"
              disabled={!session || !online || report.isPending}
            >
              {t("confirm")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={report.isPending}
              onClick={() => setDialogOpen(false)}
            >
              {t("cancel")}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
