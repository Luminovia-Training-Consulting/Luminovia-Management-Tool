import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import { isConfigured } from "../../lib/supabase";
import {
  saveAcademyBrandLinks,
  useAcademyBrandLinksQuery,
} from "./academy-brand-links";
import {
  academyBrandLinkMaxLength,
  academyBrandLinksSchema,
  type AcademyBrandLinks,
} from "./academy-brand-links-schema";

const fields = [
  ["support_url", "Support", "Support"],
  ["privacy_url", "Datenschutz", "Privacy policy"],
  ["legal_url", "Impressum", "Legal notice"],
  ["terms_url", "Nutzungsbedingungen", "Terms of use"],
] as const;

function useWord() {
  const { i18n } = useTranslation();
  return (de: string, en: string) => (i18n.language.startsWith("de") ? de : en);
}

export function AcademyBrandLinksFooter() {
  const word = useWord();
  const online = useOnline();
  const links = useQuery({
    ...useAcademyBrandLinksQuery(),
    enabled:
      online && isConfigured && Boolean(installationBrand.installationId),
  });
  const current = links.data;
  if (!current || !fields.some(([key]) => current[key])) return null;
  return (
    <footer className="academy-public-links">
      <nav
        aria-label={word(
          "Support und Rechtliches",
          "Support and legal information",
        )}
      >
        {fields.map(([key, de, en]) => {
          const href = current[key];
          return href ? (
            <a key={key} href={href} target="_blank" rel="noopener noreferrer">
              {word(de, en)}
            </a>
          ) : null;
        })}
      </nav>
    </footer>
  );
}

export function AcademyBrandLinksEditor() {
  const word = useWord();
  const online = useOnline();
  const options = useAcademyBrandLinksQuery();
  const query = useQuery({
    ...options,
    enabled: online && Boolean(installationBrand.installationId),
  });
  const cache = useQueryClient();
  const [edit, setEdit] = useState<{
    version: number;
    links: AcademyBrandLinks;
  } | null>(null);
  const mutation = useMutation({
    mutationFn: (next: NonNullable<typeof edit>) =>
      saveAcademyBrandLinks(next.version, next.links),
    onSuccess: (saved) => {
      cache.setQueryData(options.queryKey, saved);
      setEdit(null);
    },
  });
  const conflict =
    (mutation.error as { code?: string } | null)?.code === "PT409";
  const source = query.data;
  const current = edit?.links ?? source;
  const validation =
    edit &&
    academyBrandLinksSchema.safeParse({
      support_url: edit.links.support_url?.trim() || null,
      privacy_url: edit.links.privacy_url?.trim() || null,
      legal_url: edit.links.legal_url?.trim() || null,
      terms_url: edit.links.terms_url?.trim() || null,
    });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      online &&
      edit &&
      validation?.success &&
      !mutation.isPending &&
      !conflict
    )
      mutation.mutate({ version: edit.version, links: validation.data });
  }

  async function loadCurrent() {
    const refreshed = await query.refetch();
    if (!refreshed.isSuccess) return;
    setEdit(null);
    mutation.reset();
  }

  if (!installationBrand.installationId) return null;
  return (
    <section className="panel" aria-labelledby="academy-brand-links">
      <h2 id="academy-brand-links">
        {word("Öffentliche Links", "Public links")}
      </h2>
      <p>
        {word(
          "Diese Links sind auch vor der Anmeldung sichtbar. Verwenden Sie öffentliche HTTPS-Adressen. Leere Felder blenden den jeweiligen Link aus.",
          "These links are visible before sign-in. Use public HTTPS addresses. Leave a field blank to hide its link.",
        )}
      </p>
      {!online ? (
        <Notice>
          {word(
            "Verbinden Sie sich zum Bearbeiten mit dem Internet.",
            "Connect to the internet to edit these links.",
          )}
        </Notice>
      ) : query.isPending ? (
        <Loading />
      ) : !source || !current ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <form className="stack" onSubmit={submit}>
          {fields.map(([key, de, en]) => (
            <Field
              key={key}
              id={`academy-brand-link-${key}`}
              label={word(de, en)}
            >
              <input
                type="url"
                maxLength={academyBrandLinkMaxLength}
                placeholder="https://"
                value={current[key] ?? ""}
                disabled={mutation.isPending}
                onChange={(event) => {
                  setEdit({
                    version: edit?.version ?? source.version,
                    links: { ...current, [key]: event.target.value },
                  });
                  if (!conflict) mutation.reset();
                }}
              />
            </Field>
          ))}
          {validation && !validation.success && (
            <Notice kind="error">
              {word(
                "Geben Sie für jeden sichtbaren Link eine vollständige HTTPS-Adresse ein.",
                "Enter a full HTTPS address for every visible link.",
              )}
            </Notice>
          )}
          <div className="actions">
            <Button
              type="submit"
              disabled={!validation?.success || mutation.isPending || conflict}
            >
              {word("Links speichern", "Save links")}
            </Button>
          </div>
          {conflict ? (
            <Notice kind="error">
              {word(
                "Die Links wurden inzwischen geändert.",
                "The links were updated elsewhere.",
              )}{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={() => void loadCurrent()}
              >
                {word("Aktuelle Links laden", "Reload current links")}
              </Button>
            </Notice>
          ) : mutation.isError ? (
            <Notice kind="error">
              {word(
                "Die Links konnten nicht gespeichert werden.",
                "The links could not be saved.",
              )}
            </Notice>
          ) : mutation.isSuccess ? (
            <Notice>{word("Links gespeichert.", "Links saved.")}</Notice>
          ) : null}
        </form>
      )}
    </section>
  );
}
