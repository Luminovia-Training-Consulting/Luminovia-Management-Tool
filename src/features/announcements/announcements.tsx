import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "../auth/auth-context";
import { useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { notificationKeys } from "../notifications/api";
import {
  acknowledgeAnnouncement,
  announcementKeys,
  announcementQuery,
  announcementsQuery,
  type Announcement,
  type AnnouncementCursor,
} from "./api";
import "./i18n";
import "./announcements.css";

/** One timer per bounded visible card, never a network poll or a recurring tick. */
function useDisplayWindow(item: Announcement) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = [Date.parse(item.starts_at), Date.parse(item.ends_at)]
      .filter((time) => time > now)
      .sort((a, b) => a - b)[0];
    if (next === undefined) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(2147483647, Math.max(0, next - Date.now())),
    );
    return () => clearTimeout(timer);
  }, [item.starts_at, item.ends_at, now]);
  return Date.parse(item.starts_at) <= now && Date.parse(item.ends_at) > now;
}
export function AnnouncementCard({
  item,
  actor,
}: {
  item: Announcement;
  actor: string;
}) {
  const { t, i18n } = useTranslation("announcements"),
    online = useOnline(),
    client = useQueryClient();
  const visible = useDisplayWindow(item);
  const ack = useMutation({
    mutationFn: () => acknowledgeAnnouncement(item.id),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: announcementKeys.all(actor) }),
        client.invalidateQueries({ queryKey: notificationKeys.all(actor) }),
      ]),
    onError: (error) => {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "42501"
      )
        void client.invalidateQueries({
          queryKey: announcementKeys.all(actor),
        });
    },
  });
  const revoked =
    ack.error &&
    typeof ack.error === "object" &&
    "code" in ack.error &&
    ack.error.code === "42501";
  if (!visible || !online || revoked) return null;
  return (
    <article
      className="panel announcement-card"
      data-important={item.important}
      id={`announcement-${item.id}`}
    >
      <span className="badge">
        {t(item.important ? "important" : "information")}
      </span>
      <h2>{i18n.language === "de" ? item.title_de : item.title_en}</h2>
      <p className="announcement-body">
        {i18n.language === "de" ? item.body_de : item.body_en}
      </p>
      <footer>
        <small>
          {dateTime(item.starts_at, i18n.language, item.time_zone)} –{" "}
          {dateTime(item.ends_at, i18n.language, item.time_zone)} ·{" "}
          {item.time_zone}
        </small>
        <Button
          variant="secondary"
          disabled={!online || ack.isPending || Boolean(item.acknowledged_at)}
          onClick={() => ack.mutate()}
        >
          {t(item.acknowledged_at ? "acknowledged" : "acknowledge")}
        </Button>
      </footer>
      {ack.isError && !revoked && <Notice kind="error">{t("ackError")}</Notice>}
    </article>
  );
}
export function AnnouncementBanners({ actor }: { actor: string }) {
  const { t } = useTranslation("announcements"),
    online = useOnline(),
    location = useLocation();
  const enabled = online && location.pathname !== "/announcements";
  const query = useQuery({
    ...announcementsQuery(actor, "", null, true, 3),
    enabled,
    refetchInterval: enabled ? 30000 : false,
  });
  // Retained cache data is never rendered after an authorization/validation error.
  if (
    !enabled ||
    query.isPending ||
    query.isError ||
    !query.data?.items?.length
  )
    return null;
  return (
    <section className="announcement-stack" aria-label={t("title")}>
      {query.data.items.slice(0, 3).map((item) => (
        <AnnouncementCard key={item.id} actor={actor} item={item} />
      ))}
      <Link to="/announcements">{t("all")}</Link>
    </section>
  );
}
function SelectedRevision({ actor, id }: { actor: string; id: string }) {
  const { t } = useTranslation("announcements"),
    online = useOnline();
  const query = useQuery({ ...announcementQuery(actor, id), enabled: online });
  if (!online) return null;
  if (query.isPending) return <Loading />;
  if (query.isError) return <Notice kind="error">{t("unavailable")}</Notice>;
  return <AnnouncementCard item={query.data} actor={actor} />;
}
export function AnnouncementsPage() {
  const { t } = useTranslation("announcements"),
    actor = useAuth().session!.user.id,
    online = useOnline();
  const [params] = useSearchParams(),
    requested = params.get("revision"),
    selected =
      requested && z.string().uuid().safeParse(requested).success
        ? requested
        : null;
  const [draft, setDraft] = useState(""),
    [search, setSearch] = useState(""),
    [cursors, setCursors] = useState<(AnnouncementCursor | null)[]>([null]),
    [page, setPage] = useState(0);
  const query = useQuery({
    ...announcementsQuery(actor, search, cursors[page]),
    enabled: online,
  });
  return (
    <>
      <PageHeading title={t("title")} description={t("intro")} />
      <form
        className="panel announcement-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
          setCursors([null]);
          setPage(0);
        }}
      >
        <Field id="announcement-search" label={t("search")}>
          <input
            id="announcement-search"
            type="search"
            maxLength={160}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </Field>
        <Button disabled={!online}>{t("apply")}</Button>
      </form>
      {selected && <SelectedRevision actor={actor} id={selected} />}
      {!online ? (
        <Notice kind="error">{t("offline", { ns: "translation" })}</Notice>
      ) : query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          <div className="announcement-stack">
            {query.data.items
              .filter((item) => item.id !== selected)
              .map((item) => (
                <AnnouncementCard key={item.id} item={item} actor={actor} />
              ))}
          </div>
          {!query.data.items.length && !selected && (
            <Notice>{t("empty")}</Notice>
          )}
          <nav className="announcement-pagination" aria-label={t("title")}>
            <Button
              variant="secondary"
              disabled={page === 0 || query.isFetching}
              onClick={() => setPage(page - 1)}
            >
              {t("previous")}
            </Button>
            <Button
              variant="secondary"
              disabled={!query.data.next_cursor || query.isFetching}
              onClick={() => {
                const cursor = query.data.next_cursor;
                if (cursor) {
                  setCursors([...cursors.slice(0, page + 1), cursor]);
                  setPage(page + 1);
                }
              }}
            >
              {t("next")}
            </Button>
          </nav>
        </>
      )}
    </>
  );
}
