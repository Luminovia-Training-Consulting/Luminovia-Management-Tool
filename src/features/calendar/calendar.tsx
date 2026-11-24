/**
 * FullCalendar view of own events, confirmed assignments, published global events
 * and course sessions. The visible range bounds each read; each source keeps
 * its own ACL. Private form times become instants before server-confirmed writes.
 */
import { useBlocker, useSearchParams } from "react-router-dom";
import { assignmentCalendarMetadataQuery } from "../jobs/discovery-api";
import { CalendarColorPreferences } from "./calendar-colors";
import { CalendarInvitationOverview } from "./invitations";
import {
  calendarColorsQuery,
  defaultCalendarColors,
} from "./calendar-color-api";
import {
  calendarCourseRunsQuery,
  orgQuery,
  templatesQuery,
} from "../operations/data";
import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  DateSelectArg,
  DatesSetArg,
  DayCellMountArg,
  EventClickArg,
  EventContentArg,
  EventMountArg,
} from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import { useForm, useWatch } from "react-hook-form";
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
import { permissionsQuery, profileQuery, topicsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import {
  calendarAssignmentsQuery,
  calendarAssignmentStartQuery,
  privateCalendarEventsQuery,
} from "./calendar-window-api";
import type { PersonalEvent } from "../../lib/types";
import {
  dateTime,
  validZone,
  zonedInstant,
  zonedInstantForEdit,
} from "../../lib/dates";
import { useRequestKey } from "../../lib/request-key";
import { RecurrenceFields } from "../../components/recurrence-fields";
import type { RecurrenceRule } from "../../lib/recurrence";
import {
  cancelFuturePersonalEvents,
  preparePersonalSeries,
  savePersonalSeries,
  type PersonalSeriesPayload,
} from "./personal-series";
import { personalSeriesLimit } from "./personal-series-schema";
import "./personal-series-i18n";
import { canRetryNextPage } from "../../lib/paged-read";
import { requireOnline, useOnline } from "../../lib/online";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { CalendarDisplayZone } from "./display-zone";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { calendarFoldLabel } from "./display-time";
import {
  ErrorState,
  Field,
  Loading,
  NextPageError,
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
import {
  calendarClickRange,
  calendarSelectionRange,
  type CalendarDraftRange,
} from "./date-selection";
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
  draftRange,
  onDone,
  onBusyChange,
  onDirtyChange,
}: {
  userId: string;
  zone: string;
  event?: PersonalEvent;
  draftRange?: CalendarDraftRange;
  onDone: (deleted?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const confirmText = useTranslation("calendarConfirmation").t;
  const detailText = useTranslation("privateCalendarDetails").t;
  const seriesText = useTranslation("personalCalendarSeries").t;
  const [confirmation, setConfirmation] = useState<"single" | "future" | null>(
    null,
  );
  const [rule, setRule] = useState<RecurrenceRule | null>(null);
  const [review, setReview] = useState<PersonalSeriesPayload | null>(null);
  const [reviewTrigger, setReviewTrigger] = useState<HTMLButtonElement | null>(
    null,
  );
  const [removeTrigger, setRemoveTrigger] = useState<HTMLButtonElement | null>(
    null,
  );
  const [invalidSeries, setInvalidSeries] = useState(false);
  const request = useRequestKey();
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
    control,
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
          starts_at: draftRange?.starts_at ?? "",
          ends_at: draftRange?.ends_at ?? "",
          time_zone: draftRange?.time_zone ?? zone,
        },
  });
  const [startsAt, endsAt, eventZone] = useWatch({
    control,
    name: ["starts_at", "ends_at", "time_zone"],
  });
  const dirty = isDirty || rule !== null;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
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
  const saveSeries = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (payload: PersonalSeriesPayload) => {
      requireOnline();
      return savePersonalSeries(
        request.forInput(JSON.stringify(payload)),
        payload,
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["events", userId] });
      onDone();
    },
  });
  const remove = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (scope: "single" | "future") => {
      requireOnline();
      if (scope === "future" && event?.recurrence_series_id)
        return cancelFuturePersonalEvents(event.recurrence_series_id);
      if (!event) throw new Error("No event selected");
      const { data, error } = await db()
        .from("personal_events")
        .delete()
        .eq("id", event.id)
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
  const busy = save.isPending || remove.isPending || saveSeries.isPending;
  const prepare = (values: z.infer<typeof schema>) => {
    if (busy || !online) return;
    if (!rule || event) {
      save.mutate(values);
      return;
    }
    setInvalidSeries(false);
    save.reset();
    saveSeries.reset();
    try {
      setReview(preparePersonalSeries(values, rule));
    } catch {
      setInvalidSeries(true);
    }
  };
  return (
    <form onSubmit={handleSubmit(prepare)} noValidate>
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
        <select {...register("time_zone")}>
          <TimeZoneOptions current={event?.time_zone ?? zone} />
        </select>
      </Field>
      {!event && (
        <RecurrenceFields
          anchor={{ starts_at: startsAt, ends_at: endsAt }}
          zone={eventZone}
          value={rule}
          onChange={(next) => {
            setRule(next);
            setInvalidSeries(false);
          }}
          max={personalSeriesLimit}
          disabled={busy}
        />
      )}
      {invalidSeries && <Notice kind="error">{seriesText("invalid")}</Notice>}
      {event?.recurrence_series_id && <p>{seriesText("occurrence")}</p>}
      {save.isError && (
        <Notice kind="error">{t(timeError ? "invalidTime" : "error")}</Notice>
      )}
      <div className="form-actions">
        <Button ref={setReviewTrigger} disabled={!online || busy}>
          {rule && !event ? seriesText("review") : t("saveEvent")}
        </Button>
        {event && (
          <Button
            type="button"
            variant="danger"
            disabled={!online || busy}
            onClick={(event) => {
              setRemoveTrigger(event.currentTarget);
              remove.reset();
              setConfirmation("single");
            }}
          >
            {t("deleteEvent")}
          </Button>
        )}
        {event?.recurrence_series_id && (
          <Button
            type="button"
            variant="danger"
            disabled={!online || busy}
            onClick={(event) => {
              setRemoveTrigger(event.currentTarget);
              remove.reset();
              setConfirmation("future");
            }}
          >
            {seriesText("cancelFuture")}
          </Button>
        )}
      </div>
      <Dialog
        open={review !== null}
        onOpenChange={(next) => {
          if (!next && !saveSeries.isPending) setReview(null);
        }}
        closeDisabled={saveSeries.isPending}
        returnFocusTo={reviewTrigger}
        title={seriesText("review")}
        description={seriesText("reviewHint")}
      >
        {review && (
          <>
            <ol>
              {review.p_occurrences.map((slot) => (
                <li key={slot.starts_at}>
                  {dateTime(slot.starts_at, i18n.language, review.p_time_zone)}
                  {" – "}
                  {dateTime(slot.ends_at, i18n.language, review.p_time_zone)}
                </li>
              ))}
            </ol>
            {saveSeries.isError && (
              <Notice kind="error">
                {seriesText(
                  (saveSeries.error as { code?: string })?.code === "23P01"
                    ? "conflict"
                    : "failed",
                )}
              </Notice>
            )}
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={saveSeries.isPending}
                onClick={() => setReview(null)}
              >
                {t("cancel")}
              </Button>
              <Button
                type="button"
                disabled={!online || saveSeries.isPending}
                onClick={() => saveSeries.mutate(review)}
              >
                {seriesText("save")}
              </Button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(next) => {
          if (!next && !remove.isPending) setConfirmation(null);
        }}
        closeDisabled={remove.isPending}
        returnFocusTo={removeTrigger}
        title={
          confirmation === "future"
            ? seriesText("cancelTitle")
            : confirmText("deleteTitle")
        }
        description={
          confirmation === "future"
            ? seriesText("cancelHint")
            : confirmText("deleteDescription")
        }
      >
        <p>{event?.title}</p>
        {remove.isError && (
          <Notice kind="error">
            {confirmation === "future"
              ? seriesText("cancelFailed")
              : confirmText("deleteFailed")}
          </Notice>
        )}
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={remove.isPending}
            onClick={() => setConfirmation(null)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={!online || remove.isPending}
            onClick={() => {
              if (confirmation) remove.mutate(confirmation);
            }}
          >
            {confirmation === "future"
              ? seriesText("cancelFuture")
              : t("deleteEvent")}
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

// FullCalendar resets its options on every React update. Stable props keep
// transient toolbar and dialog state from rebuilding the grid.
const CalendarGrid = memo(FullCalendar);
const calendarPlugins = [
  dayGridPlugin,
  timeGridPlugin,
  listPlugin,
  interactionPlugin,
  luxonPlugin,
];
const emptyMetadata = {
  customerKey: "",
  customerName: "",
  topics: [] as { id: string; label_de: string; label_en: string }[],
};

function adjustDayCell({ el }: DayCellMountArg) {
  el.removeAttribute("aria-labelledby");
}

function adjustCalendarEvent({ el, event }: EventMountArg) {
  if (event.url) return;
  // FullCalendar activates href-less anchors with Enter/Space.
  const target = el.matches("a")
    ? el
    : el.querySelector(".fc-list-event-title a");
  target?.setAttribute("role", "button");
}

type PersonalEditorDraft = {
  event?: PersonalEvent;
  range?: CalendarDraftRange;
};

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
  const actor = session!.user.id;
  const assignment = calendarParams.get("assignment");
  const [global, setGlobal] = useState(false);
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
  const assignmentStartOptions = calendarAssignmentStartQuery(
    actor,
    assignment,
  );
  const assignmentStart = useQuery(assignmentStartOptions);
  const waitingForAnchor =
    assignmentStartOptions.enabled && assignmentStart.isPending;
  const personal = useQuery({
    ...privateCalendarEventsQuery(actor, range),
    enabled: !global && !waitingForAnchor,
  });
  const assignments = useQuery({
    ...calendarAssignmentsQuery(actor, range),
    enabled: !global && !waitingForAnchor,
  });
  const assignmentRows = assignments.isError ? undefined : assignments.data;
  const jobOptions = useMemo(
    () =>
      assignmentCalendarMetadataQuery(
        actor,
        (assignmentRows ?? []).map(({ job_claims }) => job_claims.job_id),
      ),
    [actor, assignmentRows],
  );
  const jobs = useQuery({
    ...jobOptions,
    enabled: !global && jobOptions.enabled,
  });
  const publicRuns = useQuery({
    ...calendarCourseRunsQuery(actor, range.from, range.to),
    enabled: global,
    refetchOnWindowFocus: "always",
    refetchInterval: 15000,
  });
  const globals = useInfiniteQuery({
    ...globalEventsQuery(session!.user.id, range.from, range.to),
    enabled: global,
  });
  const [globalID, setGlobalID] = useState<string | null>(null);
  const retryGlobalPage = canRetryNextPage(globals);
  const globalsFailed = globals.isError && !retryGlobalPage;
  const calendarPages = globals.data?.pages;
  const globalRows = useMemo(() => {
    if (globalsFailed) return [];
    const indexed = new Map<
      string,
      NonNullable<typeof calendarPages>[number]["items"][number]
    >();
    for (const page of calendarPages ?? [])
      for (const event of page.items) indexed.set(event.id, event);
    return Array.from(indexed.values());
  }, [calendarPages, globalsFailed]);
  const visibleRange = useRef(range);
  const handleDatesSet = useCallback(
    (info: DatesSetArg) => {
      if (info.view?.title) setCalendarTitle(info.view.title);
      if (calendarViews.includes(info.view?.type as CalendarView))
        setCalendarView(info.view.type as CalendarView);
      const next = {
        from: info.start.toISOString(),
        to: info.end.toISOString(),
      };
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
    },
    [setRange],
  );
  const activeGlobal = globalRows.find((event) => event.id === globalID);
  const [open, setOpen] = useState(false);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventDirty, setEventDirty] = useState(false);
  const [eventFormEpoch, setEventFormEpoch] = useState(0);
  const [editorDraft, setEditorDraft] = useState<PersonalEditorDraft>({});
  const selected = editorDraft.event;
  const [globalDraft, setGlobalDraft] = useState<CalendarDraftRange>();
  const canManageGlobal =
    !permissions.isError &&
    permissions.data?.includes("courses.manage") === true;
  if (globalDraft && !canManageGlobal) setGlobalDraft(undefined);
  // FullCalendar can emit drag and click for the same ending pointer event.
  const selectedPointer = useRef<Event>(null);
  const clearGridSelection = useCallback(() => {
    calendarRef.current?.getApi().unselect();
  }, []);
  const closeGlobalDraft = useCallback(() => {
    setGlobalDraft(undefined);
    clearGridSelection();
  }, [clearGridSelection]);
  const [discardAction, setDiscardAction] = useState<
    { kind: "close" } | { kind: "event"; draft: PersonalEditorDraft } | null
  >(null);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      open &&
      (eventDirty || eventBusy) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.hash !== nextLocation.hash),
  );
  const openPersonalEditor = useCallback(
    (draft: PersonalEditorDraft) => {
      if (eventBusy) return;
      if (open && eventDirty) {
        setDiscardAction({ kind: "event", draft });
        return;
      }
      setEditorDraft(draft);
      setEventDirty(false);
      setEventFormEpoch((value) => value + 1);
      setOpen(true);
    },
    [eventBusy, eventDirty, open],
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
      setEditorDraft(action.draft);
      setOpen(true);
    } else {
      setOpen(false);
      clearGridSelection();
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
  if (viewAnchor && viewAnchor.assignment !== assignment)
    setViewAnchor(undefined);
  const personalRows = personal.isError ? undefined : personal.data;
  const jobsById = useMemo(
    () => new Map(jobs.isError ? [] : jobs.data?.map((job) => [job.id, job])),
    [jobs.data, jobs.isError],
  );
  const templatesById = useMemo(
    () => new Map(templates.data?.map((template) => [template.id, template])),
    [templates.data],
  );
  const organisationsById = useMemo(
    () => new Map(organisations.data?.map((org) => [org.id, org.name])),
    [organisations.data],
  );
  const topicsById = useMemo(
    () => new Map(topics.data?.map((topic) => [topic.id, topic])),
    [topics.data],
  );
  const colors = calendarColors.data ?? defaultCalendarColors;
  const events = useMemo(
    () =>
      global
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
            ).flatMap((run) => {
              const template = templatesById.get(run.template_id);
              const customerCreated = Boolean(run.organisation_id);
              const customerName =
                !organisations.isError && run.organisation_id
                  ? (organisationsById.get(run.organisation_id) ?? "")
                  : "";
              const courseTopics = topics.isError
                ? []
                : (template?.course_template_topics ?? []).flatMap(
                    ({ topic_id }) => {
                      const topic = topicsById.get(topic_id);
                      return topic
                        ? [
                            {
                              id: topic.id,
                              label_de: topic.label_de,
                              label_en: topic.label_en,
                            },
                          ]
                        : [];
                    },
                  );
              return run.course_sessions.map((s) => ({
                id: `course-${s.id}`,
                title: template?.title ?? t("courses"),
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
                  customerName,
                  topics: courseTopics,
                },
              }));
            }),
          ]
        : [
            ...(personalRows ?? []).map((e) => ({
              id: e.id,
              title: e.title,
              start: e.starts_at,
              end: e.ends_at,
              display: "block",
              color: colors.personal_event_color,
              textColor: "#17283a",
              extendedProps: { kind: "private", ...emptyMetadata },
            })),
            ...(assignmentRows ?? []).map((session) => {
              const jobId = session.job_claims.job_id;
              const job = jobsById.get(jobId);
              const customerKey =
                job?.organisation_id ??
                (job?.organisation_name ? `name:${job.organisation_name}` : "");
              const customerCreated = Boolean(customerKey);
              return {
                id: session.id,
                title: job?.title ?? t("assignment"),
                start: session.starts_at,
                end: session.ends_at,
                display: "block",
                color: customerCreated
                  ? colors.customer_event_color
                  : colors.assignment_event_color,
                textColor: "#17283a",
                url: `/jobs/${jobId}`,
                extendedProps: {
                  kind: "assignment",
                  customerCreated,
                  customerKey,
                  customerName: job?.organisation_name ?? "",
                  topics: job?.topics ?? [],
                },
              };
            }),
          ],
    [
      global,
      globalRows,
      publicRuns.data,
      publicRuns.isError,
      templates.isError,
      templatesById,
      organisations.isError,
      organisationsById,
      topics.isError,
      topicsById,
      personalRows,
      assignmentRows,
      jobsById,
      colors,
      t,
    ],
  );
  // FullCalendar's grid stores civil times internally. Retain the exact source
  // instants to label events in a repeated hour with separate UTC offsets.
  const { sourceEvents, customers, eventTopics } = useMemo(() => {
    const sourceEvents = new Map<string, (typeof events)[number]>();
    const customers = new Map<string, string>();
    const eventTopics = new Map<
      string,
      (typeof emptyMetadata.topics)[number]
    >();
    for (const event of events) {
      sourceEvents.set(event.id, event);
      const { customerKey, customerName, topics } = event.extendedProps;
      if (customerName) customers.set(customerKey, customerName);
      for (const topic of topics) eventTopics.set(topic.id, topic);
    }
    return { sourceEvents, customers, eventTopics };
  }, [events]);
  const language = i18n.language;
  const german = language.startsWith("de");
  const { customerOptions, topicOptions } = useMemo(
    () => ({
      customerOptions: [...customers].sort((a, b) =>
        a[1].localeCompare(b[1], language),
      ),
      topicOptions: [...eventTopics.values()].sort((a, b) =>
        (german ? a.label_de : a.label_en).localeCompare(
          german ? b.label_de : b.label_en,
          language,
        ),
      ),
    }),
    [customers, eventTopics, german, language],
  );
  const searchTerm = useDeferredValue(search.trim().toLocaleLowerCase());
  const selectedTopics = useMemo(() => new Set(topicIds), [topicIds]);
  const visibleEvents = useMemo(() => {
    if (eventType === "all" && !customer && !selectedTopics.size && !searchTerm)
      return events;
    return events.filter(
      (event) =>
        (eventType === "all" || event.extendedProps.kind === eventType) &&
        (!customer || event.extendedProps.customerKey === customer) &&
        (!selectedTopics.size ||
          event.extendedProps.topics.some((topic) =>
            selectedTopics.has(topic.id),
          )) &&
        (!searchTerm || event.title.toLocaleLowerCase().includes(searchTerm)),
    );
  }, [events, eventType, customer, selectedTopics, searchTerm]);
  const weekView = calendarView === "timeGridWeek";
  const scopeAllowsSelection = !global || canManageGlobal;
  const gridSelectionEnabled =
    scopeAllowsSelection && online && !open && !globalDraft;
  const openGridSelection = useCallback(
    (range: CalendarDraftRange) => {
      if (global) setGlobalDraft(range);
      else openPersonalEditor({ range });
    },
    [global, openPersonalEditor],
  );
  const handleSelect = useCallback(
    (info: DateSelectArg) => {
      if (!gridSelectionEnabled) return;
      selectedPointer.current = info.jsEvent ?? null;
      openGridSelection(
        calendarSelectionRange(info.startStr, info.endStr, info.allDay, zone),
      );
    },
    [gridSelectionEnabled, openGridSelection, zone],
  );
  const handleDateClick = useCallback(
    (info: DateClickArg) => {
      if (!gridSelectionEnabled || selectedPointer.current === info.jsEvent)
        return;
      openGridSelection(calendarClickRange(info.dateStr, info.allDay, zone));
    },
    [gridSelectionEnabled, openGridSelection, zone],
  );
  const handleEventClick = useCallback(
    (info: EventClickArg) => {
      if (info.event.extendedProps.kind === "global") {
        info.jsEvent.preventDefault();
        setGlobalID(info.event.id);
      }
      if (info.event.extendedProps.kind === "private") {
        const next = personalRows?.find((event) => event.id === info.event.id);
        if (next) openPersonalEditor({ event: next });
      }
    },
    [openPersonalEditor, personalRows],
  );
  const showEventContent = useCallback(
    ({ event }: EventContentArg) => {
      const source = sourceEvents.get(event.id);
      const label =
        source && calendarFoldLabel(source.start, source.end, zone, language);
      if (!label) return true;
      return (
        <>
          <div className="fc-event-time">{label}</div>
          <div className="fc-event-title">{event.title}</div>
        </>
      );
    },
    [sourceEvents, zone, language],
  );
  return (
    <>
      <PageHeading
        title={t("calendar")}
        description={t("privateNote")}
        action={
          <Button onClick={() => openPersonalEditor({})} disabled={!online}>
            <Plus size={18} />
            {t("addEvent")}
          </Button>
        }
      />
      <div className="calendar-utilities">
        <CalendarInvitationOverview actor={session!.user.id} />
        <CalendarTools actor={session!.user.id} zone={zone} />
        <CalendarColorPreferences actor={session!.user.id} />
      </div>
      <div className="calendar-controls">
        <div
          className="segmented"
          role="group"
          aria-label={filterText("calendarScope")}
        >
          <Button
            variant={!global ? "default" : "ghost"}
            aria-pressed={!global}
            onClick={() => {
              setGlobal(false);
              closeGlobalDraft();
              setEventType("all");
              setCustomer("");
              setTopicIds([]);
            }}
          >
            {t("privateCalendar")}
          </Button>
          <Button
            variant={global ? "default" : "ghost"}
            aria-pressed={global}
            onClick={() => {
              setGlobal(true);
              clearGridSelection();
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
              .filter((topic) => !selectedTopics.has(topic.id))
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
      {topicIds.length > 0 && (
        <div
          className="calendar-topic-tags"
          aria-label={filterText("selectedTopics")}
        >
          {topicIds.map((id) => {
            const topic = eventTopics.get(id);
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
        {scopeAllowsSelection && online && calendarView !== "listMonth" && (
          <p className="calendar-selection-help">
            {filterText("selectPeriod")}
          </p>
        )}
        {weekView && (
          <p
            id="calendar-week-scroll-hint"
            className="calendar-week-scroll-hint"
          >
            {filterText("scrollWeek")}
          </p>
        )}
        {!global && (
          <div aria-live="polite">
            {(waitingForAnchor ||
              personal.isPending ||
              assignments.isPending ||
              (jobOptions.enabled && jobs.isPending)) && <Loading />}
            {(personal.isError ||
              assignments.isError ||
              assignmentStart.isError ||
              (jobOptions.enabled && jobs.isError)) && (
              <ErrorState
                retry={() => {
                  if (personal.isError) void personal.refetch();
                  if (assignments.isError) void assignments.refetch();
                  if (assignmentStart.isError) void assignmentStart.refetch();
                  if (jobOptions.enabled && jobs.isError) void jobs.refetch();
                }}
              />
            )}
          </div>
        )}
        <div
          className={weekView ? "calendar-week-grid" : undefined}
          role={weekView ? "region" : undefined}
          aria-label={weekView ? filterText("weeklyCalendar") : undefined}
          aria-describedby={weekView ? "calendar-week-scroll-hint" : undefined}
          tabIndex={weekView ? 0 : undefined}
        >
          {/* A live timezone change can collapse distinct UTC instants in a DST
            fold. Build a new date environment from the source events instead. */}
          {!waitingForAnchor && (
            <CalendarGrid
              key={`${zone}/${assignment ?? ""}`}
              plugins={calendarPlugins}
              locale={german ? deLocale : enLocale}
              timeZone={zone}
              ref={calendarRef}
              initialView={calendarView}
              initialDate={
                (viewAnchor?.assignment === assignment
                  ? viewAnchor.date
                  : undefined) ??
                assignmentStart.data ??
                undefined
              }
              headerToolbar={false}
              datesSet={handleDatesSet}
              events={visibleEvents}
              height="auto"
              eventContent={showEventContent}
              dayCellDidMount={adjustDayCell}
              eventInteractive
              eventDidMount={adjustCalendarEvent}
              selectable={gridSelectionEnabled}
              selectMinDistance={6}
              selectLongPressDelay={400}
              select={handleSelect}
              dateClick={handleDateClick}
              nowIndicator
              dayMaxEvents={3}
              eventClick={handleEventClick}
            />
          )}
        </div>
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
          ) : globalsFailed ? (
            <ErrorState retry={() => void globals.refetch()} />
          ) : (
            <>
              <p role="status">
                {publicationText("loaded", { count: globalRows.length })}
              </p>
              {retryGlobalPage ? (
                <NextPageError
                  retry={() =>
                    void globals.fetchNextPage({ cancelRefetch: false })
                  }
                  disabled={!online || globals.isFetching}
                />
              ) : (
                globals.hasNextPage && (
                  <Button
                    disabled={!online || globals.isFetching}
                    onClick={() =>
                      void globals.fetchNextPage({ cancelRefetch: false })
                    }
                  >
                    {publicationText("more")}
                  </Button>
                )
              )}
            </>
          )}
        </div>
      )}
      {global && canManageGlobal && (
        <GlobalEventManagement
          actor={session!.user.id}
          from={range.from}
          to={range.to}
          zone={zone}
          selection={globalDraft}
          onSelectionClose={closeGlobalDraft}
        />
      )}
      {global && activeGlobal && (
        <GlobalEventDetails
          key={activeGlobal.id}
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
          else {
            setOpen(next);
            if (!next) clearGridSelection();
          }
        }}
        title={t(selected ? "privateEvent" : "addEvent")}
        description={t("eventHelp")}
      >
        <EventForm
          key={`${selected?.id ?? "new"}:${eventFormEpoch}`}
          userId={session!.user.id}
          zone={zone}
          event={selected}
          draftRange={editorDraft.range}
          onBusyChange={setEventBusy}
          onDirtyChange={setEventDirty}
          onDone={(deleted) => {
            if (blocker.state === "blocked") blocker.reset();
            setEventDirty(false);
            setDiscardAction(null);
            setOpen(false);
            clearGridSelection();
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
