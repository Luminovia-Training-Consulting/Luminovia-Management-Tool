import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useOnline } from "../../lib/online";
import { announcementsQuery } from "./api";
import { AnnouncementCard } from "./announcement-card";
import "./i18n";

export function AnnouncementBanners({ actor }: { actor: string }) {
  const { t } = useTranslation("announcements");
  const online = useOnline();
  const location = useLocation();
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
