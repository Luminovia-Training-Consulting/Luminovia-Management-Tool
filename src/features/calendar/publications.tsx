import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { useRequestKey } from "../../lib/request-key";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import { saveBlob } from "../../lib/blob-download";
import { globalEventCalendarFile } from "./ical";
import { CalendarInvitationEditor } from "./invitations";
import {
  type GlobalEvent,
  type GlobalEventForm,
  globalEventFormSchema,
  globalEventPayload,
  globalEventsQuery,
  manageGlobalEvent,
  refreshGlobalEvents,
} from "./publications-api";
import "./publications-i18n";
import "./publications.css";

function GlobalEventEditor({
  event,
  zone,
  onDone,
  onDenied,
}: {
  event?: GlobalEvent;
  zone: string;
  onDone: () => void;
  onDenied: () => void;
}) {
  const { t } = useTranslation("calendarPublications"),
    common = useTranslation().t,
    online = useOnline(),
    client = useQueryClient();
  const [base] = useState(event),
    [invalid, setInvalid] = useState(false),
    key = useRequestKey();
  const form = useForm<GlobalEventForm>({
    resolver: zodResolver(globalEventFormSchema),
    defaultValues: {
      title: base?.title ?? "",
      description: base?.description ?? "",
      link_url: base?.link_url ?? "",
      starts_at: base
        ? DateTime.fromISO(base.starts_at)
            .setZone(base.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
      ends_at: base
        ? DateTime.fromISO(base.ends_at)
            .setZone(base.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
      time_zone: base?.time_zone ?? zone,
    },
  });
  const save = useMutation({
    mutationFn: async (values: GlobalEventForm) => {
      setInvalid(false);
      let payload;
      try {
        payload = globalEventPayload(values, base);
      } catch {
        setInvalid(true);
        throw Error("invalid-time");
      }
      const signature = JSON.stringify([
        base?.id ?? null,
        base?.version ?? 0,
        payload,
      ]);
      const keyId = key.forInput(signature);
      return manageGlobalEvent(
        base?.id ?? null,
        "save",
        base?.version ?? 0,
        keyId,
        payload,
      );
    },
    onSuccess: async () => {
      await refreshGlobalEvents(client);
      onDone();
    },
    onError: (e) => {
      if (isDatabasePermissionDenied(e)) onDenied();
    },
  });
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))}>
      <Notice>{t("saveHint")}</Notice>
      <Field
        id="global-title"
        label={t("title")}
        error={Boolean(form.formState.errors.title)}
      >
        <input {...form.register("title")} maxLength={200} />
      </Field>
      <Field
        id="global-description"
        label={t("description")}
        error={Boolean(form.formState.errors.description)}
      >
        <textarea {...form.register("description")} rows={5} maxLength={8000} />
      </Field>
      <Field
        id="global-link"
        label={t("link")}
        error={Boolean(form.formState.errors.link_url)}
      >
        <input type="url" {...form.register("link_url")} maxLength={2000} />
      </Field>
      <div className="form-row">
        {(["starts_at", "ends_at"] as const).map((name) => (
          <Field
            key={name}
            id={`global-${name}`}
            label={common(name === "starts_at" ? "start" : "end")}
            error={Boolean(form.formState.errors[name])}
          >
            <input type="datetime-local" {...form.register(name)} />
          </Field>
        ))}
      </div>
      <Field
        id="global-zone"
        label={common("timezone")}
        error={Boolean(form.formState.errors.time_zone)}
      >
        <input {...form.register("time_zone")} />
      </Field>
      {(invalid || Object.keys(form.formState.errors).length > 0) && (
        <Notice kind="error">{t("invalid")}</Notice>
      )}
      {save.isError && !invalid && <Notice kind="error">{t("error")}</Notice>}
      <Button disabled={!online || save.isPending}>{t("save")}</Button>
    </form>
  );
}

export function GlobalEventDetails({
  event,
  displayZone,
  onClose,
}: {
  event: GlobalEvent;
  displayZone: string;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation("calendarPublications");
  const common = useTranslation().t;
  const [downloadFailed, setDownloadFailed] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={event.title}
      description={t("details")}
    >
      <p>
        {dateTime(event.starts_at, i18n.language, event.time_zone)} –{" "}
        {dateTime(event.ends_at, i18n.language, event.time_zone)} ·{" "}
        {event.time_zone}
      </p>
      {displayZone !== event.time_zone && (
        <p>
          <strong>
            {common("calendarDisplayedTime")} ({displayZone})
          </strong>{" "}
          {dateTime(event.starts_at, i18n.language, displayZone)} –{" "}
          {dateTime(event.ends_at, i18n.language, displayZone)}
        </p>
      )}
      <p className="preserve-text">{event.description}</p>
      <div className="form-actions global-event-detail-actions">
        {event.link_url && (
          <Button asChild variant="secondary">
            <a href={event.link_url} target="_blank" rel="noopener noreferrer">
              {t("openLink")}
            </a>
          </Button>
        )}
        {event.published && event.archived_at === null && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDownloadFailed(false);
              try {
                const calendar = globalEventCalendarFile(event, t("global"));
                saveBlob(
                  new Blob([calendar], { type: "text/calendar;charset=utf-8" }),
                  "luminovia-event.ics",
                );
              } catch {
                setDownloadFailed(true);
              }
            }}
          >
            {t("downloadEvent")}
          </Button>
        )}
      </div>
      {downloadFailed && <Notice kind="error">{t("downloadFailed")}</Notice>}
    </Dialog>
  );
}

export function GlobalEventManagement({
  actor,
  from,
  to,
  zone,
}: {
  actor: string;
  from: string;
  to: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("calendarPublications"),
    invitationText = useTranslation("calendarInvitations").t,
    online = useOnline(),
    client = useQueryClient();
  const [search, setSearch] = useState(""),
    [input, setInput] = useState(""),
    [editing, setEditing] = useState<GlobalEvent | null | undefined>(),
    [inviting, setInviting] = useState<GlobalEvent | null>(null),
    [denied, setDenied] = useState(false),
    [notice, setNotice] = useState(false);
  const records = useInfiniteQuery(
    globalEventsQuery(actor, from, to, true, search),
  );
  const lost =
    isDatabasePermissionDenied(records.error) ||
    isDatabasePermissionDenied(records.failureReason);
  if (!denied && lost) {
    setDenied(true);
    setEditing(undefined);
    setInviting(null);
  }
  const operation = useRequestKey();
  const change = useMutation({
    mutationFn: async ({
      event,
      action,
    }: {
      event: GlobalEvent;
      action: "publish" | "unpublish" | "archive" | "recover";
    }) => {
      const signature = JSON.stringify([event.id, event.version, action]);
      const operationId = operation.forInput(signature);
      return manageGlobalEvent(event.id, action, event.version, operationId);
    },
    onSuccess: async () => {
      await refreshGlobalEvents(client);
      setNotice(true);
      operation.clear();
    },
    onError: (e) => {
      if (isDatabasePermissionDenied(e)) {
        setEditing(undefined);
        setInviting(null);
        setDenied(true);
      }
    },
  });
  const refresh = async () => {
    const r = await records.refetch();
    if (r.isSuccess) setDenied(false);
  };
  if (denied || lost)
    return (
      <section className="panel">
        <Notice kind="error">{t("denied")}</Notice>
        <Button onClick={() => void refresh()} disabled={!online}>
          {t("reload")}
        </Button>
      </section>
    );
  const rows = [
    ...new Map(
      (records.data?.pages ?? []).flatMap((p) => p.items).map((e) => [e.id, e]),
    ).values(),
  ];
  return (
    <section className="panel global-event-management" aria-label={t("manage")}>
      <h2>{t("manage")}</h2>
      <p>{t("help")}</p>
      <p className="muted">{t("range")}</p>
      <div className="form-actions">
        <Button
          disabled={!online}
          onClick={() => {
            setEditing(null);
            setNotice(false);
          }}
        >
          {t("add")}
        </Button>
        <Button
          variant="secondary"
          disabled={!online || records.isFetching}
          onClick={() => void refresh()}
        >
          {t("reload")}
        </Button>
      </div>
      <form
        className="global-event-search"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(input);
        }}
      >
        <Field id="global-search" label={t("search")}>
          <input
            type="search"
            maxLength={160}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </Field>
        <Button variant="secondary">{t("search")}</Button>
      </form>
      {notice && <Notice>{t("saved")}</Notice>}
      {change.isError && <Notice kind="error">{t("error")}</Notice>}
      {records.isPending ? (
        <Loading />
      ) : records.isError ? (
        <ErrorState retry={() => void refresh()} />
      ) : (
        <>
          <p role="status">{t("loaded", { count: rows.length })}</p>
          {!rows.length && <p>{t("empty")}</p>}
          <div className="global-event-list">
            {rows.map((event) => (
              <article key={event.id}>
                <h3>{event.title}</h3>
                <p>
                  {dateTime(event.starts_at, i18n.language, event.time_zone)} ·{" "}
                  {event.time_zone}
                </p>
                <span className="badge">
                  {t(
                    event.archived_at
                      ? "archived"
                      : event.published
                        ? "published"
                        : "draft",
                  )}
                </span>
                <div className="form-actions">
                  {!event.archived_at && (
                    <Button
                      variant="secondary"
                      disabled={!online || change.isPending}
                      onClick={() => setEditing(event)}
                    >
                      {t("edit")}
                    </Button>
                  )}
                  {event.published &&
                    !event.archived_at &&
                    Date.parse(event.ends_at) > records.dataUpdatedAt && (
                      <Button
                        variant="secondary"
                        disabled={!online || change.isPending}
                        onClick={() => setInviting(event)}
                      >
                        {invitationText("manage")}
                      </Button>
                    )}
                  {(event.archived_at
                    ? ["recover"]
                    : event.published
                      ? ["unpublish", "archive"]
                      : ["publish", "archive"]
                  ).map((action) => (
                    <Button
                      key={action}
                      variant="ghost"
                      disabled={!online || change.isPending}
                      onClick={() => {
                        setNotice(false);
                        change.mutate({
                          event,
                          action: action as
                            "publish" | "unpublish" | "archive" | "recover",
                        });
                      }}
                    >
                      {t(action)}
                    </Button>
                  ))}
                </div>
              </article>
            ))}
          </div>
          {records.hasNextPage && (
            <Button
              disabled={!online || records.isFetchingNextPage}
              onClick={() => void records.fetchNextPage()}
            >
              {t("more")}
            </Button>
          )}
        </>
      )}
      {inviting && (
        <CalendarInvitationEditor
          actor={actor}
          event={inviting}
          onClose={() => setInviting(null)}
        />
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(v) => {
          if (!v) setEditing(undefined);
        }}
        title={t(editing ? "edit" : "add")}
        description={t("saveHint")}
      >
        <GlobalEventEditor
          key={editing?.id ?? "new"}
          event={editing ?? undefined}
          zone={zone}
          onDone={() => {
            setEditing(undefined);
            setNotice(true);
          }}
          onDenied={() => {
            setEditing(undefined);
            setDenied(true);
          }}
        />
      </Dialog>
    </section>
  );
}
