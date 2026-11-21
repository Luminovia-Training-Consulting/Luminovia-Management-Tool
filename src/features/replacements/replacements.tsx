/** Future whole-block replacements reuse the existing online claim contract; the original allocation stays confirmed until a complete transactional handover succeeds. Components render pending, denied and committed outcomes separately and preserve reviewed form state. */
import { type FormEvent, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRightLeft } from "lucide-react";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { useAuth } from "../auth/auth-context";
import {
  hasJobStaffRole,
  hasTeachingRole,
} from "../auth/internal-capabilities";
import { userRolesQuery } from "../../lib/queries";
import { useOnline } from "../../lib/online";
import { dateTime, money } from "../../lib/dates";
import { peopleDirectoryQuery } from "../people/api";
import { refreshJobState } from "../jobs/lifecycle-api";
import {
  cancelReplacement,
  claimReplacement,
  replacementAssignmentsQuery,
  type ReplacementOffer,
  replacementQuery,
  requestReplacement,
} from "./api";
import "./i18n";
import "./replacements.css";

/** Reuse a request identity only while every reviewed input stays identical, making uncertain transport retries safe. */
function useRequestKey() {
  const key = useRef<{ signature: string; id: string } | null>(null);
  return (signature: string) => {
    if (key.current?.signature !== signature)
      key.current = { signature, id: crypto.randomUUID() };
    return key.current.id;
  };
}

/** Bind consent to the full quote and block; only a committed confirmed response may render a successful handover. */
function ReplacementCard({
  offer,
  refresh,
  teaching,
}: {
  offer: ReplacementOffer;
  refresh: () => Promise<void>;
  teaching: boolean;
}) {
  const { t, i18n } = useTranslation("replacements");
  const online = useOnline();
  const [consent, setConsent] = useState<string | null>(null);
  const keyFor = useRequestKey();
  const fingerprint = JSON.stringify([
    offer.id,
    offer.version,
    offer.quote,
    offer.sessions,
  ]);
  const action = useMutation({
    mutationFn: async (kind: "claim" | "cancel") => {
      const key = keyFor(JSON.stringify([kind, fingerprint]));
      if (kind === "cancel") {
        await cancelReplacement(offer, key);
        return "cancelled";
      }
      if (!teaching || !offer.can_claim) throw new Error("not_eligible");
      const result = await claimReplacement(offer, key);
      if (result.status !== "confirmed") throw new Error(result.status);
      return "confirmed";
    },
    onSuccess: async () => {
      setConsent(null);
      await refresh();
    },
  });
  return (
    <article className="panel replacement-card">
      <div className="section-heading">
        <h2>{offer.title}</h2>
        <ArrowRightLeft aria-hidden="true" />
      </div>
      <p>
        <span className="badge">
          {t(
            offer.status === "cancelled"
              ? "offerCancelled"
              : offer.status === "completed"
                ? "completed"
                : offer.mode,
          )}
        </span>
        {offer.emergency && (
          <strong className="replacement-emergency">{t("emergency")}</strong>
        )}
      </p>
      <ol>
        {offer.sessions.map((s) => (
          <li key={s.starts_at}>
            {dateTime(s.starts_at, i18n.language, offer.time_zone)} –{" "}
            {dateTime(s.ends_at, i18n.language, offer.time_zone)}
          </li>
        ))}
      </ol>
      {offer.reason && (
        <p className="replacement-text">
          {t("reason")}: {offer.reason}
        </p>
      )}
      {teaching && offer.can_claim && offer.quote && (
        <>
          <dl>
            <dt>{t("total")}</dt>
            <dd>
              {money(
                offer.quote.total_amount,
                offer.quote.currency,
                i18n.language,
              )}
            </dd>
            <dt>{t("unit")}</dt>
            <dd>
              {money(offer.quote.amount, offer.quote.currency, i18n.language)} ·{" "}
              {t(offer.quote.rate_unit)}
            </dd>
          </dl>
          <h3>{t("terms")}</h3>
          <p className="replacement-text">{offer.quote.terms}</p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={consent === fingerprint}
              onChange={(e) =>
                setConsent(e.target.checked ? fingerprint : null)
              }
            />
            {t("consent")}
          </label>
          <Button
            disabled={!online || action.isPending || consent !== fingerprint}
            onClick={() => action.mutate("claim")}
          >
            {t("claim")}
          </Button>
        </>
      )}
      {offer.can_cancel && (
        <>
          <p className="muted">{t("cancelHint")}</p>
          <Button
            variant="secondary"
            disabled={!online || action.isPending}
            onClick={() => action.mutate("cancel")}
          >
            {t("cancel")}
          </Button>
        </>
      )}
      {action.isError && (
        <Notice kind="error">
          {t(
            [
              "unavailable",
              "not_eligible",
              "conflict",
              "terms_changed",
            ].includes(action.error.message)
              ? action.error.message
              : "error",
          )}
        </Notice>
      )}
      {action.isSuccess && <Notice>{t(action.data)}</Notice>}
    </article>
  );
}

/** Publish a reasoned search for an eligible confirmed assignment while its original allocation remains in place. */
function ReplacementRequest({
  actor,
  refresh,
}: {
  actor: string;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation("replacements");
  const online = useOnline();
  const assignments = useQuery(replacementAssignmentsQuery(actor));
  const [claim, setClaim] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"open" | "selected">("open");
  const [invited, setInvited] = useState<string[]>([]);
  const [emergency, setEmergency] = useState(false);
  const keyFor = useRequestKey();
  const people = useQuery({
    ...peopleDirectoryQuery(actor, "", "", ""),
    enabled: mode === "selected",
  });
  const save = useMutation({
    mutationFn: async () => {
      const input = {
        claim,
        reason,
        mode,
        invited: mode === "selected" ? invited : [],
        emergency,
      };
      return requestReplacement(input, keyFor(JSON.stringify(input)));
    },
    onSuccess: async () => {
      setClaim("");
      setReason("");
      setInvited([]);
      await refresh();
    },
  });
  if (assignments.isPending) return <Loading />;
  if (assignments.isError)
    return <ErrorState retry={() => void assignments.refetch()} />;
  if (!assignments.data.length) return <p className="muted">{t("none")}</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };
  return (
    <section className="panel">
      <h2>{t("request")}</h2>
      <form onSubmit={submit}>
        <Field id="replacement-assignment" label={t("assignment")}>
          <select
            required
            id="replacement-assignment"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
          >
            <option value="">—</option>
            {assignments.data.map((a) => (
              <option key={a.claim_id} value={a.claim_id}>
                {a.title} · {a.lecturer}
              </option>
            ))}
          </select>
        </Field>
        <Field id="replacement-reason" label={t("reason")}>
          <textarea
            required
            minLength={5}
            maxLength={1000}
            id="replacement-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Field id="replacement-mode" label={t("mode")}>
          <select
            id="replacement-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as "open" | "selected")}
          >
            <option value="open">{t("open")}</option>
            <option value="selected">{t("selected")}</option>
          </select>
        </Field>
        {mode === "selected" && (
          <fieldset>
            <legend>{t("invite")}</legend>
            {people.isError ? (
              <ErrorState retry={() => void people.refetch()} />
            ) : people.isPending ? (
              <Loading />
            ) : (
              people.data.map((person) => (
                <label className="checkbox-label" key={person.id}>
                  <input
                    type="checkbox"
                    value={person.id}
                    checked={invited.includes(person.id)}
                    onChange={(e) =>
                      setInvited(
                        e.target.checked
                          ? [...invited, person.id]
                          : invited.filter((id) => id !== person.id),
                      )
                    }
                  />
                  {person.display_name}
                </label>
              ))
            )}
          </fieldset>
        )}
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={emergency}
            onChange={(e) => setEmergency(e.target.checked)}
          />
          {t("emergency")}
        </label>
        <Button
          disabled={
            !online ||
            save.isPending ||
            !claim ||
            reason.trim().length < 5 ||
            (mode === "selected" && !invited.length)
          }
        >
          {t("save")}
        </Button>
        {save.isError && <Notice kind="error">{t("error")}</Notice>}
        {save.isSuccess && <Notice>{t("opened")}</Notice>}
      </form>
    </section>
  );
}

/** Render only online server-filtered opportunities and refresh calendars, claims and preparation after committed changes. */
export function ReplacementMarketplacePage() {
  const { session } = useAuth();
  const actor = session!.user.id;
  const { t } = useTranslation("replacements");
  const client = useQueryClient();
  const online = useOnline();
  const roles = useQuery(userRolesQuery(actor));
  const staff = roles.isSuccess && hasJobStaffRole(roles.data);
  const teaching = roles.isSuccess && hasTeachingRole(roles.data);
  const offers = useQuery({
    ...replacementQuery(actor),
    enabled: online && staff,
  });
  const refresh = async () => {
    await Promise.all([
      refreshJobState(client),
      client.invalidateQueries({ queryKey: ["replacements"] }),
      client.invalidateQueries({ queryKey: ["replacement-assignments"] }),
      client.invalidateQueries({ queryKey: ["readiness"] }),
    ]);
  };
  if (roles.isPending) return <Loading />;
  if (roles.isError) return <ErrorState retry={() => void roles.refetch()} />;
  if (!staff) return null;
  return (
    <>
      <PageHeading title={t("title")} description={t("description")} />
      <Notice>{t("boundary")}</Notice>
      <Button
        variant="secondary"
        disabled={!online || offers.isFetching}
        onClick={() => void refresh()}
      >
        {t("refresh")}
      </Button>
      {online && <ReplacementRequest actor={actor} refresh={refresh} />}
      {!online ? (
        <Notice>{t("translation:offline")}</Notice>
      ) : offers.isError ? (
        <ErrorState retry={() => void offers.refetch()} />
      ) : offers.isPending ? (
        <Loading />
      ) : offers.data.length ? (
        <div className="replacement-grid">
          {offers.data.map((offer) => (
            <ReplacementCard
              key={offer.id}
              offer={offer}
              refresh={refresh}
              teaching={teaching}
            />
          ))}
        </div>
      ) : (
        <p>{t("empty")}</p>
      )}
    </>
  );
}
