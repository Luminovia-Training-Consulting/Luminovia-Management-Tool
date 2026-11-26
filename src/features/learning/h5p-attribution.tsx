/** Show retained attribution wherever a quiz serves an imported question. */
import { useTranslation } from "react-i18next";
import type { H5pAttribution as Credits } from "./h5p-import-schema";
import "./h5p-import-i18n";

const licences = {
  "CC0-1.0": ["CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"],
  "CC-BY-4.0": ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
} as const;

export function H5pAttribution({
  credits,
  questionSource = false,
}: {
  credits: Credits;
  questionSource?: boolean;
}) {
  const { t } = useTranslation("learning");
  const [licenseLabel, licenseUrl] = licences[credits.license];
  return (
    <details className="space-y-2">
      <summary>
        {t(questionSource ? "h5pQuestionAttribution" : "h5pAttribution")} ·{" "}
        {licenseLabel}
      </summary>
      <p className="preserve-text">{credits.title}</p>
      {credits.authors.length > 0 && (
        <p className="preserve-text">
          {credits.authors.map(({ name }) => name).join(", ")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={licenseUrl} target="_blank" rel="noopener noreferrer">
          {licenseLabel}
        </a>
        {credits.source_url && (
          <a
            href={credits.source_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("h5pAttributionSource")}
          </a>
        )}
      </div>
      {credits.license_notice && (
        <p className="preserve-text">{credits.license_notice}</p>
      )}
      {credits.changes.length > 0 && (
        <ul className="list-disc ps-6">
          {credits.changes.map(({ author, date, log }, index) => (
            <li key={index} className="preserve-text">
              {date} · {author} · {log}
            </li>
          ))}
        </ul>
      )}
      {credits.subcontent && (
        <H5pAttribution credits={credits.subcontent} questionSource />
      )}
      <p>{t("h5pAttributionConversion")}</p>
    </details>
  );
}
