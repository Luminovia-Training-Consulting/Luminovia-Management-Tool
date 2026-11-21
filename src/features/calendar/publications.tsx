import { useRef, useState } from "react";
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
import {
  type GlobalEvent,
  type GlobalEventForm,
  globalEventFormSchema,
  globalEventPayload,
  globalEventsQuery,
  manageGlobalEvent,
  permissionDenied,
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
    key = useRef<{ signature: string; id: string } | null>(null);
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
      if (!key.current || key.current.signature !== signature)
        key.current = { signature, id: crypto.randomUUID() };
      return manageGlobalEvent(
        base?.id ?? null,
        "save",
        base?.version ?? 0,
        key.current.id,
        payload,
      );
    },
    onSuccess: async () => {
      await refreshGlobalEvents(client);
      onDone();
    },
    onError: (e) => {
      if (permissionDenied(e)) onDenied();
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
      {event.link_url && (
        <a href={event.link_url} target="_blank" rel="noopener noreferrer">
          {t("openLink")}
        </a>
      )}
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
    online = useOnline(),
    client = useQueryClient();
  const [search, setSearch] = useState(""),
    [input, setInput] = useState(""),
    [editing, setEditing] = useState<GlobalEvent | null | undefined>(),
    [denied, setDenied] = useState(false),
    [notice, setNotice] = useState(false);
  const records = useInfiniteQuery(
    globalEventsQuery(actor, from, to, true, search),
  );
  const lost =
    permissionDenied(records.error) || permissionDenied(records.failureReason);
  if (!denied && lost) {
    setDenied(true);
    setEditing(undefined);
  }
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const change = useMutation({
    mutationFn: async ({
      event,
      action,
    }: {
      event: GlobalEvent;
      action: "publish" | "unpublish" | "archive" | "recover";
    }) => {
      const signature = JSON.stringify([event.id, event.version, action]);
      if (!operation.current || operation.current.signature !== signature)
        operation.current = { signature, key: crypto.randomUUID() };
      return manageGlobalEvent(
        event.id,
        action,
        event.version,
        operation.current.key,
      );
    },
    onSuccess: async () => {
      await refreshGlobalEvents(client);
      setNotice(true);
      operation.current = null;
    },
    onError: (e) => {
      if (permissionDenied(e)) {
        setEditing(undefined);
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
