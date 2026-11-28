import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import {
  deliveryKey,
  type DeliveryPreferences,
  deliveryPreferencesQuery,
  deliveryPreferencesSchema,
  saveDeliveryPreferences,
} from "./delivery-api";
import "./delivery-i18n";
import { usePreferenceEditorData } from "./preference-read";
import { PreferenceSaveControls } from "./preference-save-controls";

/** Edit the current actor's email delivery and quiet-hour preferences. */
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
      <PreferenceSaveControls
        namespace="delivery"
        online={online}
        dirty={dirty}
        invalid={invalid}
        save={save}
        reload={reload}
        reset={(data) => {
          setDraft(data);
          setSaved(data);
        }}
      />
    </form>
  );
}

/** Bind the editor and its reload action to the current actor's query. */
export function DeliverySettings({ actor }: { actor: string }) {
  const query = useQuery(deliveryPreferencesQuery(actor));
  const preferences = usePreferenceEditorData(query);
  return query.isPending ? (
    <Loading />
  ) : !preferences ? (
    <ErrorState retry={() => void query.refetch()} />
  ) : (
    <>
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      <DeliveryForm
        key={actor}
        actor={actor}
        initial={preferences}
        reload={async () => {
          const result = await query.refetch();
          return result.isSuccess ? result.data : undefined;
        }}
      />
    </>
  );
}
