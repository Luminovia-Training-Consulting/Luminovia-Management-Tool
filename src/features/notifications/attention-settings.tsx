import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { useId } from "react";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { useAuth } from "../auth/auth-context";
import { notificationKeys } from "./api";
import {
  attentionKey,
  type AttentionPreferences,
  attentionQuery,
  attentionSchema,
  saveAttentionPreferences,
} from "./attention-api";
import "./attention-i18n";

function QuietHoursForm({
  actor,
  initial,
  reload,
}: {
  actor: string;
  initial: AttentionPreferences;
  reload: () => Promise<AttentionPreferences | undefined>;
}) {
  const { t } = useTranslation("attention");
  const formId = useId();
  const online = useOnline();
  const client = useQueryClient();
  const { register, handleSubmit, reset, formState } =
    useForm<AttentionPreferences>({
      resolver: zodResolver(attentionSchema),
      defaultValues: initial,
    });
  const save = useMutation({
    mutationFn: async (value: AttentionPreferences) => {
      requireOnline();
      return saveAttentionPreferences(value);
    },
    onSuccess: async (data) => {
      client.setQueryData(attentionKey(actor), data);
      reset(data);
      await client.invalidateQueries({ queryKey: notificationKeys.all(actor) });
    },
  });
  const conflict = Boolean(
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001",
  );
  return (
    <form
      className="panel notification-preferences"
      onSubmit={handleSubmit((value) => save.mutate(value))}
    >
      <input type="hidden" {...register("version", { valueAsNumber: true })} />
      <fieldset disabled={save.isPending}>
        <legend>{t("title")}</legend>
        <p>{t("help")}</p>
        <label className="notification-preference">
          <input type="checkbox" {...register("enabled")} />
          <span>{t("enabled")}</span>
        </label>
        <div className="attention-time-fields">
          <Field id={`${formId}-start`} label={t("start")}>
            <input type="time" step={60} required {...register("start_time")} />
          </Field>
          <Field id={`${formId}-end`} label={t("end")}>
            <input type="time" step={60} required {...register("end_time")} />
          </Field>
          <Field id={`${formId}-zone`} label={t("zone")}>
            <input required maxLength={100} {...register("time_zone")} />
          </Field>
        </div>
        <p>{t("interval")}</p>
      </fieldset>
      {Object.keys(formState.errors).length > 0 && (
        <Notice kind="error">{t("invalid")}</Notice>
      )}
      {save.isError && (
        <Notice kind="error">{t(conflict ? "conflict" : "error")}</Notice>
      )}
      {conflict && (
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            void reload().then((data) => {
              if (data) {
                reset(data);
                save.reset();
              }
            })
          }
        >
          {t("reload")}
        </Button>
      )}
      {save.isSuccess && !formState.isDirty && <Notice>{t("saved")}</Notice>}
      <Button
        type="submit"
        disabled={!online || save.isPending || !formState.isDirty}
      >
        {t("save")}
      </Button>
    </form>
  );
}

export function QuietHoursSettings() {
  const { t } = useTranslation("attention");
  const actor = useAuth().session!.user.id;
  const query = useQuery(attentionQuery(actor));
  return (
    <section className="attention-settings" aria-label={t("title")}>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <>
          <h2>{t("title")}</h2>
          <ErrorState retry={() => void query.refetch()} />
        </>
      ) : (
        <QuietHoursForm
          key={actor}
          actor={actor}
          initial={query.data}
          reload={async () => {
            const result = await query.refetch();
            return result.isSuccess ? result.data : undefined;
          }}
        />
      )}
    </section>
  );
}
