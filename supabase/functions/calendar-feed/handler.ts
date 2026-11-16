interface FeedEvent {
  id: string;
  kind: "assignment" | "private";
  title: string;
  starts_at: string;
  ends_at: string;
  time_zone: string;
}
interface Snapshot {
  label: string;
  items: FeedEvent[];
}
interface Dependencies {
  snapshot: (hash: string, signal: AbortSignal) => Promise<Snapshot | null>;
  recheck: (hash: string, signal: AbortSignal) => Promise<boolean>;
}
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
function escaped(value: string) {
  return [...value.replace(/\r\n?/g, "\n")].filter((char) => {
    const n = char.codePointAt(0)!;
    return n === 9 || n === 10 || (n >= 32 && n !== 127);
  }).join("").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function fold(line: string) {
  let result = "", bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) {
      result += "\r\n ";
      bytes = 1;
    }
    result += char;
    bytes += size;
  }
  return result;
}
function instant(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) throw new Error("invalid_instant");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
export function renderCalendar(snapshot: Snapshot) {
  if (
    typeof snapshot.label !== "string" || snapshot.label.length > 80 ||
    !Array.isArray(snapshot.items) || snapshot.items.length > 2000
  ) throw new Error("invalid_snapshot");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Luminovia//Private Calendar Feed//DE",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escaped(snapshot.label)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const stamp = instant(new Date().toISOString());
  for (const event of snapshot.items) {
    if (
      !/^[a-f0-9-]{36}$/.test(event.id) ||
      !["assignment", "private"].includes(event.kind) ||
      typeof event.title !== "string" || typeof event.time_zone !== "string" ||
      Date.parse(event.ends_at) <= Date.parse(event.starts_at)
    ) throw new Error("invalid_event");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.kind}.${event.id}@luminovia.org`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${instant(event.starts_at)}`,
      `DTEND:${instant(event.ends_at)}`,
      `SUMMARY:${escaped(event.title)}`,
      `X-LUMINOVIA-TIME-ZONE:${escaped(event.time_zone)}`,
      "CLASS:PRIVATE",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  const text = [...lines, "END:VCALENDAR", ""].map(fold).join("\r\n");
  if (new TextEncoder().encode(text).length > 2_000_000) {
    throw new Error("feed_too_large");
  }
  return text;
}
export function createCalendarFeedHandler(deps: Dependencies) {
  return async (request: Request) => {
    const unavailable = () =>
      new Response("calendar_unavailable", { status: 404, headers });
    if (request.method !== "GET") {
      return new Response("method_not_allowed", {
        status: 405,
        headers: { ...headers, Allow: "GET" },
      });
    }
    try {
      const url = new URL(request.url),
        tokens = url.searchParams.getAll("token");
      if (
        tokens.length !== 1 || [...url.searchParams.keys()].some((key) =>
          key !== "token"
        ) || !/^\b[a-f0-9]{64}\b$/.test(tokens[0])
      ) return unavailable();
      const bytes = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(tokens[0]),
      );
      const hash = [...new Uint8Array(bytes)].map((byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("");
      const signal = AbortSignal.any([
        request.signal,
        AbortSignal.timeout(10000),
      ]);
      const snapshot = await deps.snapshot(hash, signal);
      if (!snapshot) return unavailable();
      const body = renderCalendar(snapshot);
      // A revoked/suspended capability must not survive while the file renders.
      if (signal.aborted || !await deps.recheck(hash, signal)) {
        return unavailable();
      }
      return new Response(body, {
        headers: {
          ...headers,
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": 'inline; filename="luminovia-calendar.ics"',
        },
      });
    } catch {
      return unavailable();
    }
  };
}
