/** Own waitlist interest and confirmed updates.
 * Redacted interest stays removable without exposing private offer metadata;
 * only confirmed server responses update identity-scoped cached membership.
 */
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import {
  myWaitlistQuery,
  setWaitlist,
  waitlistKey,
  waitlistQuery,
} from "./lifecycle-extra-api";
import "./lifecycle-extra-i18n";

/** Confirm one own-interest change before replacing its exact receipt and own list. */
function useWaitlistChange(actor: string, jobId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (join: boolean) => setWaitlist(jobId, join),
    onSuccess: (data) => {
      client.setQueryData(waitlistKey(actor, jobId), data);
      return client.invalidateQueries({ queryKey: ["my-job-waitlist", actor] });
    },
  });
}

export function JobWaitlist({ jobId }: { jobId: string }) {
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("jobExtra");
  const online = useOnline();
  const state = useQuery(waitlistQuery(actor, jobId));
  const change = useWaitlistChange(actor, jobId);
  if (
    !state.data ||
    state.isError ||
    (!state.data.joined && !state.data.can_join)
  )
    return null;
  return (
    <section className="panel" aria-label={t("waitlist")}>
      <h2>{t("waitlist")}</h2>
      <p>{state.data.title.trim() || t("waitlistUnavailable")}</p>
      <p>{t("waitlistHelp")}</p>
      {state.data.joined && <p>{t("joined")}</p>}
      {state.data.available && state.data.title.trim() && (
        <p>
          {t("available")} <Link to={`/jobs/${jobId}`}>{t("open")}</Link>
        </p>
      )}
      <Button
        variant="secondary"
        disabled={!online || change.isPending}
        onClick={() => change.mutate(!state.data.joined)}
      >
        {t(state.data.joined ? "leave" : "join")}
      </Button>
      {change.isError && <Notice kind="error">{t("error")}</Notice>}
    </section>
  );
}

/** Blank titles are an intentional privacy projection, never an empty job link. */
function OwnWaitlistInterest({
  actor,
  item,
}: {
  actor: string;
  item: { job_id: string; title: string; available: boolean };
}) {
  const { t } = useTranslation("jobExtra");
  const online = useOnline();
  const change = useWaitlistChange(actor, item.job_id);
  const visibleTitle = item.title.trim();
  const label = visibleTitle || t("waitlistUnavailable");
  return (
    <li>
      {visibleTitle ? (
        <Link to={`/jobs/${item.job_id}`}>{item.title}</Link>
      ) : (
        <span>{label}</span>
      )}
      {visibleTitle && item.available && <span> · {t("available")}</span>}{" "}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-label={`${t("leave")}: ${label}`}
        disabled={!online || change.isPending}
        onClick={() => change.mutate(false)}
      >
        {t("leave")}
      </Button>
      {change.isError && <Notice kind="error">{t("error")}</Notice>}
    </li>
  );
}

export function MyJobWaitlist() {
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("jobExtra");
  const query = useQuery(myWaitlistQuery(actor));
  if (query.isPending || query.isError || !query.data.length) return null;
  return (
    <section className="panel" aria-label={t("waitlist")}>
      <h2>{t("waitlist")}</h2>
      <p>{t("waitlistHelp")}</p>
      <ul>
        {query.data.map((item) => (
          <OwnWaitlistInterest
            key={`${actor}:${item.job_id}`}
            actor={actor}
            item={item}
          />
        ))}
      </ul>
    </section>
  );
}
