/** A date-bounded timetable for the verified standalone academy course profile. */
import { useInfiniteQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { validZone } from "../../lib/dates";
import { db } from "../../lib/supabase";
import {
  academyTimetableRequestSchema,
  academyTimetableSchema,
  maxAcademyTimetableDays,
  type AcademyTimetableCursor,
  type AcademyTimetableRequest,
  type AcademyTimetableSession,
} from "./academy-timetable-schema";
import "./academy-timetable-i18n";
import "./academy-timetable.css";

type AcademyTimetablePage = ReturnType<typeof academyTimetableSchema.parse>;

type DateWindow = Pick<AcademyTimetableRequest, "p_from" | "p_until">;

function shiftWindow(window: DateWindow, direction: -1 | 1): DateWindow {
  const from = DateTime.fromISO(window.p_from, { zone: "UTC" });
  const until = DateTime.fromISO(window.p_until, { zone: "UTC" });
  const days = direction * (until.diff(from, "days").days + 1);
  return {
    p_from: from.plus({ days }).toISODate() ?? "",
    p_until: until.plus({ days }).toISODate() ?? "",
  };
}

function groupByLocalDay(pages: AcademyTimetablePage[]) {
  const days = new Map<string, AcademyTimetableSession[]>();
  const seen = new Set<string>();
  for (const { rows } of pages) {
    for (const session of rows) {
      if (seen.has(session.session_id)) continue;
      seen.add(session.session_id);
      const entries = days.get(session.local_day);
      if (entries) entries.push(session);
      else days.set(session.local_day, [session]);
    }
  }
  return {
    days: [...days].sort(([left], [right]) => left.localeCompare(right)),
    count: seen.size,
  };
}

function Session({
  session,
  displayZone,
  dateFormat,
}: {
  session: AcademyTimetableSession;
  displayZone: string;
  dateFormat: Intl.DateTimeFormat;
}) {
  const { t } = useTranslation("academyTimetable");
  return (
    <li className="panel academy-timetable-session">
      <h3>
        <Link
          to={`/courses/${session.course_run_id}/workspace#course-overview`}
        >
          {session.course_title}
        </Link>
      </h3>
      <dl>
        <div>
          <dt>{t("start")}</dt>
          <dd>
            <time dateTime={session.starts_at}>
              {dateFormat.format(new Date(session.starts_at))}
            </time>
          </dd>
        </div>
        <div>
          <dt>{t("end")}</dt>
          <dd>
            <time dateTime={session.ends_at}>
              {dateFormat.format(new Date(session.ends_at))}
            </time>
          </dd>
        </div>
      </dl>
      <p>
        {displayZone === session.time_zone
          ? session.time_zone
          : t("fallbackZone", { zone: session.time_zone })}{" "}
        · {t(session.delivery_type)}
        {session.venue && <> · {session.venue}</>}
      </p>
    </li>
  );
}

// The date draft and pagination controls can update without repainting a confirmed schedule.
const TimetableSessions = memo(function TimetableSessions({
  pages,
}: {
  pages: AcademyTimetablePage[];
}) {
  const { t, i18n } = useTranslation("academyTimetable");
  const { days, count } = useMemo(() => groupByLocalDay(pages), [pages]);
  if (!count) return <Notice>{t("empty")}</Notice>;
  const dayFormat = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "full",
    timeZone: "UTC",
  });
  const formats = new Map<
    string,
    { displayZone: string; dateFormat: Intl.DateTimeFormat }
  >();
  return (
    <>
      <p role="status" className="muted">
        {t("count", { count })}
      </p>
      {days.map(([day, entries]) => (
        <section key={day} aria-labelledby={`timetable-day-${day}`}>
          <h2 id={`timetable-day-${day}`}>
            <time dateTime={day}>{dayFormat.format(new Date(day))}</time>
          </h2>
          <ul className="academy-timetable-sessions">
            {entries.map((session) => {
              let format = formats.get(session.time_zone);
              if (!format) {
                const displayZone = validZone(session.time_zone)
                  ? session.time_zone
                  : "UTC";
                format = {
                  displayZone,
                  dateFormat: new Intl.DateTimeFormat(i18n.language, {
                    timeZone: displayZone,
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                    timeZoneName: "shortOffset",
                  }),
                };
                formats.set(session.time_zone, format);
              }
              return (
                <Session
                  key={session.session_id}
                  session={session}
                  {...format}
                />
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
});

/** Course scope and lease are rechecked by the RPC on every page. */
export function AcademyTimetable({ actor }: { actor: string }) {
  const { t } = useTranslation("academyTimetable");
  const [window, setWindow] = useState<DateWindow>(() => {
    const today = DateTime.local().startOf("day");
    return {
      p_from: today.toISODate() ?? "",
      p_until: today.plus({ days: 6 }).toISODate() ?? "",
    };
  });
  const [draft, setDraft] = useState(window);
  const [invalid, setInvalid] = useState(false);
  const query = useInfiniteQuery({
    queryKey: ["academy-timetable", actor, window.p_from, window.p_until],
    initialPageParam: null as AcademyTimetableCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const request = pageParam
        ? {
            ...window,
            p_after_start: pageParam.start,
            p_after_id: pageParam.id,
          }
        : window;
      const { data, error } = await db()
        .rpc("academy_timetable", request)
        .abortSignal(signal);
      if (error) throw error;
      return academyTimetableSchema.parse(data);
    },
    getNextPageParam: (page) => page.next,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: 30_000,
  });
  const navigation = useMemo(() => {
    const previous = shiftWindow(window, -1);
    const next = shiftWindow(window, 1);
    return {
      previous,
      next,
      previousValid: academyTimetableRequestSchema.safeParse(previous).success,
      nextValid: academyTimetableRequestSchema.safeParse(next).success,
    };
  }, [window]);

  function showDates(value: DateWindow) {
    const valid = academyTimetableRequestSchema.safeParse(value).success;
    setInvalid(!valid);
    if (!valid) return;
    setWindow(value);
    setDraft(value);
  }

  return (
    <div className="academy-timetable">
      <PageHeading title={t("title")} description={t("description")} />
      <form
        className="panel academy-timetable-controls"
        onSubmit={(event) => {
          event.preventDefault();
          showDates(draft);
        }}
      >
        <div className="field">
          <label htmlFor="timetable-from">{t("from")}</label>
          <input
            id="timetable-from"
            type="date"
            required
            value={draft.p_from}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "timetable-invalid" : undefined}
            onChange={(event) => {
              setDraft({ ...draft, p_from: event.target.value });
              setInvalid(false);
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="timetable-until">{t("until")}</label>
          <input
            id="timetable-until"
            type="date"
            required
            value={draft.p_until}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? "timetable-invalid" : undefined}
            onChange={(event) => {
              setDraft({ ...draft, p_until: event.target.value });
              setInvalid(false);
            }}
          />
        </div>
        <Button type="submit">{t("show")}</Button>
        {invalid && (
          <p id="timetable-invalid" role="alert">
            {t("invalid", { count: maxAcademyTimetableDays })}
          </p>
        )}
      </form>
      <div className="academy-timetable-navigation">
        <Button
          type="button"
          variant="secondary"
          onClick={() => showDates(navigation.previous)}
          disabled={!navigation.previousValid}
        >
          {t("previous")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => showDates(navigation.next)}
          disabled={!navigation.nextValid}
        >
          {t("next")}
        </Button>
      </div>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      {query.isSuccess && (
        <>
          <TimetableSessions pages={query.data.pages} />
          {query.hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              disabled={query.isFetching}
              onClick={() => void query.fetchNextPage({ cancelRefetch: false })}
            >
              {t("more")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
