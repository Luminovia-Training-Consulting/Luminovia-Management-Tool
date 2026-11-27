import { dateTime } from "../lib/dates";
import { SessionScroll } from "./session-scroll";

type Session = { id: string; starts_at: string; ends_at: string };
type Milestone = { id: string; at: string; label: string };

export function CourseTimeline({
  sessions,
  milestones = [],
  label,
  language,
  zone,
  className,
}: {
  sessions: readonly Session[];
  milestones?: readonly Milestone[];
  label: string;
  language: string;
  zone: string;
  className: string;
}) {
  const entries = [
    ...sessions.map(({ id, starts_at, ends_at }) => ({
      id: `session:${id}`,
      at: starts_at,
      endsAt: ends_at,
      label: undefined,
    })),
    ...milestones.map((item) => ({ ...item, endsAt: undefined })),
  ].sort(
    (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
  );

  return (
    <SessionScroll label={label}>
      <ol className={className}>
        {entries.map(({ id, at, endsAt, label: entryLabel }) => (
          <li key={id}>
            <div>
              <strong>{entryLabel ?? dateTime(at, language, zone)}</strong>
              {entryLabel && (
                <time dateTime={at}>{dateTime(at, language, zone)}</time>
              )}
              {endsAt && (
                <time dateTime={endsAt}>
                  {dateTime(endsAt, language, zone)}
                </time>
              )}
            </div>
          </li>
        ))}
      </ol>
    </SessionScroll>
  );
}
