import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { useOnline } from "../../lib/online";
import { AcademyLogoImage } from "./academy-logo-image";
import { useAcademyBrand } from "./academy-branding";
import {
  academyPwaIconQuery,
  prepareAcademyPwaImages,
  publishedAcademyPwaIcon,
  saveAcademyPwaIcon,
  type AcademyPwaImages,
} from "./academy-pwa-icon";

type Draft = { version: number; images: AcademyPwaImages };

export function AcademyPwaIconEditor() {
  const { i18n } = useTranslation();
  const word = (de: string, en: string) =>
    i18n.language.startsWith("de") ? de : en;
  const online = useOnline();
  const brand = useAcademyBrand();
  const cache = useQueryClient();
  const options = academyPwaIconQuery();
  const current = useQuery({ ...options, enabled: online });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [processing, setProcessing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [resetVersion, setResetVersion] = useState<number | null>(null);
  const mutation = useMutation({
    mutationFn: ({
      version,
      images,
    }: {
      version: number;
      images: AcademyPwaImages | null;
    }) => saveAcademyPwaIcon(version, images),
    onSuccess: (settings) => {
      cache.setQueryData(options.queryKey, settings);
      setDraft(null);
    },
  });
  const conflict =
    (mutation.error as { code?: string } | null)?.code === "PT409";
  const busy = processing || mutation.isPending || conflict;
  const label = word("App-Symbol", "App icon");

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !current.data || busy) return;
    setDraft(null);
    setInvalid(false);
    mutation.reset();
    setProcessing(true);
    try {
      const images = await prepareAcademyPwaImages(file, brand.themeColor);
      setDraft({ version: current.data.version, images });
    } catch {
      setInvalid(true);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="academy-pwa-icon">
      <h2 id="academy-pwa-icon">{label}</h2>
      <p>
        {word(
          "Wähle eine PNG-Datei mit 512 × 512 Pixeln und höchstens 1 MB. Das Portal erstellt die passenden App-Symbole für die Installation und den Startbildschirm.",
          "Choose a 512 × 512 PNG file up to 1 MB. The portal prepares app icons for installation and the home screen.",
        )}
      </p>
      {!online ? (
        <Notice>
          {word(
            "Verbinde dich zum Bearbeiten mit dem Internet.",
            "Connect to the internet to edit the app icon.",
          )}
        </Notice>
      ) : current.isPending ? (
        <Loading />
      ) : !current.data ? (
        <ErrorState retry={() => void current.refetch()} />
      ) : (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft && !busy) mutation.mutate(draft);
          }}
        >
          <Field
            id="academy-pwa-icon-file"
            label={word("PNG für App-Symbol", "App icon PNG")}
          >
            <input
              id="academy-pwa-icon-file"
              type="file"
              accept="image/png,.png"
              disabled={busy}
              onChange={(event) => void choose(event)}
            />
          </Field>
          {draft ? (
            <AcademyLogoImage
              className="academy-logo-preview"
              blob={draft.images.icon_512}
              alt={word("Vorschau des App-Symbols", "App icon preview")}
            />
          ) : (
            <img
              className="academy-logo-preview"
              width={72}
              height={72}
              src={
                current.data.custom
                  ? publishedAcademyPwaIcon(current.data.version)
                  : brand.appleTouchIcon
              }
              alt={word("Aktuelles App-Symbol", "Current app icon")}
            />
          )}
          {invalid && (
            <Notice kind="error">
              {word(
                "Diese PNG-Datei erfüllt die Anforderungen an das App-Symbol nicht.",
                "This PNG file does not meet the app icon requirements.",
              )}
            </Notice>
          )}
          <div className="actions">
            <Button type="submit" disabled={!draft || busy}>
              {word("App-Symbol veröffentlichen", "Publish app icon")}
            </Button>
            {current.data.custom && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => setResetVersion(current.data.version)}
              >
                {word("Paketsymbol verwenden", "Use package icon")}
              </Button>
            )}
          </div>
          {conflict ? (
            <Notice kind="error">
              {word(
                "Das App-Symbol wurde inzwischen geändert.",
                "The app icon was updated elsewhere.",
              )}{" "}
              <Button
                type="button"
                variant="secondary"
                onClick={async () => {
                  if ((await current.refetch()).isSuccess) {
                    setDraft(null);
                    mutation.reset();
                  }
                }}
              >
                {word("Aktuelles Symbol laden", "Reload current icon")}
              </Button>
            </Notice>
          ) : mutation.isError ? (
            <Notice kind="error">
              {word(
                "Das App-Symbol konnte nicht veröffentlicht werden.",
                "The app icon could not be published.",
              )}
            </Notice>
          ) : mutation.isSuccess ? (
            <Notice>
              {word(
                "App-Symbol gespeichert. Browser und Betriebssystem bestimmen, wann das Symbol einer installierten App aktualisiert wird.",
                "App icon saved. The browser and operating system decide when an installed app’s icon updates.",
              )}
            </Notice>
          ) : null}
        </form>
      )}
      <Dialog
        open={resetVersion !== null}
        onOpenChange={(open) => {
          if (!open) setResetVersion(null);
        }}
        title={word("Paketsymbol verwenden?", "Use the package icon?")}
        description={word(
          "Das Standard-App-Symbol dieser Installation wird wieder veröffentlicht.",
          "The installation’s default app icon will be published again.",
        )}
      >
        <Button
          type="button"
          disabled={!online || busy || resetVersion === null}
          onClick={() => {
            if (resetVersion !== null)
              mutation.mutate({ version: resetVersion, images: null });
            setResetVersion(null);
          }}
        >
          {word("Paketsymbol bestätigen", "Confirm package icon")}
        </Button>
      </Dialog>
    </section>
  );
}
