/** Manage the server-side disclosure window for the current portal installation. */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { permissionsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import {
  assignmentCustomerMode,
  assignmentCustomerSettingsSchema,
} from "./assignment-customer-settings-schema";

type Policy = z.infer<typeof assignmentCustomerSettingsSchema>;
type Copy = (de: string, en: string) => string;

/** Recheck current job-management authority and load the contract under the actor's identity. */
export function AssignmentCustomerSettingsPage() {
  const actor = useAuth().session!.user.id;
  const online = useOnline();
  const { t, i18n } = useTranslation();
  const word: Copy = (de, en) => (i18n.language.startsWith("de") ? de : en);
  const permissions = useQuery(permissionsQuery(actor));
  const allowed =
    permissions.isSuccess && permissions.data.includes("jobs.manage");
  const queryKey = ["assignment-customer-settings", actor];
  const policy = useQuery({
    queryKey,
    enabled: allowed && online,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("assignment_customer_settings")
        .abortSignal(signal);
      if (error) throw error;
      return assignmentCustomerSettingsSchema.parse(data);
    },
  });

  return (
    <>
      <PageHeading title={t("assignmentCustomerSettings")} />
      {!online ? (
        <Notice kind="error">
          {word(
            "Diese Einstellung ist nur online verfügbar.",
            "This setting is available online.",
          )}
        </Notice>
      ) : permissions.isPending || (allowed && policy.isPending) ? (
        <Loading />
      ) : permissions.isError || policy.isError ? (
        <ErrorState
          retry={() =>
            void (allowed ? policy.refetch() : permissions.refetch())
          }
        />
      ) : allowed && policy.data ? (
        <PolicyForm
          key={actor}
          initial={policy.data}
          queryKey={queryKey}
          word={word}
          refresh={async () => {
            const result = await policy.refetch();
            return result.isSuccess ? result.data : undefined;
          }}
        />
      ) : (
        <Notice kind="error">
          {word(
            "Hierfür ist die Berechtigung zur Auftragsverwaltung erforderlich.",
            "Job management permission is required.",
          )}
        </Notice>
      )}
    </>
  );
}

/** Keep unsaved edits stable across background reads. A stale revision can be reloaded explicitly. */
function PolicyForm({
  initial,
  queryKey,
  word,
  refresh,
}: {
  initial: Policy;
  queryKey: string[];
  word: Copy;
  refresh: () => Promise<Policy | undefined>;
}) {
  const cache = useQueryClient();
  const [saved, setSaved] = useState(initial);
  const [mode, setMode] = useState(initial.mode);
  const [hours, setHours] = useState(String(initial.lead_hours));
  const [reloading, setReloading] = useState(false);
  const { t } = useTranslation();
  const save = useMutation({
    mutationFn: async () => {
      const { data, error } = await db().rpc(
        "save_assignment_customer_settings",
        {
          p_mode: mode,
          p_lead_hours: Number(hours),
          p_expected_revision: saved.revision,
        },
      );
      if (error) throw error;
      return assignmentCustomerSettingsSchema.parse(data);
    },
    onSuccess: (next) => {
      setSaved(next);
      cache.setQueryData(queryKey, next);
      void cache.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const changed = mode !== saved.mode || hours !== String(saved.lead_hours);
  const stale =
    save.isError && (save.error as { code?: string })?.code === "40001";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (changed && !save.isPending && !stale) save.mutate();
  };

  const reload = async () => {
    setReloading(true);
    try {
      const next = await refresh();
      if (next) {
        setSaved(next);
        setMode(next.mode);
        setHours(String(next.lead_hours));
        save.reset();
      }
    } finally {
      setReloading(false);
    }
  };

  return (
    <form className="panel section-stack" onSubmit={submit}>
      <p>
        {word(
          "Lege fest, wann bestätigte Dozierende Angaben zum Unternehmen und zur Ansprechperson sehen.",
          "Choose when confirmed lecturers can see the company and its contact details.",
        )}
      </p>
      <Field
        id="assignment-customer-mode"
        label={word("Freigabe", "Disclosure")}
      >
        <select
          value={mode}
          disabled={save.isPending || reloading}
          onChange={(event) =>
            setMode(assignmentCustomerMode.parse(event.currentTarget.value))
          }
        >
          <option value="scheduled">
            {word("Vor dem ersten Termin", "Before the first session")}
          </option>
          <option value="on_confirmation">
            {word("Bei bestätigter Übernahme", "On confirmed acceptance")}
          </option>
          <option value="management_only">
            {word("Nur für die Verwaltung", "Management only")}
          </option>
        </select>
      </Field>
      {mode === "scheduled" && (
        <Field
          id="assignment-customer-lead-hours"
          label={word(
            "Stunden vor dem ersten Termin",
            "Hours before the first session",
          )}
        >
          <input
            type="number"
            min="0"
            max="8760"
            step="1"
            required
            value={hours}
            disabled={save.isPending || reloading}
            onChange={(event) => setHours(event.currentTarget.value)}
          />
        </Field>
      )}
      {mode === "scheduled" && (
        <p className="muted">
          {word(
            "168 Stunden entsprechen der Sieben-Tage-Rücktrittsfrist. Ein größerer Wert legt die Freigabe vor den Fristablauf.",
            "168 hours matches the seven-day withdrawal deadline. A higher value discloses the details before that deadline.",
          )}
        </p>
      )}
      <div className="form-actions">
        <Button
          type="submit"
          disabled={!changed || save.isPending || stale || reloading}
        >
          {t("save")}
        </Button>
        {stale && (
          <Button
            type="button"
            variant="secondary"
            disabled={reloading}
            onClick={() => void reload()}
          >
            {word("Aktuelle Einstellung laden", "Reload current setting")}
          </Button>
        )}
      </div>
      {save.isError && (
        <Notice kind="error">
          {stale
            ? word(
                "Die Einstellung wurde inzwischen geändert.",
                "The setting has changed since you loaded it.",
              )
            : word(
                "Die Einstellung konnte nicht gespeichert werden.",
                "The setting could not be saved.",
              )}
        </Notice>
      )}
      {save.isSuccess && !changed && (
        <Notice>{word("Einstellung gespeichert.", "Setting saved.")}</Notice>
      )}
    </form>
  );
}
