export const coursePhases = [
  "current",
  "upcoming",
  "completed",
  "unscheduled",
] as const;

export type CoursePhase = (typeof coursePhases)[number];
export type CoursePhaseSelection = "all" | CoursePhase;

/** Use the course's full span, including gaps between its sessions. */
export function coursePhase(
  start: string | null,
  end: string | null,
  now: number,
): CoursePhase {
  const begins = start ? Date.parse(start) : NaN;
  const ends = end ? Date.parse(end) : NaN;
  return phaseFromInstants(begins, ends, now);
}

function phaseFromInstants(
  begins: number,
  ends: number,
  now: number,
): CoursePhase {
  if (!Number.isFinite(begins) || !Number.isFinite(ends) || ends <= begins) {
    return "unscheduled";
  }
  if (ends <= now) return "completed";
  return begins > now ? "upcoming" : "current";
}

type CourseSessionDates = { starts_at: string; ends_at: string };

/** Classify the schedule and retain the first valid instant for its date display. */
export function scheduledCourseSummary(
  sessions: CourseSessionDates[],
  now: number,
) {
  let first = Infinity;
  let firstIso: string | null = null;
  let last = -Infinity;
  for (const session of sessions) {
    const start = Date.parse(session.starts_at);
    const end = Date.parse(session.ends_at);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      if (start < first) {
        first = start;
        firstIso = session.starts_at;
      }
      last = Math.max(last, end);
    }
  }
  return {
    phase: phaseFromInstants(first, last, now),
    first: firstIso === null ? null : { iso: firstIso, instant: first },
  };
}

/** Session order and the form of the UTC offset do not affect classification. */
export function scheduledCoursePhase(
  sessions: CourseSessionDates[],
  now: number,
): CoursePhase {
  return scheduledCourseSummary(sessions, now).phase;
}
