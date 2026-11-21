/** Own waitlist interest and server-priced whole-block substitutions.
 * Redacted interest stays removable without exposing private offer metadata;
 * only confirmed server responses update identity-scoped cached membership.
 */
import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { hasTeachingRole } from "../auth/internal-capabilities";
import { userRolesQuery } from "../../lib/queries";
import { useOnline } from "../../lib/online";
import { dateTime, money } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { lifecycleQuery, refreshJobState } from "./lifecycle-api";
import {
  myWaitlistQuery,
  proposeSubstitution,
  respondSubstitution,
  setWaitlist,
  type Substitution,
  substitutionCandidatesQuery,
  substitutionsQuery,
  waitlistKey,
  waitlistQuery,
} from "./lifecycle-extra-api";
import "./lifecycle-extra-i18n";

function useRequestKey() {
  const current = useRef<{ signature: string; key: string } | null>(null);
  return (signature: string) => {
    if (current.current?.signature !== signature)
      current.current = { signature, key: crypto.randomUUID() };
    return current.current.key;
  };
}

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

function SubstituteOffer({
  offer,
  teaching,
}: {
  offer: Substitution;
  teaching: boolean;
}) {
  const { t, i18n } = useTranslation("jobExtra");
  const common = useTranslation().t;
  // Consent belongs to the exact recipient quote currently displayed, not to
  // the offer ID. Refetches can replace prices, terms, sessions or authority
  // while this card remains mounted. Identical refreshes and language changes
  // preserve a review; any intervening changed snapshot retires it permanently.
  const snapshot = JSON.stringify([
    offer.id,
    offer.job_id,
    offer.original_claim_id,
    offer.target_user_id,
    offer.quote_hash,
    offer.quote,
    offer.expires_at,
    offer.reason,
    offer.proposer_name,
    offer.target_name,
    offer.status,
    teaching && offer.can_accept,
  ]);
  const [reviewedSnapshot, setReviewedSnapshot] = useState<string | null>(null);
  if (reviewedSnapshot !== null && reviewedSnapshot !== snapshot)
    setReviewedSnapshot(null);
  const consent = reviewedSnapshot === snapshot;
  const online = useOnline(),
    client = useQueryClient(),
    keyFor = useRequestKey();
  const action = useMutation({
    mutationFn: (kind: "accept" | "decline" | "withdraw") => {
      if (kind === "accept" && (!consent || !teaching || !offer.can_accept))
        throw new Error("substitution_review_required");
      return respondSubstitution(
        offer,
        kind,
        keyFor(`${offer.id}:${kind}:${offer.quote_hash}`),
        consent,
      );
    },
    onSuccess: () => refreshJobState(client),
  });
  const result = action.data?.status;
  const resultKey =
    result &&
    [
      "confirmed",
      "cancelled",
      "declined",
      "withdrawn",
      "expired",
      "unavailable",
      "conflict",
      "not_eligible",
      "prerequisite_missing",
      "terms_changed",
      "financial_review",
      "idempotency_conflict",
    ].includes(result)
      ? result
      : "error";
  return (
    <article className="panel" aria-label={offer.quote.title}>
      <h3>{offer.quote.title}</h3>
      <p>{offer.quote.customer_name}</p>
      <p>
        {t("from", { name: offer.proposer_name })} ·{" "}
        {t("to", { name: offer.target_name })}
      </p>
      <p>
        {t(offer.status)} ·{" "}
        {t("expires", {
          date: dateTime(
            offer.expires_at,
            i18n.language,
            offer.quote.time_zone,
          ),
        })}
      </p>
      <p className="preserve-text">{offer.reason}</p>
      <h4>{t("quote")}</h4>
      {offer.quote.total_amount !== null &&
      offer.quote.amount !== null &&
      offer.quote.currency !== null &&
      offer.quote.rate_unit !== null ? (
        <>
          <p>
            <strong>
              {t("total")}:{" "}
              {money(
                offer.quote.total_amount,
                offer.quote.currency,
                i18n.language,
              )}
            </strong>
          </p>
          <p>
            {money(offer.quote.amount, offer.quote.currency, i18n.language)} ·{" "}
            {common(offer.quote.rate_unit)} · {offer.quote.time_zone}
          </p>
          <p className="preserve-text">{offer.quote.terms}</p>
        </>
      ) : (
        <p>{t("quotePrivate")}</p>
      )}
      <p className="preserve-text">{offer.quote.location}</p>
      {offer.quote.requires_contract && <p>{t("contract")}</p>}
      <ol>
        {offer.quote.sessions.map((session) => (
          <li key={session.starts_at}>
            {dateTime(session.starts_at, i18n.language, offer.quote.time_zone)}{" "}
            – {dateTime(session.ends_at, i18n.language, offer.quote.time_zone)}
          </li>
        ))}
      </ol>
      {teaching && offer.can_accept && (
        <>
          <label className="notification-preference">
            <input
              type="checkbox"
              checked={consent}
              disabled={action.isPending}
              onChange={(event) =>
                setReviewedSnapshot(event.target.checked ? snapshot : null)
              }
            />
            <span>{t("consent")}</span>
          </label>
          <Button
            disabled={!online || action.isPending || !consent}
            onClick={() => action.mutate("accept")}
          >
            {t("accept")}
          </Button>{" "}
          <Button
            variant="secondary"
            disabled={!online || action.isPending}
            onClick={() => action.mutate("decline")}
          >
            {t("decline")}
          </Button>
        </>
      )}
      {offer.can_withdraw && (
        <Button
          variant="secondary"
          disabled={!online || action.isPending}
          onClick={() => action.mutate("withdraw")}
        >
          {t("withdraw")}
        </Button>
      )}
      {action.isError && <Notice kind="error">{t("error")}</Notice>}
      {action.isSuccess && (
        <Notice
          kind={
            result === "confirmed" ||
            result === "declined" ||
            result === "withdrawn"
              ? "success"
              : "error"
          }
        >
          {t(resultKey)}
        </Notice>
      )}
    </article>
  );
}

export function SubstitutionOffers({ jobId }: { jobId?: string }) {
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("jobExtra");
  const roles = useQuery(userRolesQuery(actor));
  const teaching = roles.isSuccess && hasTeachingRole(roles.data);
  const query = useQuery(substitutionsQuery(actor, jobId));
  if (query.isPending) return null;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data.length) return null;
  return (
    <section aria-label={t(jobId ? "history" : "inbox")}>
      <h2>{t(jobId ? "history" : "inbox")}</h2>
      {query.data.map((offer) => (
        <SubstituteOffer key={offer.id} offer={offer} teaching={teaching} />
      ))}
      <Button
        variant="ghost"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        {t("refresh")}
      </Button>
    </section>
  );
}

export function JobSubstitutionPanel({ jobId }: { jobId: string }) {
  const actor = useAuth().session!.user.id;
  const { t } = useTranslation("jobExtra");
  const online = useOnline(),
    client = useQueryClient(),
    keyFor = useRequestKey();
  const lifecycle = useQuery(lifecycleQuery(actor, jobId));
  const [claim, setClaim] = useState<string | null>(null),
    [search, setSearch] = useState(""),
    [target, setTarget] = useState(""),
    [reason, setReason] = useState("");
  const candidates = useQuery(
    substitutionCandidatesQuery(actor, claim, search),
  );
  const propose = useMutation({
    mutationFn: () =>
      proposeSubstitution(
        claim!,
        target,
        reason,
        keyFor(JSON.stringify({ claim, target, reason: reason.trim() })),
      ),
    onSuccess: async () => {
      setClaim(null);
      setTarget("");
      setReason("");
      await refreshJobState(client);
    },
  });
  if (
    !lifecycle.data ||
    lifecycle.isError ||
    (!lifecycle.data.can_manage && !lifecycle.data.claims.length)
  )
    return null;
  const active = lifecycle.data.claims.filter(
    (item) => item.can_cancel && item.status === "confirmed",
  );
  return (
    <section className="panel" aria-label={t("handover")}>
      <h2>{t("handover")}</h2>
      <p>{t("handoverHelp")}</p>
      {active.map((item) => (
        <Button
          key={item.id}
          variant="secondary"
          disabled={!online || propose.isPending}
          onClick={() => {
            setClaim(item.id);
            setTarget("");
            propose.reset();
          }}
        >
          {t("find")} · {item.lecturer_name}
        </Button>
      ))}
      {claim && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            propose.mutate();
          }}
        >
          <Field id="substitute-search" label={t("search")}>
            <input
              id="substitute-search"
              type="search"
              maxLength={120}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          {candidates.isPending ? (
            <Loading />
          ) : candidates.isError ? (
            <ErrorState retry={() => void candidates.refetch()} />
          ) : candidates.data.length ? (
            <>
              <Field id="substitute-target" label={t("target")}>
                <select
                  id="substitute-target"
                  value={target}
                  required
                  onChange={(event) => setTarget(event.target.value)}
                >
                  <option value="">{t("target")}</option>
                  {candidates.data.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.display_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="substitute-reason" label={t("reason")}>
                <textarea
                  id="substitute-reason"
                  value={reason}
                  minLength={5}
                  maxLength={1000}
                  required
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <Button
                type="submit"
                disabled={
                  !online ||
                  propose.isPending ||
                  !target ||
                  reason.trim().length < 5
                }
              >
                {t("propose")}
              </Button>
            </>
          ) : (
            <p>{t("noCandidates")}</p>
          )}
        </form>
      )}
      {propose.isError && <Notice kind="error">{t("error")}</Notice>}
      {propose.isSuccess && <Notice>{t("proposed")}</Notice>}
      <SubstitutionOffers jobId={jobId} />
    </section>
  );
}
