import { validZone } from "./dates";

// Include the device zone and common choices on browsers without supportedValuesOf.
const zones = [
  ...new Set([
    "UTC",
    "Africa/Cairo",
    "Africa/Johannesburg",
    "America/Los_Angeles",
    "America/New_York",
    "America/Sao_Paulo",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Brisbane",
    "Australia/Sydney",
    "Europe/Berlin",
    "Europe/London",
    "Pacific/Auckland",
    new Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(Intl.supportedValuesOf?.("timeZone") ?? []),
  ]),
]
  .filter(validZone)
  .sort();

/** Keep valid stored IANA aliases selectable even if the browser omits them from its catalogue. */
export function timeZoneOptions(current: string) {
  return current && !zones.includes(current) && validZone(current)
    ? [...zones, current].sort()
    : zones;
}
