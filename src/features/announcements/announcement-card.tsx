import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { notificationKeys } from "../notifications/api";
import {
  acknowledgeAnnouncement,
  announcementKeys,
  type Announcement,
} from "./api";
import "./i18n";
import "./announcements.css";

/** One timer per bounded visible card, never a network poll or recurring tick. */
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
  const { t, i18n } = useTranslation("announcements");
  const online = useOnline();
  const client = useQueryClient();
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
