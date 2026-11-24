import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { LanguageOptions } from "../../components/language-options";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { reportUiPreferenceChange } from "../../lib/preferences";
import { useSaveUiPreferences } from "../../lib/use-save-ui-preferences";
import {
  isAccountLanguage,
  type AccountLanguage,
} from "../../lib/account-languages";

export function ProfileLanguage({
  actor,
  locale,
}: {
  actor: string;
  locale: string;
}) {
  const { t, i18n } = useTranslation();
  const field = useId();
  const online = useOnline();
  const save = useSaveUiPreferences(actor);
  const [draft, setDraft] = useState<AccountLanguage>();
  const saved = isAccountLanguage(locale) ? locale : "de";

  return (
    <form
      className="panel profile-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!online || !draft || draft === saved || save.isPending) return;
        const activeLanguage = i18n.language;
        reportUiPreferenceChange("language");
        save.mutate(
          { language: draft },
          {
            onSuccess: (saved) => {
              if (i18n.language === activeLanguage)
                void i18n.changeLanguage(saved.language);
              setDraft(undefined);
            },
          },
        );
      }}
    >
      <h2>{t("accountLanguage")}</h2>
      <Field
        id={field}
        label={t("accountLanguage")}
        hint={t("accountLanguageHelp")}
      >
        <select
          id={field}
          value={draft ?? saved}
          disabled={save.isPending}
          onChange={(event) => {
            setDraft(event.currentTarget.value as AccountLanguage);
            save.reset();
          }}
        >
          <LanguageOptions />
        </select>
      </Field>
      <Button
        type="submit"
        disabled={!online || !draft || draft === saved || save.isPending}
      >
        {t(save.isPending ? "saving" : "accountLanguageSave")}
      </Button>
      {save.isError && (
        <Notice kind="error">{t("uiPreferenceNotSaved")}</Notice>
      )}
      {save.isSuccess && <Notice>{t("accountLanguageSaved")}</Notice>}
    </form>
  );
}
