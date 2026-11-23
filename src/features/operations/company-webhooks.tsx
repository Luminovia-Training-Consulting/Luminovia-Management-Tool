/** Company-scoped webhook administration. The one-time signing key stays in the open form. */
import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import "./i18n";

type WebhookDelivery = {
  id: string;
  event_id?: string;
  event_type: string;
  state: "pending" | "failed" | "delivered" | "cancelled";
  occurred_at: string;
  attempts: number;
};

type Webhook = {
  id: string;
  destination: string;
  integration_label: string;
  premium_events: boolean;
  accounting_events?: true;
  active: boolean;
  deliveries: WebhookDelivery[];
};

/** Use a separate disclosure so listing keys does not fetch the delivery ledger. */
export function CompanyWebhooks({
  actor,
  organisation,
  zone,
  keys = [],
  archived,
  canSubscribePremium = false,
  canSubscribeAccounting = false,
  academy = false,
}: {
  actor: string;
  organisation: string;
  zone: string;
  keys?: {
    id: string;
    label: string;
    expires_at: string | null;
    revoked_at: string | null;
  }[];
  archived: boolean;
  canSubscribePremium?: boolean;
  canSubscribeAccounting?: boolean;
  academy?: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
  const online = useOnline();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<
    "webhookError" | "webhookDuplicate" | "webhookLimit"
  >();
  const [secret, setSecret] = useState("");
  const [revoke, setRevoke] = useState<Webhook>();
  const [accounting, setAccounting] = useState(false);
  const queryKey = ["company-course-webhooks", actor, organisation];
  const subscriptions = useQuery({
    queryKey,
    enabled: open && online,
    queryFn: async () => {
      const result = await db().rpc("company_course_webhook_list", {
        p_organisation: organisation,
      });
      if (result.error) throw result.error;
      return (result.data ?? []) as Webhook[];
    },
  });
  const eligibleKeys = keys.filter(
    (key) =>
      !key.revoked_at &&
      (key.expires_at === null || Date.parse(key.expires_at) > openedAt),
  );

  const canCreate = !archived && (academy || eligibleKeys.length > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setPending(true);
    setError(undefined);
    setSecret("");
    try {
      requireOnline();
      if (revoke) {
        const args = {
          p_organisation: organisation,
          p_subscription: revoke.id,
        };
        const result = academy
          ? await db().rpc("academy_revoke_course_webhook", args)
          : await db().rpc("company_course_webhook_revoke", args);
        if (result.error) throw result.error;
      } else {
        const args = {
          p_organisation: organisation,
          p_destination: String(data.get("destination")).trim(),
        };
        const result = academy
          ? await db().rpc("academy_subscribe_course_webhook", args)
          : await subscribeCompany(args, data);
        if (result.error) throw result.error;
        if (typeof result.data?.signing_secret !== "string")
          throw new Error("webhook_subscription_failed");
        if (form.isConnected) setSecret(result.data.signing_secret);
      }
      setRevoke(undefined);
      setAccounting(false);
      form.reset();
    } catch (failure) {
      const code =
        failure && typeof failure === "object" && "code" in failure
          ? failure.code
          : null;
      setError(
        code === "23505"
          ? "webhookDuplicate"
          : code === "PT429" || code === "54000"
            ? "webhookLimit"
            : "webhookError",
      );
    } finally {
      await cache.invalidateQueries({ queryKey });
      setPending(false);
    }
  }

  function subscribeCompany(
    args: { p_organisation: string; p_destination: string },
    data: FormData,
  ) {
    const input = { ...args, p_integration: String(data.get("integration")) };
    if (canSubscribeAccounting && accounting) {
      return db().rpc("company_accounting_webhook_subscribe", input);
    }
    return db().rpc("company_course_webhook_subscribe", {
      ...input,
      p_premium_events: canSubscribePremium && data.has("premiumEvents"),
    });
  }

  const fieldPrefix = "course-webhook-" + organisation;
  return (
    <details
      onToggle={(event) => {
        const isOpen = event.currentTarget.open;
        setOpen(isOpen);
        if (isOpen) setOpenedAt(Date.now());
        if (!isOpen) {
          setSecret("");
          setRevoke(undefined);
          setAccounting(false);
        }
      }}
    >
      <summary>{t(academy ? "webhookTitle" : "webhookCompanyTitle")}</summary>
      {open && (
        <>
          <p>
            {t(
              academy
                ? "webhookAcademyHelp"
                : canSubscribeAccounting
                  ? "webhookCompanyHelp"
                  : "webhookHelp",
            )}
          </p>
          {online && subscriptions.isPending && <Loading />}
          {online && subscriptions.isError && (
            <ErrorState retry={() => void subscriptions.refetch()} />
          )}
          {online && subscriptions.isSuccess && (
            <>
              {subscriptions.data.length === 0 && <p>{t("webhookEmpty")}</p>}
              {subscriptions.data.length > 0 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={subscriptions.isFetching}
                    onClick={() => void subscriptions.refetch()}
                  >
                    {t("webhookRefresh")}
                  </Button>
                  <ul>
                    {subscriptions.data.map((subscription) => (
                      <li key={subscription.id}>
                        <strong>{subscription.destination}</strong> ·{" "}
                        {!academy && <>{subscription.integration_label} · </>}
                        {t(
                          subscription.active
                            ? "webhookActive"
                            : "webhookInactive",
                        )}
                        {!academy && subscription.premium_events && (
                          <> · {t("webhookPremium")}</>
                        )}
                        {!academy && subscription.accounting_events && (
                          <> · {t("webhookAccounting")}</>
                        )}
                        {subscription.active && (
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => {
                              setSecret("");
                              setRevoke(subscription);
                            }}
                          >
                            {t("webhookRevoke")}
                          </Button>
                        )}
                        {subscription.deliveries.length > 0 && (
                          <ul aria-label={t("webhookRecent")}>
                            {subscription.deliveries.map((delivery) => (
                              <li key={delivery.id}>
                                {t("webhookEvent." + delivery.event_type)} ·{" "}
                                {t("webhookState." + delivery.state)} ·{" "}
                                {dateTime(
                                  delivery.occurred_at,
                                  i18n.language,
                                  zone,
                                )}{" "}
                                ·{" "}
                                {t("webhookAttempts", {
                                  count: delivery.attempts,
                                })}
                                {delivery.event_id && (
                                  <span>
                                    {" · "}
                                    {t("webhookEventId")}{" "}
                                    <code>{delivery.event_id}</code>
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {!academy && !revoke && !archived && !canCreate && (
                <p>{t("webhookRequiresKey")}</p>
              )}
              {(revoke || canCreate) && (
                <form onSubmit={submit}>
                  {revoke ? (
                    <p>{t("webhookConfirm", { alias: revoke.destination })}</p>
                  ) : (
                    <>
                      {!academy && (
                        <Field
                          id={fieldPrefix + "-integration"}
                          label={t("webhookKey")}
                        >
                          <select
                            id={fieldPrefix + "-integration"}
                            name="integration"
                            required
                            defaultValue=""
                          >
                            <option value="" disabled>
                              {t("webhookChooseKey")}
                            </option>
                            {eligibleKeys.map((key) => (
                              <option value={key.id} key={key.id}>
                                {key.label}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      <Field
                        id={fieldPrefix + "-alias"}
                        label={t("webhookAlias")}
                        hint={t("webhookAliasHint")}
                      >
                        <input
                          id={fieldPrefix + "-alias"}
                          name="destination"
                          required
                          maxLength={40}
                          pattern={String.raw`[a-z][a-z0-9\x2D]{0,39}`}
                          autoComplete="off"
                        />
                      </Field>
                      {!academy && canSubscribeAccounting && (
                        <Field
                          id={fieldPrefix + "-events"}
                          label={t("webhookScope")}
                        >
                          <select
                            id={fieldPrefix + "-events"}
                            value={accounting ? "accounting" : "course"}
                            onChange={(event) =>
                              setAccounting(
                                event.currentTarget.value === "accounting",
                              )
                            }
                          >
                            <option value="course">
                              {t("webhookCourses")}
                            </option>
                            <option value="accounting">
                              {t("webhookAccounting")}
                            </option>
                          </select>
                        </Field>
                      )}
                      {canSubscribePremium && !accounting && (
                        <label>
                          <input type="checkbox" name="premiumEvents" />{" "}
                          {t("webhookIncludePremium")}
                        </label>
                      )}
                    </>
                  )}
                  <Button disabled={pending}>
                    {t(revoke ? "integrationConfirm" : "webhookCreate")}
                  </Button>{" "}
                  {revoke && (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setRevoke(undefined)}
                    >
                      {t("cancel")}
                    </Button>
                  )}
                </form>
              )}
              {secret && (
                <div role="status">
                  <p>{t("webhookCopy")}</p>
                  <Field
                    id={fieldPrefix + "-secret"}
                    label={t("webhookSecret")}
                  >
                    <input
                      id={fieldPrefix + "-secret"}
                      value={secret}
                      readOnly
                      autoComplete="off"
                      spellCheck={false}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setSecret("")}
                  >
                    {t("integrationHide")}
                  </Button>
                </div>
              )}
            </>
          )}
          {error && <Notice kind="error">{t(error)}</Notice>}
        </>
      )}
    </details>
  );
}
