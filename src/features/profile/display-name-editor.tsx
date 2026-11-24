import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";

export function DisplayNameEditor({
  initial,
  save,
}: {
  initial: string;
  save: (name: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"saved" | "error" | null>(null);
  const value = draft ?? initial;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = value.trim();
    if (!online || busy || !name || name.length > 120 || name === initial)
      return;
    setResult(null);
    setBusy(true);
    try {
      await save(name);
      setDraft(null);
      setResult("saved");
    } catch {
      setResult("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="panel profile-form"
      onSubmit={(event) => void submit(event)}
    >
      <Field id="profile-display-name" label={t("displayName")}>
        <input
          id="profile-display-name"
          value={value}
          maxLength={120}
          disabled={busy}
          onChange={(event) => {
            setDraft(event.target.value);
            setResult(null);
          }}
        />
      </Field>
      <Button
        disabled={!online || busy || !value.trim() || value.trim() === initial}
      >
        {t("save")}
      </Button>
      {result && (
        <Notice kind={result === "saved" ? "success" : "error"}>
          {t(result)}
        </Notice>
      )}
    </form>
  );
}
