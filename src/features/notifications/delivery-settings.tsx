import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import {
  deliveryKey,
  type DeliveryPreferences,
  deliveryPreferencesQuery,
  deliveryPreferencesSchema,
  saveDeliveryPreferences,
} from "./delivery-api";
import "./delivery-i18n";

function DeliveryForm({
  actor,
  initial,
  reload,
}: {
  actor: string;
  initial: DeliveryPreferences;
  reload: () => Promise<DeliveryPreferences | undefined>;
}) {
  const { t } = useTranslation("delivery");
  const online = useOnline();
  const client = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const save = useMutation({
    mutationFn: async () => {
      requireOnline();
      const parsed = deliveryPreferencesSchema.safeParse(draft);
      setInvalid(!parsed.success);
      if (!parsed.success) throw new Error("invalid_preferences");
      return saveDeliveryPreferences(parsed.data);
    },
    onSuccess: (data) => {
      client.setQueryData(deliveryKey(actor), data);
      setDraft(data);
      setSaved(data);
    },
  });
  const conflict =
    save.error !== null &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001";

  function edit(values: Partial<DeliveryPreferences>) {
    setDraft((previous) => ({ ...previous, ...values }));
    setInvalid(false);
    save.reset();
  }

  return (
    <form
      className="panel notification-preferences"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <h2>{t("title")}</h2>
      <p>{t("intro")}</p>
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">{t("title")}</legend>
        <label className="notification-preference">
          <input
            type="checkbox"
            checked={draft.email_enabled}
            onChange={(event) => edit({ email_enabled: event.target.checked })}
          />
          <span>{t("enabled")}</span>
        </label>
        <label className="notification-preference">
          <input
            type="checkbox"
            checked={draft.quiet_start !== null}
            onChange={(event) =>
              edit({
                quiet_start: event.target.checked ? "22:00" : null,
                quiet_end: event.target.checked ? "07:00" : null,
              })
            }
          />
          <span>{t("quiet")}</span>
        </label>
        {draft.quiet_start !== null && (
          <div className="form-row">
            <Field id="email-quiet-start" label={t("start")}>
              <input
                id="email-quiet-start"
                type="time"
                value={draft.quiet_start}
                onChange={(event) => edit({ quiet_start: event.target.value })}
              />
            </Field>
            <Field id="email-quiet-end" label={t("end")}>
              <input
                id="email-quiet-end"
                type="time"
                value={draft.quiet_end ?? ""}
                onChange={(event) => edit({ quiet_end: event.target.value })}
              />
            </Field>
          </div>
        )}
        <Field id="email-quiet-zone" label={t("zone")}>
          <input
            id="email-quiet-zone"
            value={draft.time_zone}
            onChange={(event) => edit({ time_zone: event.target.value })}
            autoComplete="off"
          />
        </Field>
      </fieldset>
      <p>{t("help")}</p>
      {save.isError && (
        <Notice kind="error">
          {t(invalid ? "validation" : conflict ? "conflict" : "error")}
        </Notice>
      )}
      {conflict && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void reload().then((data) => {
              if (data) {
                setDraft(data);
                setSaved(data);
                save.reset();
              }
            })
          }
        >
          {t("reload")}
        </Button>
      )}
      {save.isSuccess && !dirty && <Notice>{t("saved")}</Notice>}
      <Button type="submit" disabled={!online || save.isPending || !dirty}>
        {t("save")}
      </Button>
    </form>
  );
}

export function DeliverySettings({ actor }: { actor: string }) {
  const query = useQuery(deliveryPreferencesQuery(actor));
  return query.isPending ? (
    <Loading />
  ) : query.isError ? (
    <ErrorState retry={() => void query.refetch()} />
  ) : (
    <DeliveryForm
      key={actor}
      actor={actor}
      initial={query.data}
      reload={async () => {
        const result = await query.refetch();
        return result.isSuccess ? result.data : undefined;
      }}
    />
  );
}
