import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { notificationKeys } from "../notifications/api";
import {
  invitationConflict,
  invitationRecipientsQuery,
  invitationRosterQuery,
  invitationsKey,
  ownInvitationsQuery,
  replyCalendarInvitation,
  setCalendarInvitation,
} from "./invitations-api";
import { calendarRecipientCode, calendarResponse } from "./invitations-schema";
import type { GlobalEvent } from "./publications-schema";
import "./invitations-i18n";

export function CalendarInvitationOverview({ actor }: { actor: string }) {
  const { t, i18n } = useTranslation("calendarInvitations");
  const online = useOnline();
  const client = useQueryClient();
  const { hash, search } = useLocation();
  const params = new URLSearchParams(search);
  const requested = z.uuid().safeParse(params.get("invitation"));
  const eventId = requested.success ? requested.data : null;
  const direct = eventId !== null || hash === "#calendar-invitations";
  params.delete("invitation");
  const invitations = useInfiniteQuery({
    ...ownInvitationsQuery(actor, eventId),
    enabled: online,
  });
  const reply = useMutation({
    mutationFn: (values: Parameters<typeof replyCalendarInvitation>) =>
      replyCalendarInvitation(...values),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: notificationKeys.all(actor) });
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: invitationsKey(actor) }),
  });
  const rows = [
    ...new Map(
      invitations.data?.pages.flatMap((page) =>
        page.items.map((event) => [event.event_id, event]),
      ),
    ).values(),
  ];

  if (rows.length === 0 && !invitations.isError && !direct) return null;

  return (
    <details
      className="panel global-event-management"
      id="calendar-invitations"
      open={direct || undefined}
    >
      <summary>{t("invitations")}</summary>
      {!online ? (
        <Notice>{t("offline")}</Notice>
      ) : invitations.isError ? (
        <ErrorState retry={() => void invitations.refetch()} />
      ) : invitations.isPending ? (
        <Loading />
      ) : (
        <div className="global-event-list">
          {eventId && (
            <Button asChild variant="secondary">
              <Link
                to={{
                  search: params.toString(),
                  hash: "#calendar-invitations",
                }}
              >
                {t("showAll")}
              </Link>
            </Button>
          )}
          {rows.length === 0 && (
            <p>{t(eventId ? "invitationUnavailable" : "noInvitations")}</p>
          )}
          {rows.map((event) => (
            <article key={event.event_id}>
              <h3>{event.title}</h3>
              <p>
                {dateTime(event.starts_at, i18n.language, event.time_zone)} –{" "}
                {dateTime(event.ends_at, i18n.language, event.time_zone)} ·{" "}
                {event.time_zone}
              </p>
              <p>{t(event.response)}</p>
              <div
                className="form-actions"
                role="group"
                aria-label={event.title}
              >
                {calendarResponse.options.map((response) => (
                  <Button
                    key={response}
                    variant="secondary"
                    aria-pressed={event.response === response}
                    disabled={reply.isPending || event.response === response}
                    onClick={() =>
                      reply.mutate([
                        event.event_id,
                        event.event_version,
                        event.revision,
                        response,
                      ])
                    }
                  >
                    {t(`respond_${response}`)}
                  </Button>
                ))}
              </div>
            </article>
          ))}
          {invitations.hasNextPage && (
            <Button
              variant="secondary"
              disabled={invitations.isFetchingNextPage}
              onClick={() => void invitations.fetchNextPage()}
            >
              {t("more")}
            </Button>
          )}
        </div>
      )}
      {online && reply.isSuccess && <Notice>{t("responseSaved")}</Notice>}
      {online && reply.isError && (
        <Notice kind="error">
          {t(invitationConflict(reply.error) ? "conflict" : "error")}
        </Notice>
      )}
    </details>
  );
}

export function CalendarInvitationEditor({
  actor,
  event,
  onClose,
}: {
  actor: string;
  event: GlobalEvent;
  onClose: () => void;
}) {
  const { t } = useTranslation("calendarInvitations");
  const online = useOnline();
  const client = useQueryClient();
  const [input, setInput] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [invalid, setInvalid] = useState(false);
  const roster = useQuery({
    ...invitationRosterQuery(actor, event.id, event.version),
    enabled: online,
  });
  const recipients = useQuery({
    ...invitationRecipientsQuery(actor, event.id, event.version, search),
    enabled: online && search.length >= 2 && roster.isSuccess,
  });
  const change = useMutation({
    mutationFn: (values: {
      code: string;
      revision: number;
      invited: boolean;
    }) =>
      setCalendarInvitation(
        event.id,
        event.version,
        values.code,
        values.revision,
        values.invited,
      ),
    onSuccess: (_, values) => {
      if (values.invited) setInput("");
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: invitationsKey(actor) }),
  });
  const ready = online && roster.isSuccess && !change.isPending;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !change.isPending) onClose();
      }}
      title={t("manage")}
      description={t("description")}
    >
      <h3>{event.title}</h3>
      <p className="muted">{t("versionHelp")}</p>
      {!online ? (
        <Notice>{t("offline")}</Notice>
      ) : roster.isError ? (
        <ErrorState retry={() => void roster.refetch()} />
      ) : roster.isPending ? (
        <Loading />
      ) : (
        <>
          <form
            className="global-event-search"
            onSubmit={(submit) => {
              submit.preventDefault();
              setSearch(searchInput.trim());
            }}
          >
            <Field id="calendar-invitation-search" label={t("searchName")}>
              <input
                type="search"
                value={searchInput}
                maxLength={120}
                onChange={(change) => setSearchInput(change.target.value)}
              />
            </Field>
            <Button disabled={!ready || searchInput.trim().length < 2}>
              {t("search")}
            </Button>
          </form>
          {search && recipients.isPending && <Loading />}
          {search && recipients.isError && (
            <ErrorState retry={() => void recipients.refetch()} />
          )}
          {recipients.data?.length === 0 && (
            <p role="status">{t("noMatches")}</p>
          )}
          {Boolean(recipients.data?.length) && (
            <div className="global-event-list">
              {recipients.data?.map((candidate) => (
                <article key={candidate.user_code}>
                  <h3>{candidate.name}</h3>
                  <p>{candidate.user_code}</p>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!ready || recipients.isFetching}
                    aria-label={t("invitePerson", { name: candidate.name })}
                    onClick={() =>
                      change.mutate({
                        code: candidate.user_code,
                        revision: candidate.revision,
                        invited: true,
                      })
                    }
                  >
                    {t("invite")}
                  </Button>
                </article>
              ))}
            </div>
          )}
          <form
            className="global-event-search"
            onSubmit={(submit) => {
              submit.preventDefault();
              if (!ready) return;
              const code = calendarRecipientCode.safeParse(
                input.trim().toUpperCase(),
              );
              setInvalid(!code.success);
              if (!code.success) return;
              const previous = roster.data.find(
                (row) => row.user_code === code.data,
              );
              change.mutate({
                code: code.data,
                revision: previous?.revision ?? 0,
                invited: true,
              });
            }}
          >
            <Field
              id="calendar-invitation-recipient"
              label={t("recipient")}
              error={invalid}
            >
              <input
                value={input}
                maxLength={28}
                autoComplete="off"
                spellCheck={false}
                placeholder="LV-0000-0000-0000-0000-0000"
                onChange={(change) => {
                  setInput(change.target.value);
                  setInvalid(false);
                }}
              />
            </Field>
            <Button disabled={!ready || !input.trim()}>{t("invite")}</Button>
          </form>
          {invalid && <Notice kind="error">{t("invalid")}</Notice>}
          <div className="global-event-list">
            {roster.data.map((row) => (
              <article key={row.user_code}>
                <h3>{row.name}</h3>
                <p>{t(row.withdrawn ? "revoked" : row.response)}</p>
                {!row.withdrawn && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!ready}
                    onClick={() => {
                      setInvalid(false);
                      change.mutate({
                        code: row.user_code,
                        revision: row.revision,
                        invited: false,
                      });
                    }}
                  >
                    {t("withdraw")}
                  </Button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {online && change.isSuccess && (
        <Notice>
          {t(change.variables.invited ? "inviteSent" : "withdrawn")}
        </Notice>
      )}
      {online && change.isError && (
        <Notice kind="error">
          {t(invitationConflict(change.error) ? "conflict" : "error")}
        </Notice>
      )}
    </Dialog>
  );
}
