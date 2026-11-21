/** A view-only calendar zone picker. The empty option follows account settings. */
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { validZone } from "../../lib/dates";

// Older browsers still offer common teaching zones if they lack the IANA list API.
const zones = [
  ...new Set([
    "UTC",
    "Europe/Berlin",
    "Europe/London",
    "Australia/Brisbane",
    "Australia/Sydney",
    ...(Intl.supportedValuesOf?.("timeZone") ?? []),
  ]),
]
  .filter(validZone)
  .sort();

/** Change the presentation zone without writing to profile or event records. */
export function CalendarDisplayZone({
  profileZone,
  value,
  onChange,
}: {
  profileZone: string;
  value: string;
  onChange: (zone: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Field id="calendar-display-zone" label={t("calendarDisplayZone")}>
      <select
        value={value}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (!next || validZone(next)) onChange(next);
        }}
      >
        <option value="">
          {t("calendarProfileZone", { zone: profileZone })}
        </option>
        {zones.map((zone) => (
          <option key={zone} value={zone}>
            {zone}
          </option>
        ))}
      </select>
    </Field>
  );
}
