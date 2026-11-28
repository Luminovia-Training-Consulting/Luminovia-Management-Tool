/** Bound the availability read to the offer's earliest start and latest end. */
export function jobSessionWindow(
  sessions: { starts_at: string; ends_at: string }[] | undefined,
) {
  if (!sessions?.length) return null;
  let latest = Number.NEGATIVE_INFINITY;
  const slots = sessions.map(({ starts_at, ends_at }) => {
    const start = Date.parse(starts_at);
    const end = Date.parse(ends_at);
    latest = Math.max(latest, end);
    return { start, end };
  });
  slots.sort((a, b) => a.start - b.start);
  return {
    slots,
    window: {
      from: new Date(slots[0].start).toISOString(),
      to: new Date(latest).toISOString(),
    },
  };
}

/** Walk both time-ordered lists once, treating touching endpoints as available. */
export function overlapsTeachingAssignments(
  jobId: string,
  offered: { start: number; end: number }[],
  assigned: {
    starts_at: string;
    ends_at: string;
    job_claims: { job_id: string };
  }[],
) {
  let next = 0;
  for (const slot of assigned) {
    if (slot.job_claims.job_id === jobId) continue;
    const start = Date.parse(slot.starts_at);
    while (next < offered.length && offered[next].end <= start) next++;
    if (next === offered.length) return false;
    if (offered[next].start < Date.parse(slot.ends_at)) return true;
  }
  return false;
}
