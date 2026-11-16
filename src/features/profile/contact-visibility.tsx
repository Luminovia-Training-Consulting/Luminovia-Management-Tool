import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import {
  contactVisibilityKey,
  contactVisibilityQuery,
  saveContactVisibility,
  type ContactPreferences,
} from "./contact-api";
import "./contact-i18n";
import "./contact.css";

function VisibilityForm({
  actor,
  initial,
  reload,
}: {
  actor: string;
  initial: ContactPreferences;
  reload: () => Promise<ContactPreferences | undefined>;
}) {
  const { t } = useTranslation("contact");
  const online = useOnline();
  const client = useQueryClient();
  const [draft, setDraft] = useState({
    email_visible: initial.email_visible,
    phone_visible: initial.phone_visible,
    version: initial.version,
  });
  const save = useMutation({
    mutationFn: saveContactVisibility,
    onSuccess: async (data) => {
      client.setQueryData(contactVisibilityKey(actor), data);
      setDraft({
        email_visible: data.email_visible,
        phone_visible: data.phone_visible,
        version: data.version,
      });
      await client.invalidateQueries({ queryKey: ["person-contact"] });
    },
  });
  const conflict = Boolean(
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001",
  );
  const dirty =
    draft.email_visible !== initial.email_visible ||
    draft.phone_visible !== initial.phone_visible;
  return (
    <form
      className="panel profile-form contact-visibility-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(draft);
      }}
    >
      <h2>{t("title")}</h2>
      <p>{t("help")}</p>
      <p>{t("savedEmail", { value: initial.email_address ?? t("missing") })}</p>
      <p>{t("savedPhone", { value: initial.phone_number ?? t("missing") })}</p>
      {!initial.can_share && <p>{t("role")}</p>}
      <fieldset disabled={save.isPending || !initial.can_share}>
        <legend className="sr-only">{t("title")}</legend>
        {(["email_visible", "phone_visible"] as const).map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={draft[key]}
              onChange={(event) =>
                setDraft((value) => ({ ...value, [key]: event.target.checked }))
              }
            />
            {t(key === "email_visible" ? "email" : "phone")}
          </label>
        ))}
      </fieldset>
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
                setDraft({
                  email_visible: data.email_visible,
                  phone_visible: data.phone_visible,
                  version: data.version,
                });
                save.reset();
              }
            })
          }
        >
          {t("reload")}
        </Button>
      )}
      {save.isSuccess && !dirty && <Notice>{t("saved")}</Notice>}
      <Button
        type="submit"
        disabled={!online || save.isPending || !dirty || !initial.can_share}
      >
        {t("save")}
      </Button>
    </form>
  );
}
export function OwnContactVisibility({ actor }: { actor: string }) {
  const query = useQuery(contactVisibilityQuery(actor));
  return query.isPending ? (
    <Loading />
  ) : query.isError ? (
    <ErrorState retry={() => void query.refetch()} />
  ) : (
    <VisibilityForm
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
