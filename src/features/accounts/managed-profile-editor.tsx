/** Edit only server-authorized basic account fields with optimistic concurrency. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
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
  close,
}: {
  id: string;
  initial: ManagedProfile;
  close: () => void;
}) {
  const { t } = useTranslation("accounts");
  const common = useTranslation().t;
  const online = useOnline();
  const cache = useQueryClient();
  const [values, setValues] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const mutation = useMutation({
    mutationFn: async () => {
      requireOnline();
      const result = await db().rpc("save_managed_profile", {
        p_user_id: id,
        p_payload: values,
        p_expected: initial,
      });
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
      <Field id="managed-name" label={common("displayName")}>
        <input
          id="managed-name"
          required
          maxLength={120}
          value={values.display_name}
          onChange={(e) =>
            setValues({ ...values, display_name: e.target.value })
          }
        />
      </Field>
      <Field id="managed-locale" label={t("profileLanguage")}>
        <select
          id="managed-locale"
          value={values.locale}
          onChange={(e) => setValues({ ...values, locale: e.target.value })}
        >
          <option value="de">Deutsch</option>
          <option value="en">English</option>
        </select>
      </Field>
      <Field id="managed-zone" label={common("timezone")}>
        <input
          id="managed-zone"
          required
          value={values.time_zone}
          onChange={(e) => setValues({ ...values, time_zone: e.target.value })}
        />
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
