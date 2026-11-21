import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { validateAvatar } from "../../../supabase/functions/files/avatar";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { useOnline } from "../../lib/online";
import { AcademyLogoImage } from "./academy-logo-image";
import { academyLogoMaxBytes } from "./academy-logo-schema";
import { saveAcademyLogo, useAcademyLogoQuery } from "./academy-logo";

type Edit = { file: File; version: number };

export function AcademyLogoEditor() {
  const { i18n } = useTranslation();
  const word = (de: string, en: string) =>
    i18n.language.startsWith("de") ? de : en;
  const online = useOnline();
  const options = useAcademyLogoQuery();
  const query = useQuery({ ...options, enabled: online });
  const cache = useQueryClient();
  const check = useRef(0);
  const [draft, setDraft] = useState<Edit | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [validating, setValidating] = useState(false);
  const [resetVersion, setResetVersion] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: ({ version, file }: { version: number; file: File | null }) =>
      saveAcademyLogo(version, file),
    onSuccess: (result) => {
      cache.setQueryData(options.queryKey, result);
      setDraft(null);
    },
  });
  const errorCode = (mutation.error as { code?: string } | null)?.code;
  const conflict = errorCode === "PT409";
  const disabled = validating || mutation.isPending || conflict;

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    const version = query.data?.version;
    if (!file || version === undefined || disabled) return;
    setInvalid(false);
    setDraft(null);
    mutation.reset();
    const revision = ++check.current;
    setValidating(true);
    try {
      if (file.type !== "image/png" || file.size > academyLogoMaxBytes)
        throw new Error("invalid_logo");
      await validateAvatar(
        new Uint8Array(await file.arrayBuffer()),
        academyLogoMaxBytes + 1,
      );
      if (revision === check.current) setDraft({ file, version });
    } catch {
      if (revision === check.current) setInvalid(true);
    } finally {
      if (revision === check.current) setValidating(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft && !disabled && online) mutation.mutate(draft);
  }

  async function reload() {
    const refreshed = await query.refetch();
    if (!refreshed.isSuccess) return;
    setDraft(null);
    mutation.reset();
  }

  return (
    <section className="panel" aria-labelledby="academy-logo">
      <h2 id="academy-logo">{word("Akademie-Logo", "Academy logo")}</h2>
      <p>
        {word(
          "Das Logo erscheint bei der Anmeldung und im Kursportal. Wähle eine RGB- oder RGBA-PNG-Datei ohne Metadaten mit höchstens 512 × 512 Pixeln und 256 KiB. App-Symbole gehören zum signierten Installationspaket.",
          "The logo appears at sign-in and in the course portal. Choose an RGB or RGBA PNG without metadata, up to 512 × 512 pixels and 256 KiB. App icons come from the signed installation package.",
        )}
      </p>
      {!online ? (
        <Notice>
          {word(
            "Verbinde dich zum Bearbeiten mit dem Internet.",
            "Connect to the internet to edit the logo.",
          )}
        </Notice>
      ) : query.isPending ? (
        <Loading />
      ) : !query.data ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <form className="stack" onSubmit={submit}>
          <Field id="academy-logo-file" label={word("PNG-Datei", "PNG file")}>
            <input
              type="file"
              accept="image/png,.png"
              disabled={disabled}
              onChange={(event) => void selectFile(event)}
            />
          </Field>
          {draft && (
            <AcademyLogoImage
              blob={draft.file}
              className="academy-logo-preview"
              alt={word("Vorschau des neuen Logos", "Preview of the new logo")}
            />
          )}
          {invalid && (
            <Notice kind="error">
              {word(
                "Diese PNG-Datei erfüllt die Voraussetzungen für ein Logo nicht.",
                "This PNG does not meet the logo requirements.",
              )}
            </Notice>
          )}
          <div className="actions">
            <Button type="submit" disabled={disabled || !draft}>
              {word("Logo veröffentlichen", "Publish logo")}
            </Button>
            {query.data.png_base64 && (
              <Button
                type="button"
                variant="secondary"
                disabled={disabled}
                onClick={() => setResetVersion(query.data.version)}
              >
                {word("Paketlogo verwenden", "Use package logo")}
              </Button>
            )}
          </div>
          {conflict ? (
            <Notice kind="error">
              {word(
                "Das Logo wurde inzwischen geändert.",
                "The logo was updated elsewhere.",
              )}{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() => void reload()}
              >
                {word("Aktuelles Logo laden", "Reload current logo")}
              </Button>
            </Notice>
          ) : mutation.isError ? (
            <Notice kind="error">
              {word(
                "Das Logo konnte nicht gespeichert werden. Das bisherige Logo bleibt aktiv.",
                "The logo could not be saved. The previous logo remains active.",
              )}
            </Notice>
          ) : mutation.isSuccess ? (
            <Notice>{word("Logo gespeichert.", "Logo saved.")}</Notice>
          ) : null}
        </form>
      )}
      <Dialog
        open={resetVersion !== null}
        onOpenChange={(open) => {
          if (!open) setResetVersion(null);
        }}
        title={word("Paketlogo verwenden?", "Use the package logo?")}
        description={word(
          "Das aktuelle öffentliche Logo wird durch das Logo der Installation ersetzt.",
          "The public logo will be replaced by the installation's original logo.",
        )}
      >
        <Button
          type="button"
          disabled={resetVersion === null || disabled || !online}
          onClick={() => {
            if (resetVersion !== null)
              mutation.mutate({ version: resetVersion, file: null });
            setResetVersion(null);
          }}
        >
          {word("Paketlogo bestätigen", "Confirm package logo")}
        </Button>
      </Dialog>
    </section>
  );
}
