import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { academyLicenceQuery } from "./academy-licence-api";

/** The private receipt endpoint decides whether the current account can see the panel. */
export function AcademyLicencePanel({ actor }: { actor: string }) {
  const online = useOnline();
  const { t, i18n } = useTranslation();
  const query = useQuery({
    ...academyLicenceQuery(actor),
    enabled: Boolean(actor && online),
  });
  if (!online || !query.isFetchedAfterMount || query.isError || !query.data)
    return null;

  const locale = i18n.resolvedLanguage ?? i18n.language;
  const word = (de: string, en: string) => (locale.startsWith("de") ? de : en);
  const integer = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const formatDate = (value: string) => date.format(new Date(value)) + " UTC";
  const formatBytes = (value: number) =>
    integer.format(value) + " " + word("Byte", "bytes");
  const receipt = query.data;

  return (
    <section className="panel" aria-labelledby="academy-licence-heading">
      <h2 id="academy-licence-heading">
        {word("Akademielizenz und Quoten", "Academy licence and quotas")}
      </h2>
      <dl>
        <dt>{word("Lizenzstatus", "Licence status")}</dt>
        <dd>
          {receipt.state === "active"
            ? word("Aktiv", "Active")
            : word("Kulanzfrist", "Grace period")}
        </dd>
        <dt>{word("Ausgestellt", "Issued")}</dt>
        <dd>
          <time dateTime={receipt.issued_at}>
            {formatDate(receipt.issued_at)}
          </time>
        </dd>
        <dt>{word("Gültig ab", "Valid from")}</dt>
        <dd>
          <time dateTime={receipt.starts_at}>
            {formatDate(receipt.starts_at)}
          </time>
        </dd>
        <dt>{word("Gültig bis", "Active until")}</dt>
        <dd>
          <time dateTime={receipt.expires_at}>
            {formatDate(receipt.expires_at)}
          </time>
        </dd>
        <dt>{word("Kulanzfrist bis", "Grace period ends")}</dt>
        <dd>
          <time dateTime={receipt.grace_until}>
            {formatDate(receipt.grace_until)}
          </time>
        </dd>
      </dl>
      <h3>{word("Sitze", "Seats")}</h3>
      <dl>
        <dt>{word("Lizenzierte Sitze", "Licensed seats")}</dt>
        <dd>{integer.format(receipt.seats.limit)}</dd>
        <dt>
          {word("Belegte und reservierte Sitze", "Occupied and reserved seats")}
        </dt>
        <dd>{integer.format(receipt.seats.occupied)}</dd>
        <dt>{word("Verfügbare Sitze", "Available seats")}</dt>
        <dd>{integer.format(receipt.seats.available)}</dd>
      </dl>
      <h3>{word("Dateispeicher", "File storage")}</h3>
      <dl>
        <dt>{word("Lizenzierter Speicher", "Licensed storage")}</dt>
        <dd>{formatBytes(receipt.storage.limit_bytes)}</dd>
        <dt>{word("Belegt und reserviert", "Used and reserved")}</dt>
        <dd>{formatBytes(receipt.storage.used_bytes)}</dd>
        <dt>{word("Verfügbarer Speicher", "Available storage")}</dt>
        <dd>{formatBytes(receipt.storage.available_bytes)}</dd>
        <dt>
          {word(
            "Lizenzierte API-Anfragen pro Minute",
            "Licensed API requests per minute",
          )}
        </dt>
        <dd>{integer.format(receipt.api_requests_per_minute)}</dd>
      </dl>
      <Button asChild variant="secondary">
        <Link to="/administration/mail">{t("mailSettings")}</Link>
      </Button>
    </section>
  );
}
