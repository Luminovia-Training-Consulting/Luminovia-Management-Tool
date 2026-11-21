/** Own passport download adapts the shared authenticated, no-store PDF gateway.
 * No browser-supplied user ID or certificate file enters the request. */
import { downloadPortalDocument } from "../learning/api";

/** The shared downloader rechecks identity before releasing the Blob URL. */
export async function downloadQualificationPassport(
  locale: "de" | "en",
  signal: AbortSignal,
) {
  await downloadPortalDocument(
    { kind: "qualification_passport", locale },
    `Luminovia-${locale === "de" ? "Qualifikationspass" : "Qualification-passport"}.pdf`,
    signal,
  );
}
