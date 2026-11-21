/**
 * FullCalendar view of own events, confirmed assignments, published global events
 * and course sessions. Visible ranges bound global discovery; each source keeps
 * its own ACL. Private form times become instants before server-confirmed writes.
 */
import { useBlocker, useSearchParams } from "react-router-dom";
import { assignmentCalendarMetadataQuery } from "../jobs/discovery-api";
import { CalendarColorPreferences } from "./calendar-colors";
import {
  calendarColorsQuery,
  defaultCalendarColors,
} from "./calendar-color-api";
import { orgQuery, runsQuery, templatesQuery } from "../operations/data";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DatesSetArg } from "@fullcalendar/core";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus, X } from "lucide-react";
import { CalendarExport } from "./export";
import { CalendarSubscriptions } from "./subscriptions";
import { CalendarImport } from "./import";
import { OfflineSchedule } from "./offline";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import deLocale from "@fullcalendar/core/locales/de";
import enLocale from "@fullcalendar/core/locales/en-gb";
import { DateTime } from "luxon";
import { useAuth } from "../auth/auth-context";
import {
  claimsQuery,
  eventsQuery,
  permissionsQuery,
  profileQuery,
  topicsQuery,
} from "../../lib/queries";
import { db } from "../../lib/supabase";
import type { PersonalEvent } from "../../lib/types";
import { validZone, zonedInstant, zonedInstantForEdit } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { CalendarDisplayZone } from "./display-zone";
import { calendarFoldLabel } from "./display-time";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { globalEventsQuery } from "./publications-api";
import { GlobalEventDetails, GlobalEventManagement } from "./publications";
import "./publications-i18n";
import "./confirmation-i18n";
import "./personal-details-i18n";
import "./filter-i18n";
import { CalendarToolbar } from "./toolbar";
import { type CalendarView, calendarViews } from "./views";
import "./calendar-toolbar.css";
import { privateMeetingHref } from "./personal-details";

/** Validate private-event form input; current server permissions and constraints remain authoritative. */
const schema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10000),
  meeting_url: z
    .string()
    .trim()
    .max(2000)
    .refine((v) => !v || Boolean(privateMeetingHref(v))),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  time_zone: z.string().refine(validZone),
});

/** Save or delete an own private event using zoned instants, then invalidate the actor's event query after confirmation. */
function EventForm({
  userId,
  zone,
  event,
  onDone,
  onBusyChange,
  onDirtyChange,
}: {
  userId: string;
  zone: string;
  event?: PersonalEvent;
  onDone: (deleted?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirmText = useTranslation("calendarConfirmation").t;
  const detailText = useTranslation("privateCalendarDetails").t;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const client = useQueryClient();
  const online = useOnline();
  const [timeError, setTimeError] = useState(false);
  // The editor uses the event's original wall times, even in another display zone.
  const localTime = (instant: string, timeZone: string) =>
    DateTime.fromISO(instant, { zone: timeZone }).toFormat(
      "yyyy-MM-dd'T'HH:mm",
    );
  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: event
      ? {
          title: event.title,
          time_zone: event.time_zone,
          description: event.description ?? "",
          meeting_url: event.meeting_url ?? "",
          starts_at: localTime(event.starts_at, event.time_zone),
          ends_at: localTime(event.ends_at, event.time_zone),
        }
      : {
          title: "",
          description: "",
          meeting_url: "",
          starts_at: "",
          ends_at: "",
          time_zone: zone,
        },
  });
  useEffect(() => onDirtyChange(isDirty), [isDirty, onDirtyChange]);
  const save = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (values: z.infer<typeof schema>) => {
      requireOnline();
      setTimeError(false);
      const convert = (input: string, original: string | undefined) =>
        original && values.time_zone === event?.time_zone
          ? zonedInstantForEdit(
              input,
              values.time_zone,
              localTime(original, values.time_zone),
              original,
            )
          : zonedInstant(input, values.time_zone);
      const starts = convert(values.starts_at, event?.starts_at);
      const ends = convert(values.ends_at, event?.ends_at);
      if (!starts || !ends || Date.parse(ends) <= Date.parse(starts)) {
        setTimeError(true);
        throw new Error("invalid_time");
      }
      const payload = {
        title: values.title,
        description: values.description,
        meeting_url: values.meeting_url,
        starts_at: starts,
        ends_at: ends,
        time_zone: values.time_zone,
      };
      const result = event
        ? await db()
            .from("personal_events")
            .update(payload)
            .eq("id", event.id)
            .eq("user_id", userId)
            .select("id")
            .single()
        : await db()
            .from("personal_events")
            .insert({ ...payload, user_id: userId })
            .select("id")
            .single();
      if (result.error || !result.data)
        throw result.error ?? new Error("not_saved");
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["events", userId] });
      onDone();
    },
  });
  const remove = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db()
        .from("personal_events")
        .delete()
        .eq("id", event!.id)
        .eq("user_id", userId)
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("not_deleted");
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["events", userId] });
      onDone(true);
    },
  });
  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
      <Field id="event-title" label={t("title")} error={Boolean(errors.title)}>
        <input id="event-title" {...register("title")} />
      </Field>
      <Field
        id="event-description"
        label={detailText("description")}
        error={Boolean(errors.description)}
      >
        <textarea
          id="event-description"
          rows={4}
          maxLength={10000}
          {...register("description")}
        />
      </Field>
      <Field
        id="event-meeting"
        label={detailText("meetingUrl")}
        error={Boolean(errors.meeting_url)}
      >
        <input
          id="event-meeting"
          type="url"
          maxLength={2000}
          {...register("meeting_url")}
        />
      </Field>
      {event?.meeting_url && privateMeetingHref(event.meeting_url) && (
        <p>
          <a
            href={privateMeetingHref(event.meeting_url)!}
            target="_blank"
            rel="noopener noreferrer"
          >
            {detailText("openMeeting")}
          </a>
        </p>
      )}
      <p>{detailText("hint")}</p>
      <div className="form-row">
        <Field
          id="event-start"
          label={t("start")}
          error={Boolean(errors.starts_at)}
        >
          <input
            id="event-start"
            type="datetime-local"
            {...register("starts_at")}
          />
        </Field>
        <Field id="event-end" label={t("end")} error={Boolean(errors.ends_at)}>
          <input
            id="event-end"
            type="datetime-local"
            {...register("ends_at")}
          />
        </Field>
      </div>
      <Field
        id="event-zone"
        label={t("timezone")}
        error={Boolean(errors.time_zone)}
      >
        <input id="event-zone" list="event-zones" {...register("time_zone")} />
      </Field>
      <datalist id="event-zones">
        <option>Europe/Berlin</option>
        <option>Australia/Brisbane</option>
        <option>UTC</option>
      </datalist>
      {save.isError && (
        <Notice kind="error">{t(timeError ? "invalidTime" : "error")}</Notice>
      )}
      <div className="form-actions">
        <Button disabled={!online || save.isPending || remove.isPending}>
          {t("saveEvent")}
        </Button>
        {event && (
          <Button
            type="button"
            variant="danger"
            disabled={!online || save.isPending || remove.isPending}
            onClick={() => {
              remove.reset();
              setConfirmDelete(true);
            }}
          >
            {t("deleteEvent")}
          </Button>
        )}
      </div>
      <Dialog
        open={confirmDelete}
        onOpenChange={(next) => {
          if (!remove.isPending) setConfirmDelete(next);
        }}
        title={confirmText("deleteTitle")}
        description={confirmText("deleteDescription")}
      >
        <p>{event?.title}</p>
        {remove.isError && (
          <Notice kind="error">{confirmText("deleteFailed")}</Notice>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={remove.isPending}
            onClick={() => setConfirmDelete(false)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!online || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("deleteEvent")}
          </Button>
        </div>
      </Dialog>
    </form>
  );
}

/** Keep secondary calendar actions in one collapsed group while preserving each control's own state. */
function CalendarTools({
  actor,
  zone,
  showIcs = true,
}: {
  actor: string;
  zone: string;
  showIcs?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <details className="panel calendar-tools">
      <summary>{t("calendarTools")}</summary>
      <div className="calendar-tools-content">
        <CalendarSubscriptions
          key={`subscriptions-${actor}`}
          actor={actor}
          zone={zone}
        />
        {showIcs && (
          <>
            <CalendarImport key={`import-${actor}`} actor={actor} zone={zone} />
            <CalendarExport key={actor} actor={actor} zone={zone} />
          </>
        )}
        <OfflineSchedule key={`offline-${actor}`} actor={actor} zone={zone} />
      </div>
    </details>
  );
}

/** Combine separately authorized calendar sources and display them in the selected IANA zone. */
export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const confirmText = useTranslation("calendarConfirmation").t;
  const filterText = useTranslation("calendarFilter").t;
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("all");
  const [customer, setCustomer] = useState("");
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const calendarRef = useRef<FullCalendar>(null);
  const [calendarTitle, setCalendarTitle] = useState("");
  const [calendarView, setCalendarView] = useState<CalendarView>(() =>
    window.innerWidth < 700 ? "listMonth" : "dayGridMonth",
  );
  const [calendarParams] = useSearchParams();
  const { session } = useAuth();
  const profile = useQuery(profileQuery(session!.user.id));
  const calendarColors = useQuery(calendarColorsQuery(session!.user.id));
  const claims = useQuery(claimsQuery(session!.user.id));
  const personal = useQuery(eventsQuery(session!.user.id));
  const jobs = useQuery(
    assignmentCalendarMetadataQuery(
      session!.user.id,
      (claims.data ?? []).map((claim) => claim.job_id),
    ),
  );
  const [global, setGlobal] = useState(false);
  const publicRuns = useQuery({
    ...runsQuery(session!.user.id),
    enabled: global,
  });
  const templates = useQuery({
    ...templatesQuery(session!.user.id),
    enabled: global,
  });
  const organisations = useQuery({
    ...orgQuery(session!.user.id),
    enabled: global,
  });
  const topics = useQuery({ ...topicsQuery, enabled: global });
  const publicationText = useTranslation("calendarPublications").t;
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const [range, setRange] = useState(() => {
    const start = DateTime.utc().startOf("month").minus({ days: 7 });
    return { from: start.toISO()!, to: start.plus({ days: 49 }).toISO()! };
  });
  const globals = useInfiniteQuery({
    ...globalEventsQuery(session!.user.id, range.from, range.to),
    enabled: global,
  });
  const [globalID, setGlobalID] = useState<string | null>(null);
  const globalRows = globals.isError
    ? []
    : [
        ...new Map(
          (globals.data?.pages ?? [])
            .flatMap((page) => page.items)
            .map((event) => [event.id, event]),
        ).values(),
      ];
  const visibleRange = useRef(range);
  const handleDatesSet = useCallback((info: DatesSetArg) => {
    if (info.view?.title) setCalendarTitle(info.view.title);
    if (calendarViews.includes(info.view?.type as CalendarView))
      setCalendarView(info.view.type as CalendarView);
    const next = { from: info.start.toISOString(), to: info.end.toISOString() };
    // Locale/view options can rebuild FullCalendar's DateProfile without moving
    // its instants. Preserve the captured detail and query key for those signals.
    if (
      visibleRange.current.from === next.from &&
      visibleRange.current.to === next.to
    )
      return;
    // Update synchronously: multiple navigation callbacks can precede a render.
    visibleRange.current = next;
    setRange(next);
    setGlobalID(null);
  }, []);
  const activeGlobal = globalRows.find((event) => event.id === globalID);
  const [open, setOpen] = useState(false);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventDirty, setEventDirty] = useState(false);
  const [eventFormEpoch, setEventFormEpoch] = useState(0);
  const [discardAction, setDiscardAction] = useState<
    | { kind: "close" }
    | { kind: "event"; event: PersonalEvent | undefined }
    | null
  >(null);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      open &&
      (eventDirty || eventBusy) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );
  const cancelDiscard = () => {
    setDiscardAction(null);
    if (blocker.state === "blocked") blocker.reset();
  };
  const applyDiscardAction = () => {
    if (eventBusy) return;
    if (blocker.state === "blocked") {
      setDiscardAction(null);
      setEventDirty(false);
      blocker.proceed();
      return;
    }
    if (!discardAction) return;
    const action = discardAction;
    setDiscardAction(null);
    setEventDirty(false);
    if (action.kind === "event") {
      setEventFormEpoch((value) => value + 1);
      setSelected(action.event);
      setOpen(true);
    } else {
      setOpen(false);
    }
  };
  useEffect(() => {
    if (!open || (!eventDirty && !eventBusy)) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [open, eventDirty, eventBusy]);
  const [selected, setSelected] = useState<PersonalEvent | undefined>();
  const [message, setMessage] = useState("");
  const online = useOnline();
  const [displayZone, setDisplayZone] = useState("");
  const [viewAnchor, setViewAnchor] = useState<{
    assignment: string | null;
    date: string;
  }>();
  const accountZone = profile.data?.time_zone ?? "";
  const profileZone = validZone(accountZone) ? accountZone : "Europe/Berlin";
  const zone = displayZone || profileZone;
  const assignment = calendarParams.get("assignment");
  const assignmentStart = claims.data
    ?.find((claim) => claim.job_id === assignment)
    ?.assignment_sessions.map((session) => session.starts_at)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort()[0];
  if (
    claims.isPending ||
    personal.isPending ||
    (Boolean(claims.data?.length) && jobs.isPending)
  )
    return (
      <>
        <PageHeading title={t("calendar")} description={t("privateNote")} />
        <CalendarTools actor={session!.user.id} zone={zone} showIcs={false} />
        <Loading />
      </>
    );
  if (
    claims.isError ||
    personal.isError ||
    (Boolean(claims.data?.length) && jobs.isError)
  )
    return (
      <>
        <PageHeading title={t("calendar")} description={t("privateNote")} />
        <CalendarTools actor={session!.user.id} zone={zone} showIcs={false} />
        <ErrorState
          retry={() => {
            void claims.refetch();
            void personal.refetch();
            void jobs.refetch();
            void globals.refetch();
            if (global) {
              void publicRuns.refetch();
              void templates.refetch();
            }
          }}
        />
      </>
    );
  const emptyMetadata = {
    customerKey: "",
    customerName: "",
    topics: [] as { id: string; label_de: string; label_en: string }[],
  };
  const colors = calendarColors.data ?? defaultCalendarColors;
  const assignmentMetadata = (id: string) => {
    const job = jobs.data?.find((value) => value.id === id);
    return {
      customerKey:
        job?.organisation_id ??
        (job?.organisation_name ? `name:${job.organisation_name}` : ""),
      customerName: job?.organisation_name ?? "",
      topics: job?.topics ?? [],
    };
  };
  const events = global
    ? [
        ...globalRows.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.starts_at,
          end: e.ends_at,
          display: "block",
          color: "#1749b5",
          textColor: "#ffffff",
          extendedProps: { kind: "global", ...emptyMetadata },
        })),
        ...(publicRuns.isError || templates.isError
          ? []
          : (publicRuns.data ?? [])
        )
          .filter((run) => run.published && !run.archived_at)
          .flatMap((run) =>
            run.course_sessions.map((s) => {
              const customerCreated = Boolean(run.organisation_id);
              return {
                id: `course-${s.id}`,
                title:
                  templates.data?.find((t) => t.id === run.template_id)
                    ?.title ?? t("courses"),
                start: s.starts_at,
                end: s.ends_at,
                display: "block",
                color: customerCreated
                  ? colors.customer_event_color
                  : "#326c58",
                textColor: customerCreated ? "#17283a" : "#ffffff",
                url: `/courses?run=${run.id}`,
                extendedProps: {
                  kind: "course",
                  customerCreated,
                  customerKey: run.organisation_id ?? "",
                  customerName: organisations.isError
                    ? ""
                    : (organisations.data?.find(
                        (org) => org.id === run.organisation_id,
                      )?.name ?? ""),
                  topics: topics.isError
                    ? []
                    : (
                        templates.data?.find(
                          (template) => template.id === run.template_id,
                        )?.course_template_topics ?? []
                      ).flatMap(({ topic_id }) => {
                        const topic = topics.data?.find(
                          (value) => value.id === topic_id,
                        );
                        return topic
                          ? [
                              {
                                id: topic.id,
                                label_de: topic.label_de,
                                label_en: topic.label_en,
                              },
                            ]
                          : [];
                      }),
                },
              };
            }),
          ),
      ]
    : [
        ...personal.data.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.starts_at,
          end: e.ends_at,
          display: "block",
          color: colors.personal_event_color,
          textColor: "#17283a",
          extendedProps: { kind: "private", ...emptyMetadata },
        })),
        ...claims.data.flatMap((c) =>
          c.assignment_sessions.map((s) => {
            const metadata = assignmentMetadata(c.job_id),
              customerCreated = Boolean(metadata.customerKey);
            return {
              id: s.id,
              title:
                jobs.data?.find((j) => j.id === c.job_id)?.title ??
                t("assignment"),
              start: s.starts_at,
              end: s.ends_at,
              display: "block",
              color: customerCreated
                ? colors.customer_event_color
                : colors.assignment_event_color,
              textColor: "#17283a",
              url: `/jobs/${c.job_id}`,
              extendedProps: {
                kind: "assignment",
                customerCreated,
                ...metadata,
              },
            };
          }),
        ),
      ];
  // FullCalendar's grid stores civil times internally. Use the exact source
  // instants to label events in a repeated hour with their separate UTC offsets.
  const sourceEvents = new Map(events.map((event) => [event.id, event]));
  const customerOptions = [
    ...new Map(
      events
        .filter((event) => event.extendedProps.customerName)
        .map((event) => [
          event.extendedProps.customerKey,
          event.extendedProps.customerName,
        ]),
    ).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1], i18n.language));
  const topicOptions = [
    ...new Map(
      events
        .flatMap((event) => event.extendedProps.topics)
        .map((topic) => [topic.id, topic]),
    ).values(),
  ].sort((a, b) =>
    (i18n.language.startsWith("de") ? a.label_de : a.label_en).localeCompare(
      i18n.language.startsWith("de") ? b.label_de : b.label_en,
      i18n.language,
    ),
  );
  return (
    <>
      <PageHeading
        title={t("calendar")}
        description={t("privateNote")}
        action={
          <Button
            onClick={() => {
              if (open && eventDirty)
                setDiscardAction({ kind: "event", event: undefined });
              else if (!eventBusy) {
                setSelected(undefined);
                setEventDirty(false);
                setOpen(true);
              }
            }}
            disabled={!online}
          >
            <Plus size={18} />
            {t("addEvent")}
          </Button>
        }
      />
      <CalendarTools actor={session!.user.id} zone={zone} />
      <div className="calendar-controls">
        <div className="segmented">
          <Button
            variant={!global ? "default" : "ghost"}
            onClick={() => {
              setGlobal(false);
              setEventType("all");
              setCustomer("");
              setTopicIds([]);
            }}
          >
            {t("privateCalendar")}
          </Button>
          <Button
            variant={global ? "default" : "ghost"}
            onClick={() => {
              setGlobal(true);
              setEventType("all");
              setCustomer("");
              setTopicIds([]);
            }}
          >
            {publicationText("global")}
          </Button>
        </div>
        <CalendarDisplayZone
          profileZone={profileZone}
          value={displayZone}
          onChange={(nextZone) => {
            const api = calendarRef.current?.getApi();
            if (api)
              setViewAnchor({
                assignment,
                date: api.formatIso(api.getDate(), true),
              });
            setDisplayZone(nextZone);
          }}
        />
      </div>
      <div className="calendar-filters">
        <Field id="calendar-customer" label={filterText("customer")}>
          <select
            id="calendar-customer"
            value={customer}
            onChange={(event) => setCustomer(event.target.value)}
          >
            <option value="">{filterText("allCustomers")}</option>
            {customerOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field id="calendar-topic" label={filterText("topics")}>
          <select
            id="calendar-topic"
            value=""
            onChange={(event) => {
              if (event.target.value)
                setTopicIds((current) => [
                  ...new Set([...current, event.target.value]),
                ]);
            }}
          >
            <option value="">{filterText("addTopic")}</option>
            {topicOptions
              .filter((topic) => !topicIds.includes(topic.id))
              .map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {i18n.language.startsWith("de")
                    ? topic.label_de
                    : topic.label_en}
                </option>
              ))}
          </select>
        </Field>
        <Field id="calendar-search" label={filterText("search")}>
          <input
            id="calendar-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field id="calendar-event-type" label={filterText("type")}>
          <select
            id="calendar-event-type"
            value={eventType}
            onChange={(event) => setEventType(event.target.value)}
          >
            <option value="all">{filterText("all")}</option>
            {(global ? ["global", "course"] : ["private", "assignment"]).map(
              (kind) => (
                <option key={kind} value={kind}>
                  {filterText(kind)}
                </option>
              ),
            )}
          </select>
        </Field>
      </div>
      <CalendarColorPreferences actor={session!.user.id} />
      {topicIds.length > 0 && (
        <div
          className="calendar-topic-tags"
          aria-label={filterText("selectedTopics")}
        >
          {topicIds.map((id) => {
            const topic = topicOptions.find((value) => value.id === id);
            const label = topic
              ? i18n.language.startsWith("de")
                ? topic.label_de
                : topic.label_en
              : filterText("unavailableTopic");
            return (
              <Button
                key={id}
                type="button"
                variant="secondary"
                size="sm"
                aria-label={filterText("removeTopic", { topic: label })}
                onClick={() =>
                  setTopicIds((current) =>
                    current.filter((value) => value !== id),
                  )
                }
              >
                {label}
                <X size={14} aria-hidden="true" />
              </Button>
            );
          })}
        </div>
      )}
      <div className="calendar-filter-summary">
        <p>{filterText("scope")}</p>
        {(customer || topicIds.length > 0 || search || eventType !== "all") && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setCustomer("");
              setTopicIds([]);
              setSearch("");
              setEventType("all");
            }}
          >
            {filterText("clear")}
          </Button>
        )}
      </div>
      {message && <Notice>{message}</Notice>}
      <div className="panel calendar-panel">
        <CalendarToolbar
          title={
            calendarTitle ||
            DateTime.now()
              .setZone(zone)
              .setLocale(i18n.language)
              .toFormat("LLLL yyyy")
          }
          view={calendarView}
          onNavigate={(direction) => {
            const api = calendarRef.current?.getApi();
            if (direction === "prev") api?.prev();
            else if (direction === "next") api?.next();
            else api?.today();
          }}
          onView={(view) => {
            calendarRef.current?.getApi().changeView(view);
          }}
        />
        {/* A live timezone change can collapse distinct UTC instants in a DST
            fold. Build a new date environment from the source events instead. */}
        <FullCalendar
          key={zone}
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
            luxonPlugin,
          ]}
          locale={i18n.language === "de" ? deLocale : enLocale}
          timeZone={zone}
          ref={calendarRef}
          initialView={calendarView}
          initialDate={
            (viewAnchor?.assignment === assignment
              ? viewAnchor.date
              : undefined) ?? assignmentStart
          }
          headerToolbar={false}
          datesSet={handleDatesSet}
          events={events.filter(
            (event) =>
              (eventType === "all" || event.extendedProps.kind === eventType) &&
              (!customer || event.extendedProps.customerKey === customer) &&
              (!topicIds.length ||
                event.extendedProps.topics.some((topic) =>
                  topicIds.includes(topic.id),
                )) &&
              event.title
                .toLocaleLowerCase()
                .includes(search.trim().toLocaleLowerCase()),
          )}
          height="auto"
          eventContent={({ event }) => {
            const source = sourceEvents.get(event.id);
            const label =
              source &&
              calendarFoldLabel(source.start, source.end, zone, i18n.language);
            if (!label) return true;
            return (
              <>
                <div className="fc-event-time">{label}</div>
                <div className="fc-event-title">{event.title}</div>
              </>
            );
          }}
          dayCellDidMount={(arg) => arg.el.removeAttribute("aria-labelledby")}
          eventInteractive
          nowIndicator
          dayMaxEvents={3}
          eventClick={(info) => {
            if (info.event.extendedProps.kind === "global") {
              info.jsEvent.preventDefault();
              setGlobalID(info.event.id);
            }
            if (info.event.extendedProps.kind === "private") {
              const next = personal.data.find((e) => e.id === info.event.id);
              if (open && eventDirty)
                setDiscardAction({ kind: "event", event: next });
              else if (!eventBusy) {
                setSelected(next);
                setEventDirty(false);
                setOpen(true);
              }
            }
          }}
        />
      </div>
      {global && (
        <div className="global-event-public-status">
          {(publicRuns.isPending || templates.isPending) && <Loading />}
          {(publicRuns.isError || templates.isError) && (
            <ErrorState
              retry={() => {
                void publicRuns.refetch();
                void templates.refetch();
              }}
            />
          )}
          {globals.isPending ? (
            <Loading />
          ) : globals.isError ? (
            <ErrorState retry={() => void globals.refetch()} />
          ) : (
            <>
              <p role="status">
                {publicationText("loaded", { count: globalRows.length })}
              </p>
              {globals.hasNextPage && (
                <Button
                  disabled={!online || globals.isFetchingNextPage}
                  onClick={() => void globals.fetchNextPage()}
                >
                  {publicationText("more")}
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {global &&
        !permissions.isError &&
        permissions.data?.includes("courses.manage") && (
          <GlobalEventManagement
            actor={session!.user.id}
            from={range.from}
            to={range.to}
            zone={zone}
          />
        )}
      {global && activeGlobal && (
        <GlobalEventDetails
          event={activeGlobal}
          displayZone={zone}
          onClose={() => setGlobalID(null)}
        />
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (eventBusy) return;
          if (!next && eventDirty) setDiscardAction({ kind: "close" });
          else setOpen(next);
        }}
        title={t(selected ? "privateEvent" : "addEvent")}
        description={t("eventHelp")}
      >
        <EventForm
          key={`${selected?.id ?? "new"}:${eventFormEpoch}`}
          userId={session!.user.id}
          zone={zone}
          event={selected}
          onBusyChange={setEventBusy}
          onDirtyChange={setEventDirty}
          onDone={(deleted) => {
            if (blocker.state === "blocked") blocker.reset();
            setEventDirty(false);
            setDiscardAction(null);
            setOpen(false);
            setMessage(t(deleted ? "eventDeleted" : "eventSaved"));
          }}
        />
        <Dialog
          open={discardAction !== null || blocker.state === "blocked"}
          onOpenChange={(next) => {
            if (!next) cancelDiscard();
          }}
          title={confirmText("discardTitle")}
          description={confirmText("discardDescription")}
        >
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={cancelDiscard}>
              {confirmText("keepDraft")}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={eventBusy}
              onClick={applyDiscardAction}
            >
              {confirmText("discardDraft")}
            </Button>
          </div>
        </Dialog>
      </Dialog>
    </>
  );
}
