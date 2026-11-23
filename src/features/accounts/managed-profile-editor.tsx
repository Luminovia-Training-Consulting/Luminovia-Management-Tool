/** Edit only server-authorized basic account fields with optimistic concurrency. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { Dialog } from "../../components/ui/dialog";
import { validZone } from "../../lib/dates";
import "./i18n";

interface ManagedProfile {
  display_name: string;
  locale: string;
  time_zone: string;
}

function Form({
  id,
  initial,
  organisationId,
  close,
}: {
  id: string;
  initial: ManagedProfile;
  organisationId?: string;
  close: () => void;
}) {
  const { t } = useTranslation("accounts");
  const common = useTranslation().t;
  const fieldId = useId();
  const online = useOnline();
  const cache = useQueryClient();
  const [values, setValues] = useState(initial);
  const [expected] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      requireOnline();
      const fields = { p_user_id: id, p_payload: values, p_expected: expected };
      const result = organisationId
        ? await db().rpc("save_company_participant_profile", {
            ...fields,
            p_organisation_id: organisationId,
          })
        : await db().rpc("save_managed_profile", fields);
      if (result.error) throw result.error;
    },
    onSuccess: async () => {
      await cache.invalidateQueries();
      close();
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!values.display_name.trim() || !validZone(values.time_zone)) {
          setInvalid(true);
          return;
        }
        setInvalid(false);
        mutation.mutate();
      }}
    >
      <Field id={`${fieldId}-name`} label={common("displayName")}>
        <input
          id={`${fieldId}-name`}
          required
          maxLength={120}
          value={values.display_name}
          onChange={(e) =>
            setValues({ ...values, display_name: e.target.value })
          }
        />
      </Field>
      <Field id={`${fieldId}-locale`} label={t("profileLanguage")}>
        <select
          id={`${fieldId}-locale`}
          value={values.locale}
          onChange={(e) => setValues({ ...values, locale: e.target.value })}
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </Field>
      <Field id={`${fieldId}-zone`} label={common("timezone")}>
        <select
          id={`${fieldId}-zone`}
          required
          value={values.time_zone}
          onChange={(e) => setValues({ ...values, time_zone: e.target.value })}
        >
          <TimeZoneOptions current={values.time_zone} />
        </select>
      </Field>
      <Button disabled={!online || mutation.isPending}>{common("save")}</Button>
      {(mutation.isError || invalid) && (
        <Notice kind="error">{t("profileSaveFailed")}</Notice>
      )}
    </form>
  );
}

export function ManagedProfileEditor({
  actor,
  id,
  close,
}: {
  actor: string;
  id: string;
  close: () => void;
}) {
  const query = useQuery({
    queryKey: ["managed-profile", actor, id],
    queryFn: async () => {
      const result = await db().rpc("managed_profile", { p_user_id: id });
      if (result.error || !result.data)
        throw result.error ?? new Error("not_found");
      return result.data as ManagedProfile;
    },
    retry: false,
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  return <Form key={id} id={id} initial={query.data} close={close} />;
}

/** Only an eligible company relationship exposes the shared-profile editor. */
export function CompanyParticipantProfileSettings({
  actor,
  id,
  organisationId,
  name,
}: {
  actor: string;
  id: string;
  organisationId: string;
  name: string;
}) {
  const { t } = useTranslation("accounts");
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const profile = useQuery({
    queryKey: ["company-participant-profile", actor, organisationId, id],
    enabled: online,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("company_participant_profile", {
          p_user_id: id,
          p_organisation_id: organisationId,
        })
        .abortSignal(signal);
      if (error?.code === "42501") return null;
      if (error) throw error;
      return data as ManagedProfile | null;
    },
  });
  if (!online || profile.isPending) return null;
  if (profile.isError)
    return <ErrorState retry={() => void profile.refetch()} />;
  if (!profile.data)
    return <p className="muted">{t("participantProfileShared")}</p>;
  return (
    <>
      <Button variant="secondary" onClick={() => setEditing(true)}>
        {t("editProfile")}
      </Button>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t("editProfile")}
        description={name}
      >
        {editing && (
          <Form
            id={id}
            organisationId={organisationId}
            initial={profile.data}
            close={() => setEditing(false)}
          />
        )}
      </Dialog>
    </>
  );
}
