import { DateTime } from "luxon";
import { resolveScheduleWindow } from "../../lib/dates";

export type SessionWindow = { starts_at: string; ends_at: string };

export function sessionsForDateRange(
  from: string,
  through: string,
  current: SessionWindow[],
) {
  const first = DateTime.fromISO(from, { zone: "utc" });
  const last = DateTime.fromISO(through, { zone: "utc" });
  if (first.toISODate() !== from || last.toISODate() !== through) return null;
  const days = last.diff(first, "days").days + 1;
  if (days < 1 || days > 60) return null;

  const sessions: SessionWindow[] = [];
  for (let index = 0; index < days; index++) {
    const day = first.plus({ days: index }).toISODate();
    const retained = current.filter(
      ({ starts_at }) => starts_at.slice(0, 10) === day,
    );
    sessions.push(
      ...(retained.length
        ? retained
        : [
            {
              starts_at: `${day}T09:00`,
              ends_at: `${day}T15:00`,
            },
          ]),
    );
    if (sessions.length > 60) return null;
  }
  return sessions;
}

export function resolveJobSessions(
  sessions: SessionWindow[],
  zone: string,
  originals: readonly SessionWindow[] = [],
  now = Date.now(),
) {
  if (!sessions.length || sessions.length > 60) return null;
  const result: SessionWindow[] = [];
  for (const session of sessions) {
    // Match by displayed interval, so deleting or inserting a preceding day
    // cannot shift a retained exact instant to a different editor row.
    const original = originals.find(
      ({ starts_at, ends_at }) =>
        localSessionTime(starts_at, zone) === session.starts_at &&
        localSessionTime(ends_at, zone) === session.ends_at,
    );
    const window = resolveScheduleWindow(
      { ...session, time_zone: zone },
      original && { ...original, time_zone: zone },
    );
    if (!window || Date.parse(window.starts_at) <= now) return null;
    result.push(window);
  }
  result.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return result.some(
    (session, index) =>
      index > 0 &&
      Date.parse(result[index - 1].ends_at) > Date.parse(session.starts_at),
  )
    ? null
    : result;
}

export function localSessionTime(instant: string, zone: string) {
  return DateTime.fromISO(instant, { zone }).toFormat("yyyy-MM-dd'T'HH:mm");
}
