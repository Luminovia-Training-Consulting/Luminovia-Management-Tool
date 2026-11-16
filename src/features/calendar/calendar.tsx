/**
 * FullCalendar view of own events, confirmed assignments and published course sessions. Each
 * source retains its visibility rules; convert local form times to instants before mutations.
 */
import { Link } from "react-router-dom";
import "../availability/i18n";
import { runsQuery, templatesQuery } from "../operations/data";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
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
  jobsQuery,
  profileQuery,
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
/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  title: z.string().trim().min(1).max(200),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  time_zone: z.string().refine(validZone),
});
/** Create a private event from unambiguous zoned input and invalidate the actor's event query. */
function EventForm({
  userId,
  zone,
  event,
  onDone,
}: {
  userId: string;
  zone: string;
  event?: PersonalEvent;
  onDone: (deleted?: boolean) => void;
}) {
  const { t } = useTranslation();
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
      {remove.isError && <Notice kind="error">{t("error")}</Notice>}
      <div className="form-actions">
        <Button disabled={!online || save.isPending || remove.isPending}>
          {t("saveEvent")}
        </Button>
        {event && (
          <Button
            type="button"
            variant="danger"
            disabled={!online || save.isPending || remove.isPending}
            onClick={() => remove.mutate()}
          >
            {t("deleteEvent")}
          </Button>
        )}
      </div>
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
  const jobs = useQuery(jobsQuery);
  const [global, setGlobal] = useState(false);
  const publicRuns = useQuery({
    ...runsQuery(session!.user.id),
    enabled: global,
  });
  const templates = useQuery({
    ...templatesQuery(session!.user.id),
    enabled: global,
  });
  const globals = useQuery({
    queryKey: ["global-events"],
    queryFn: async () => {
      const { data, error } = await db()
        .from("global_events")
        .select("*")
        .eq("published", true);
      if (error) throw error;
      return data as {
        id: string;
        title: string;
        starts_at: string;
        ends_at: string;
      }[];
    },
  });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PersonalEvent | undefined>();
  const [message, setMessage] = useState("");
  const online = useOnline();
  const zone = profile.data?.time_zone ?? "Europe/Berlin";
  if (
    claims.isPending ||
    personal.isPending ||
    jobs.isPending ||
    globals.isPending ||
    (global && (publicRuns.isPending || templates.isPending))
  )
    return <Loading />;
  if (
    claims.isError ||
    personal.isError ||
    jobs.isError ||
    globals.isError ||
    (global && (publicRuns.isError || templates.isError))
  )
    return (
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
    );
  const events = global
    ? [
        ...globals.data.map((e) => ({
          id: e.id,
          title: e.title,
          start: e.starts_at,
          end: e.ends_at,
          color: "#1749b5",
          extendedProps: { kind: "global" },
        })),
        ...(publicRuns.data ?? [])
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
              jobs.data.find((j) => j.id === c.job_id)?.title ??
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
            {i18n.language === "de" ? "Globale Termine" : "Global events"}
          </Button>
        </div>
        <span className="badge">{zone}</span>
      </div>
      {message && <Notice>{message}</Notice>}
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
          events={events}
          height="auto"
          buttonIcons={false}
          dayCellDidMount={(arg) => arg.el.removeAttribute("aria-labelledby")}
          eventInteractive
          nowIndicator
          dayMaxEvents={3}
          eventClick={(info) => {
            if (info.event.extendedProps.kind === "private") {
              setSelected(personal.data.find((e) => e.id === info.event.id));
              setOpen(true);
            }
          }}
        />
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t(selected ? "privateEvent" : "addEvent")}
        description={t("eventHelp")}
      >
        <EventForm
          key={selected?.id ?? "new"}
          userId={session!.user.id}
          zone={zone}
          event={selected}
          onDone={(deleted) => {
            setOpen(false);
            setMessage(t(deleted ? "eventDeleted" : "eventSaved"));
          }}
        />
      </Dialog>
    </>
  );
}
