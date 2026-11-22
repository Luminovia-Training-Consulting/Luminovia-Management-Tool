import { useTranslation } from "react-i18next";
import { validZone } from "../lib/dates";

// These choices are also available when the browser cannot enumerate IANA zones.
const commonZones = [
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "America/Argentina/Buenos_Aires",
  "America/Bogota",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Mexico_City",
  "America/New_York",
  "America/Phoenix",
  "America/Sao_Paulo",
  "America/Toronto",
  "America/Vancouver",
  "Asia/Bangkok",
  "Asia/Dubai",
  "Asia/Hong_Kong",
  "Asia/Jakarta",
  "Asia/Kolkata",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Adelaide",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Sydney",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Europe/Lisbon",
  "Europe/London",
  "Europe/Paris",
  "Pacific/Auckland",
  "UTC",
].filter(validZone);

const otherZones = [
  ...new Set([
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(Intl.supportedValuesOf?.("timeZone") ?? []),
  ]),
]
  .filter((zone) => !commonZones.includes(zone) && validZone(zone))
  .sort();

/** Offer common choices first and retain valid stored aliases missing from the browser catalogue. */
export function TimeZoneOptions({ current }: { current: string }) {
  const { t } = useTranslation();
  const other =
    validZone(current) &&
    !commonZones.includes(current) &&
    !otherZones.includes(current)
      ? [...otherZones, current].sort()
      : otherZones;

  return (
    <>
      <optgroup label={t("commonTimeZones")}>
        {commonZones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </optgroup>
      {other.length > 0 && (
        <optgroup label={t("otherTimeZones")}>
          {other.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
