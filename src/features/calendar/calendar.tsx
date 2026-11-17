/**
 * FullCalendar view of own events, confirmed assignments, published global events
 * and course sessions. Visible ranges bound global discovery; each source keeps
 * its own ACL. Private form times become instants before server-confirmed writes.
 */
import { Link } from "react-router-dom";
import "../availability/i18n";
import { assignmentJobTitlesQuery } from "../jobs/discovery-api";
import { runsQuery, templatesQuery } from "../operations/data";
import { useCallback, useRef, useState } from "react";
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
import { Plus } from "lucide-react";
import { CalendarExport } from "./export";
import { CalendarSubscriptions } from "./subscriptions";
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
  profileQuery,
  permissionsQuery,
} from "../../lib/queries";
import { db } from "../../lib/supabase";
import type { PersonalEvent } from "../../lib/types";
import { validZone, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
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
/** Validate private-event form input; current server permissions and constraints remain authoritative. */
const schema = z.object({
  title: z.string().trim().min(1).max(200),
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
}: {
  userId: string;
  zone: string;
  event?: PersonalEvent;
  onDone: (deleted?: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation();
  const confirmText = useTranslation("calendarConfirmation").t;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const client = useQueryClient();
  const online = useOnline();
  const [timeError, setTimeError] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: event
      ? {
          ...event,
          starts_at: DateTime.fromISO(event.starts_at)
            .setZone(event.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm"),
          ends_at: DateTime.fromISO(event.ends_at)
            .setZone(event.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm"),
        }
      : { title: "", starts_at: "", ends_at: "", time_zone: zone },
  });
  const save = useMutation({
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    mutationFn: async (values: z.infer<typeof schema>) => {
      requireOnline();
      setTimeError(false);
      const starts = zonedInstant(values.starts_at, values.time_zone);
      const ends = zonedInstant(values.ends_at, values.time_zone);
      if (!starts || !ends || ends <= starts) {
        setTimeError(true);
        throw new Error("invalid_time");
      }
      const payload = {
        title: values.title,
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
/** Combine separately authorized calendar sources and display them in the selected IANA zone. */
export function CalendarPage() {
  const { t, i18n } = useTranslation();
  const availabilityText = useTranslation("availability").t;
  const { session } = useAuth();
  const profile = useQuery(profileQuery(session!.user.id));
  const claims = useQuery(claimsQuery(session!.user.id));
  const personal = useQuery(eventsQuery(session!.user.id));
  const jobs = useQuery(
    assignmentJobTitlesQuery(
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
  const [selected, setSelected] = useState<PersonalEvent | undefined>();
  const [message, setMessage] = useState("");
  const online = useOnline();
  const zone = profile.data?.time_zone ?? "Europe/Berlin";
  if (
    claims.isPending ||
    personal.isPending ||
    (Boolean(claims.data?.length) && jobs.isPending)
  )
    return (
      <>
        <PageHeading title={t("calendar")} description={t("privateNote")} />
        <CalendarSubscriptions
          key={`subscriptions-${session!.user.id}`}
          actor={session!.user.id}
          zone={zone}
        />
        <OfflineSchedule
          key={`offline-${session!.user.id}`}
          actor={session!.user.id}
          zone={zone}
        />
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
        <CalendarSubscriptions
          key={`subscriptions-${session!.user.id}`}
          actor={session!.user.id}
          zone={zone}
        />
        <OfflineSchedule
          key={`offline-${session!.user.id}`}
          actor={session!.user.id}
          zone={zone}
        />
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
  const events = global
    ? [
        ...globalRows.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.starts_at,
          end: e.ends_at,
          color: "#1749b5",
          extendedProps: { kind: "global" },
        })),
        ...(publicRuns.isError || templates.isError
          ? []
          : (publicRuns.data ?? [])
        )
          .filter((run) => run.published && !run.archived_at)
          .flatMap((run) =>
            run.course_sessions.map((s) => ({
              id: `course-${s.id}`,
              title:
                templates.data?.find((t) => t.id === run.template_id)?.title ??
                t("courses"),
              start: s.starts_at,
              end: s.ends_at,
              color: "#326c58",
              url: `/courses?run=${run.id}`,
              extendedProps: { kind: "course" },
            })),
          ),
      ]
    : [
        ...personal.data.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.starts_at,
          end: e.ends_at,
          color: "#326c58",
          extendedProps: { kind: "private" },
        })),
        ...claims.data.flatMap((c) =>
          c.assignment_sessions.map((s) => ({
            id: s.id,
            title:
              jobs.data?.find((j) => j.id === c.job_id)?.title ??
              t("assignment"),
            start: s.starts_at,
            end: s.ends_at,
            color: "#1749b5",
            url: `/jobs/${c.job_id}`,
            extendedProps: { kind: "assignment" },
          })),
        ),
      ];
  return (
    <>
      <PageHeading
        title={t("calendar")}
        description={t("privateNote")}
        action={
          <Button
            onClick={() => {
              setSelected(undefined);
              setOpen(true);
            }}
            disabled={!online}
          >
            <Plus size={18} />
            {t("addEvent")}
          </Button>
        }
      />
      <Button asChild variant="secondary">
        <Link to="/availability">{availabilityText("title")}</Link>
      </Button>
      <div className="calendar-controls">
        <div className="segmented">
          <Button
            variant={!global ? "default" : "ghost"}
            onClick={() => setGlobal(false)}
          >
            {t("privateCalendar")}
          </Button>
          <Button
            variant={global ? "default" : "ghost"}
            onClick={() => setGlobal(true)}
          >
            {publicationText("global")}
          </Button>
        </div>
        <span className="badge">{zone}</span>
      </div>
      {message && <Notice>{message}</Notice>}
      <CalendarExport
        key={session!.user.id}
        actor={session!.user.id}
        zone={zone}
      />
      <CalendarSubscriptions
        key={`subscriptions-${session!.user.id}`}
        actor={session!.user.id}
        zone={zone}
      />
      <OfflineSchedule
        key={`offline-${session!.user.id}`}
        actor={session!.user.id}
        zone={zone}
      />
      <div className="panel calendar-panel">
        <FullCalendar
          plugins={[
            dayGridPlugin,
            timeGridPlugin,
            listPlugin,
            interactionPlugin,
            luxonPlugin,
          ]}
          locale={i18n.language === "de" ? deLocale : enLocale}
          timeZone={zone}
          initialView={window.innerWidth < 700 ? "listMonth" : "dayGridMonth"}
          headerToolbar={{
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listMonth",
          }}
          datesSet={handleDatesSet}
          events={events}
          height="auto"
          buttonIcons={false}
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
              setSelected(personal.data.find((e) => e.id === info.event.id));
              setOpen(true);
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
          onClose={() => setGlobalID(null)}
        />
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!eventBusy) setOpen(next);
        }}
        title={t(selected ? "privateEvent" : "addEvent")}
        description={t("eventHelp")}
      >
        <EventForm
          key={selected?.id ?? "new"}
          userId={session!.user.id}
          zone={zone}
          event={selected}
          onBusyChange={setEventBusy}
          onDone={(deleted) => {
            setOpen(false);
            setMessage(t(deleted ? "eventDeleted" : "eventSaved"));
          }}
        />
      </Dialog>
    </>
  );
}
