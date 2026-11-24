// Create, rotate and revoke secret calendar URLs with versioned server writes.
// The one-session URL stays in component memory and disappears on unmount.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import {
  calendarSecretToken,
  type CalendarSubscription,
  calendarSubscriptionUrl,
  revokeSubscription,
  saveSubscription,
  subscriptionKey,
  subscriptionsQuery,
} from "./subscriptions-api";
import "./subscriptions-i18n";
import "./subscriptions.css";

function isConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "PT409" || error.code === "40001")
  );
}

/** Preserve an unconfirmed request's secret while cancelling late UI callbacks. */
function SubscriptionEditor({
  item,
  actor,
  done,
}: {
  item: CalendarSubscription | null;
  actor: string;
  done: (token: string) => void;
}) {
  const { t } = useTranslation("calendarSubscriptions"),
    online = useOnline();
  const [label, setLabel] = useState(item?.label ?? "");
  const [privateEvents, setPrivateEvents] = useState(
    item?.include_private ?? false,
  );
  const [secret] = useState(calendarSecretToken);
  const [request] = useState(() => crypto.randomUUID());
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [actor],
  );
  const save = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      pending.current = controller;
      await saveSubscription(
        item?.id ?? null,
        label,
        privateEvents,
        secret,
        item?.version ?? 0,
        request,
        controller.signal,
      );
      if (controller.signal.aborted)
        throw new DOMException("Cancelled", "AbortError");
      return secret;
    },
    onSuccess: done,
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <p>{t("secret")}</p>
      {item && <p>{t("rotateHint")}</p>}
      <Field id="subscription-label" label={t("label")}>
        <input
          id="subscription-label"
          value={label}
          maxLength={80}
          required
          disabled={save.isPending}
          onChange={(event) => setLabel(event.target.value)}
        />
      </Field>
      <label>
        <input
          type="checkbox"
          checked={privateEvents}
          disabled={save.isPending}
          onChange={(event) => setPrivateEvents(event.target.checked)}
        />
        {t("private")}
      </label>
      {save.isError && (
        <Notice kind="error">
          {t(isConflict(save.error) ? "conflict" : "error")}
        </Notice>
      )}
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
    </form>
  );
}

export function CalendarSubscriptions({
  actor,
  zone,
}: {
  actor: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("calendarSubscriptions");
  const client = useQueryClient(),
    online = useOnline();
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({ ...subscriptionsQuery(actor), enabled: expanded });
  const [editor, setEditor] = useState<CalendarSubscription | null | undefined>(
    undefined,
  );
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const revoke = useMutation({
    mutationFn: (item: CalendarSubscription) =>
      revokeSubscription(item.id, item.version),
    onSuccess: () => {
      setUrl(null);
      return client.invalidateQueries({ queryKey: subscriptionKey(actor) });
    },
  });
  return (
    <details
      className="panel"
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>{t("title")}</summary>
      <p>{t("help")}</p>
      <p>{t("secret")}</p>
      <Button disabled={!online} onClick={() => setEditor(null)}>
        {t("new")}
      </Button>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : !query.data.length ? (
        <p>{t("empty")}</p>
      ) : (
        <ul className="calendar-subscription-list">
          {query.data.map((item) => (
            <li key={item.id}>
              <div className="calendar-subscription-summary">
                <strong>{item.label}</strong>
                <p className="muted">
                  {item.revoked_at
                    ? t("revoked")
                    : `${t("expiry")}: ${dateTime(item.expires_at, i18n.language, zone)}`}
                </p>
              </div>
              <div className="calendar-subscription-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!online || revoke.isPending}
                  onClick={() => setEditor(item)}
                >
                  {t("edit")}
                </Button>
                {!item.revoked_at && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!online || revoke.isPending}
                    onClick={() => revoke.mutate(item)}
                  >
                    {t("revoke")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {revoke.isError && (
        <Notice kind="error">
          {t(isConflict(revoke.error) ? "conflict" : "error")}
        </Notice>
      )}
      {url && (
        <div className="panel calendar-subscription-secret">
          <Notice>{t("saved")}</Notice>
          <Field id="calendar-secret-address" label={t("address")}>
            <input
              id="calendar-secret-address"
              type="password"
              autoComplete="off"
              readOnly
              value={url}
            />
          </Field>
          <div className="calendar-subscription-actions">
            <Button
              onClick={() =>
                void navigator.clipboard
                  .writeText(url)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {t("copy")}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setUrl(null);
                setCopied(false);
              }}
            >
              {t("hide")}
            </Button>
          </div>
          {copied && <Notice>{t("copied")}</Notice>}
        </div>
      )}
      <Dialog
        open={editor !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined);
        }}
        title={t(editor ? "edit" : "new")}
        description={t("secret")}
      >
        {editor !== undefined && (
          <SubscriptionEditor
            key={editor?.id ?? "new"}
            item={editor}
            actor={actor}
            done={(token) => {
              setUrl(calendarSubscriptionUrl(token));
              setEditor(undefined);
              setCopied(false);
              void client.invalidateQueries({
                queryKey: subscriptionKey(actor),
              });
            }}
          />
        )}
      </Dialog>
    </details>
  );
}
