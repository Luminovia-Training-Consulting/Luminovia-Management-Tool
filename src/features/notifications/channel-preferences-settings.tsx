/** Own category-by-channel settings without modifying inbox, device or account-wide preferences. */
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import {
  missingChannelPreferences,
  notificationChannelPreferencesQuery,
  saveNotificationChannelPreferences,
} from "./channel-preferences-api";
import {
  deliveryCategories,
  notificationChannelPreferencesSchema,
  type NotificationChannelPreferences,
} from "./channel-preferences-schema";
import { usePreferenceEditorData } from "./preference-read";
import { PreferenceSaveControls } from "./preference-save-controls";
import "./channel-preferences-i18n";

/** Submit explicit choices without overwriting a newer version or a different account. */
function ChannelPreferencesForm({
  actor,
  initial,
  reload,
}: {
  actor: string;
  initial: NotificationChannelPreferences;
  reload: () => Promise<NotificationChannelPreferences | undefined>;
}) {
  const { t } = useTranslation("channelDelivery");
  const title = useId();
  const online = useOnline();
  const client = useQueryClient();
  const { register, handleSubmit, reset, formState } =
    useForm<NotificationChannelPreferences>({
      resolver: zodResolver(notificationChannelPreferencesSchema),
      defaultValues: initial,
    });
  const save = useMutation({
    mutationFn: async (values: NotificationChannelPreferences) => {
      requireOnline();
      return saveNotificationChannelPreferences(values);
    },
    onSuccess: (saved) => {
      client.setQueryData(
        notificationChannelPreferencesQuery(actor).queryKey,
        saved,
      );
      reset(saved);
    },
  });

  return (
    <form
      className="panel notification-preferences notification-channel-settings"
      aria-labelledby={title}
      onSubmit={handleSubmit((values) => save.mutate(values))}
    >
      <h2 id={title}>{t("title")}</h2>
      <p>{t("description")}</p>
      <input type="hidden" {...register("version", { valueAsNumber: true })} />
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">{t("title")}</legend>
        <table className="notification-channel-matrix" aria-labelledby={title}>
          <thead>
            <tr>
              <th scope="col">{t("category")}</th>
              <th scope="col">{t("email")}</th>
              <th scope="col">{t("push")}</th>
            </tr>
          </thead>
          <tbody>
            {deliveryCategories.map((category) => (
              <tr key={category}>
                <th scope="row">{t(category)}</th>
                <td>
                  <label className="notification-channel-choice">
                    <input
                      type="checkbox"
                      aria-label={t("choice", {
                        category: t(category),
                        channel: t("email"),
                      })}
                      {...register(`channels.email.${category}`)}
                    />
                  </label>
                </td>
                <td>
                  {category === "company_orders" ? (
                    <>
                      <span aria-hidden="true">–</span>
                      <span className="sr-only">{t("unavailable")}</span>
                    </>
                  ) : (
                    <label className="notification-channel-choice">
                      <input
                        type="checkbox"
                        aria-label={t("choice", {
                          category: t(category),
                          channel: t("push"),
                        })}
                        {...register(`channels.push.${category}`)}
                      />
                    </label>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </fieldset>
      <PreferenceSaveControls
        namespace="channelDelivery"
        online={online}
        dirty={formState.isDirty}
        save={save}
        reload={reload}
        reset={reset}
      />
    </form>
  );
}

/** Preserve authorised drafts through transient reads and hide unavailable legacy capability. */
export function ChannelPreferencesSettings({ actor }: { actor: string }) {
  const query = useQuery(notificationChannelPreferencesQuery(actor));
  const preferences = usePreferenceEditorData(query);
  if (missingChannelPreferences(query.error)) return null;
  if (query.isPending) return <Loading />;
  if (!preferences) return <ErrorState retry={() => void query.refetch()} />;
  return (
    <>
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      <ChannelPreferencesForm
        key={actor}
        actor={actor}
        initial={preferences}
        reload={async () => {
          const response = await query.refetch();
          return response.isSuccess ? response.data : undefined;
        }}
      />
    </>
  );
}
