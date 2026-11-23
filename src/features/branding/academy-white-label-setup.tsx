import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import {
  academyBrandLinkMaxLength,
  academyPublicLinkFields,
  academyBrandLinksSchema,
  type AcademyBrandLinks,
} from "./academy-brand-links-schema";
import { useAcademyBrandLinksQuery } from "./academy-brand-links";
import {
  academyBrandColor,
  academyBrandName,
  academyBrandShortName,
  type AcademyBrandingSettings,
  type AcademyBrandingValues,
} from "./academy-branding-schema";
import { useAcademyBrandingQuery } from "./academy-branding";
import { AcademyLogoEditor } from "./academy-logo-editor";
import { AcademyPwaIconEditor } from "./academy-pwa-icon-editor";
import { saveAcademyWhiteLabel } from "./academy-white-label";

type Word = (german: string, english: string) => string;

const packageBrand = {
  name: installationBrand.name,
  short_name: installationBrand.shortName,
  theme_color: installationBrand.themeColor,
};
const resetBrand = { name: null, short_name: null, theme_color: null };
const brandFields = [
  ["name", "Name der Akademie", "Academy name", 72],
  ["short_name", "Kurzname", "Short name", 20],
  ["theme_color", "Akzentfarbe", "Accent colour", undefined],
] as const;

function displayBrand(settings: AcademyBrandingSettings) {
  return {
    name: settings.name ?? packageBrand.name,
    short_name: settings.short_name ?? packageBrand.short_name,
    theme_color: settings.theme_color ?? packageBrand.theme_color,
  };
}

export function AcademyWhiteLabelSetup() {
  const { i18n } = useTranslation();
  const word: Word = (de, en) => (i18n.language.startsWith("de") ? de : en);
  const id = useId();
  const [openButton, setOpenButton] = useState<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const online = useOnline();
  if (!installationBrand.installationId) return null;

  return (
    <section className="panel" aria-labelledby={id}>
      <h2 id={id}>{word("Kundeninstallation", "Customer installation")}</h2>
      <p>
        {word(
          "Passe Auftritt und öffentliche Links dieser Installation direkt an.",
          "Change this installation’s branding and public links directly.",
        )}
      </p>
      <Button
        type="button"
        onClick={(event) => {
          setOpenButton(event.currentTarget);
          setOpen(true);
        }}
      >
        {word("White-Label-Einrichtung öffnen", "Open White Label setup")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!saving) setOpen(next);
        }}
        returnFocusTo={openButton}
        closeDisabled={saving}
        title={word("White-Label-Einrichtung", "White Label setup")}
        description={word(
          "Die Einstellungen werden direkt in dieser Installation übernommen.",
          "Settings are applied directly to this installation.",
        )}
      >
        {open && (
          <div className="stack">
            {online ? (
              <>
                <WhiteLabelSettings word={word} onSaving={setSaving} />
                <details>
                  <summary>
                    {word("Logo und App-Symbole", "Logo and app icons")}
                  </summary>
                  <AcademyLogoEditor />
                  <AcademyPwaIconEditor />
                </details>
              </>
            ) : (
              <Notice>
                {word(
                  "Verbinde dich zum Bearbeiten mit dem Internet.",
                  "Connect to the internet to edit the settings.",
                )}
              </Notice>
            )}
            <ConnectionDetails word={word} />
          </div>
        )}
      </Dialog>
    </section>
  );
}

function ConnectionDetails({ word }: { word: Word }) {
  const { origin, protocol } = window.location;
  return (
    <>
      <dl className="stack">
        <div>
          <dt>{word("Aktive Portaladresse", "Current portal address")}</dt>
          <dd>{origin}</dd>
        </div>
        <div>
          <dt>{word("Verbindung", "Connection")}</dt>
          <dd>{protocol === "https:" ? "HTTPS" : "HTTP"}</dd>
        </div>
        <div>
          <dt>{word("Datenregion", "Data region")}</dt>
          <dd>{word("Vom Betreiber verwaltet", "Managed by the operator")}</dd>
        </div>
      </dl>
      <p className="muted">
        {word(
          "Domain, HTTPS und Speicherort werden am Hosting eingerichtet.",
          "The domain, HTTPS and data location are configured at the host.",
        )}
      </p>
    </>
  );
}

type SettingsProps = {
  word: Word;
  onSaving: (saving: boolean) => void;
};

function WhiteLabelSettings(props: SettingsProps) {
  const branding = useQuery(useAcademyBrandingQuery());
  const links = useQuery(useAcademyBrandLinksQuery());
  if (branding.isPending || links.isPending) return <Loading />;
  if (!branding.data || !links.data) {
    return (
      <ErrorState
        retry={() => void Promise.all([branding.refetch(), links.refetch()])}
      />
    );
  }
  return <SetupForm {...props} branding={branding.data} links={links.data} />;
}

type Draft = {
  brandSource: AcademyBrandingSettings;
  linksVersion: number;
  branding: typeof packageBrand;
  links: AcademyBrandLinks;
  restorePackage: boolean;
};

function SetupForm({
  branding,
  links,
  word,
  onSaving,
}: SettingsProps & {
  branding: AcademyBrandingSettings;
  links: AcademyBrandLinks & { version: number };
}) {
  const id = useId();
  const cache = useQueryClient();
  const brandOptions = useAcademyBrandingQuery();
  const linksOptions = useAcademyBrandLinksQuery();
  const [edited, setEdited] = useState<Draft | null>(null);
  const current: Draft = edited ?? {
    brandSource: branding,
    linksVersion: links.version,
    branding: displayBrand(branding),
    links: {
      support_url: links.support_url,
      privacy_url: links.privacy_url,
      legal_url: links.legal_url,
      terms_url: links.terms_url,
    },
    restorePackage: false,
  };
  const enteredBrand = {
    name: current.branding.name.trim(),
    short_name: current.branding.short_name.trim(),
    theme_color: current.branding.theme_color,
  };
  const initialBrand = displayBrand(current.brandSource);
  const brandChanged = brandFields.some(
    ([field]) => enteredBrand[field] !== initialBrand[field],
  );
  const validBrand =
    academyBrandName.safeParse(enteredBrand.name).success &&
    academyBrandShortName.safeParse(enteredBrand.short_name).success &&
    academyBrandColor.safeParse(enteredBrand.theme_color).success;
  const validLinks = academyBrandLinksSchema.safeParse({
    support_url: current.links.support_url?.trim() || null,
    privacy_url: current.links.privacy_url?.trim() || null,
    legal_url: current.links.legal_url?.trim() || null,
    terms_url: current.links.terms_url?.trim() || null,
  });
  const mutation = useMutation({
    mutationFn: (values: {
      brand: AcademyBrandingValues;
      links: AcademyBrandLinks;
    }) =>
      saveAcademyWhiteLabel(
        current.brandSource.version,
        current.linksVersion,
        values.brand,
        values.links,
      ),
    onMutate: () => onSaving(true),
    onSuccess: (result) => {
      cache.setQueryData(brandOptions.queryKey, result.branding);
      cache.setQueryData(linksOptions.queryKey, result.links);
      setEdited(null);
    },
    onSettled: () => onSaving(false),
  });
  const conflict =
    (mutation.error as { code?: string } | null)?.code === "PT409";
  const [reloading, setReloading] = useState(false);
  const [reloadFailed, setReloadFailed] = useState(false);

  function edit(next: Draft) {
    setEdited(next);
    if (!conflict) mutation.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !edited ||
      !validBrand ||
      !validLinks.success ||
      mutation.isPending ||
      reloading ||
      conflict
    )
      return;
    mutation.mutate({
      brand: current.restorePackage
        ? resetBrand
        : brandChanged
          ? enteredBrand
          : current.brandSource,
      links: validLinks.data,
    });
  }

  async function reload() {
    setReloading(true);
    setReloadFailed(false);
    try {
      await Promise.all([
        cache.fetchQuery({ ...brandOptions, staleTime: 0 }),
        cache.fetchQuery({ ...linksOptions, staleTime: 0 }),
      ]);
      setEdited(null);
      mutation.reset();
    } catch {
      setReloadFailed(true);
    } finally {
      setReloading(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {brandFields.map(([field, de, en, maxLength]) => (
        <Field key={field} id={`${id}-${field}`} label={word(de, en)}>
          <input
            required
            type={field === "theme_color" ? "color" : "text"}
            maxLength={maxLength}
            value={current.branding[field]}
            disabled={mutation.isPending || reloading}
            onChange={(event) =>
              edit({
                ...current,
                restorePackage: false,
                branding: { ...current.branding, [field]: event.target.value },
              })
            }
          />
        </Field>
      ))}
      <fieldset className="stack">
        <legend>{word("Öffentliche Links", "Public links")}</legend>
        <p>
          {word(
            "Verwende öffentliche HTTPS-Adressen. Ein leeres Feld blendet den Link aus.",
            "Use public HTTPS addresses. Leaving a field blank hides its link.",
          )}
        </p>
        {academyPublicLinkFields.map(([field, de, en]) => (
          <Field key={field} id={`${id}-${field}`} label={word(de, en)}>
            <input
              type="url"
              maxLength={academyBrandLinkMaxLength}
              placeholder="https://"
              value={current.links[field] ?? ""}
              disabled={mutation.isPending || reloading}
              onChange={(event) =>
                edit({
                  ...current,
                  links: { ...current.links, [field]: event.target.value },
                })
              }
            />
          </Field>
        ))}
        {!validLinks.success && (
          <Notice kind="error">
            {word(
              "Gib gültige HTTPS-Adressen ein.",
              "Enter valid HTTPS addresses.",
            )}
          </Notice>
        )}
      </fieldset>
      <div className="actions">
        <Button
          type="submit"
          disabled={
            !edited ||
            !validBrand ||
            !validLinks.success ||
            mutation.isPending ||
            reloading ||
            conflict
          }
        >
          {word("Einstellungen übernehmen", "Apply settings")}
        </Button>
        {branding.name !== null && (
          <Button
            type="button"
            variant="secondary"
            disabled={mutation.isPending || conflict}
            onClick={() =>
              edit({ ...current, branding: packageBrand, restorePackage: true })
            }
          >
            {word("Paketdesign verwenden", "Use package branding")}
          </Button>
        )}
      </div>
      {conflict ? (
        <Notice kind="error">
          {word(
            "Die Einstellungen wurden inzwischen geändert.",
            "The settings were updated elsewhere.",
          )}{" "}
          <Button
            type="button"
            variant="secondary"
            disabled={reloading}
            onClick={() => void reload()}
          >
            {word("Aktuelle Einstellungen laden", "Reload current settings")}
          </Button>
          {reloadFailed && (
            <p>
              {word(
                "Die aktuellen Einstellungen konnten nicht geladen werden.",
                "The current settings could not be loaded.",
              )}
            </p>
          )}
        </Notice>
      ) : mutation.isError ? (
        <Notice kind="error">
          {word(
            "Die Einstellungen konnten nicht gespeichert werden.",
            "The settings could not be saved.",
          )}
        </Notice>
      ) : mutation.isSuccess ? (
        <Notice>
          {word("Einstellungen übernommen.", "Settings applied.")}
        </Notice>
      ) : null}
    </form>
  );
}
