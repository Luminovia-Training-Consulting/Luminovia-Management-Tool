import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { installationBrand } from "../../lib/installation-brand";
import {
  useAcademyBrandingQuery,
  saveAcademyBranding,
} from "./academy-branding";
import {
  type AcademyBrandingSettings,
  type AcademyBrandingValues,
  academyBrandColor,
  academyBrandName,
  academyBrandShortName,
} from "./academy-branding-schema";

const releaseBrand = { name: null, short_name: null, theme_color: null };
type Word = (german: string, english: string) => string;

export function AcademyBrandEditor() {
  const { i18n } = useTranslation();
  const word: Word = (de, en) => (i18n.language.startsWith("de") ? de : en);
  const branding = useQuery({
    ...useAcademyBrandingQuery(),
    enabled: Boolean(installationBrand.installationId),
  });
  if (!installationBrand.installationId) return null;
  return (
    <section className="panel" aria-labelledby="academy-branding">
      <h2 id="academy-branding">
        {word("Akademie-Auftritt", "Academy branding")}
      </h2>
      <p>
        {word(
          "Name, Kurzname und Akzentfarbe sind nach dem Speichern sichtbar. Logo und App-Symbole gehören zum signierten Installationspaket.",
          "The name, short name and accent colour appear after saving. The logo and app icons are part of the signed installation package.",
        )}
      </p>
      {branding.isPending ? (
        <Loading />
      ) : branding.isError ? (
        <ErrorState retry={() => void branding.refetch()} />
      ) : (
        <BrandingForm branding={branding.data} word={word} />
      )}
    </section>
  );
}

function BrandingForm({
  branding,
  word,
}: {
  branding: AcademyBrandingSettings;
  word: Word;
}) {
  const cache = useQueryClient();
  const { queryKey } = useAcademyBrandingQuery();
  const [edited, setEdited] = useState<AcademyBrandingValues | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const draft = edited ?? {
    name: branding.name ?? installationBrand.name,
    short_name: branding.short_name ?? installationBrand.shortName,
    theme_color: branding.theme_color ?? installationBrand.themeColor,
  };
  const valid =
    academyBrandName.safeParse(draft.name?.trim()).success &&
    academyBrandShortName.safeParse(draft.short_name?.trim()).success &&
    academyBrandColor.safeParse(draft.theme_color).success;
  const mutation = useMutation({
    mutationFn: (values: AcademyBrandingValues) =>
      saveAcademyBranding(version ?? branding.version, values),
    onSuccess: (result) => {
      cache.setQueryData(queryKey, result);
      setEdited(null);
      setVersion(null);
    },
  });
  function update<K extends keyof AcademyBrandingValues>(
    key: K,
    value: AcademyBrandingValues[K],
  ) {
    setVersion(version ?? branding.version);
    setEdited({ ...draft, [key]: value });
    mutation.reset();
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (valid && edited && !mutation.isPending) mutation.mutate(draft);
  }
  const conflict =
    (mutation.error as { code?: string } | null)?.code === "PT409";
  const reload = async () => {
    await cache.invalidateQueries({ queryKey: queryKey });
    setEdited(null);
    setVersion(null);
    mutation.reset();
  };

  return (
    <form className="stack" onSubmit={submit}>
      <Field
        id="academy-brand-name"
        label={word("Name der Akademie", "Academy name")}
      >
        <input
          required
          maxLength={72}
          value={draft.name ?? ""}
          disabled={mutation.isPending}
          onChange={(event) => update("name", event.target.value)}
        />
      </Field>
      <Field
        id="academy-brand-short-name"
        label={word("Kurzname", "Short name")}
      >
        <input
          required
          maxLength={20}
          value={draft.short_name ?? ""}
          disabled={mutation.isPending}
          onChange={(event) => update("short_name", event.target.value)}
        />
      </Field>
      <Field
        id="academy-brand-colour"
        label={word("Akzentfarbe", "Accent colour")}
      >
        <input
          type="color"
          value={draft.theme_color ?? ""}
          disabled={mutation.isPending}
          onChange={(event) => update("theme_color", event.target.value)}
        />
      </Field>
      <div className="actions">
        <Button
          type="submit"
          disabled={!valid || !edited || mutation.isPending || conflict}
        >
          {word("Auftritt speichern", "Save branding")}
        </Button>
        {branding.name !== null && (
          <Button
            type="button"
            variant="secondary"
            disabled={mutation.isPending || conflict}
            onClick={() => mutation.mutate(releaseBrand)}
          >
            {word("Paketdesign verwenden", "Use package branding")}
          </Button>
        )}
      </div>
      {conflict ? (
        <Notice kind="error">
          {word(
            "Der Auftritt wurde inzwischen geändert.",
            "Branding was updated elsewhere.",
          )}{" "}
          <Button
            type="button"
            variant="secondary"
            onClick={() => void reload()}
          >
            {word("Aktuellen Auftritt laden", "Reload current branding")}
          </Button>
        </Notice>
      ) : mutation.isError ? (
        <Notice kind="error">
          {word(
            "Der Auftritt konnte nicht gespeichert werden.",
            "Branding could not be saved.",
          )}
        </Notice>
      ) : mutation.isSuccess ? (
        <Notice>{word("Auftritt gespeichert.", "Branding saved.")}</Notice>
      ) : null}
    </form>
  );
}
