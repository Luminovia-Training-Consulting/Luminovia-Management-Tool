import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { ErrorState, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { notificationCategory, type NotificationCategory } from "./categories";
import { notificationPreviewQuery } from "./api";
import { CategorySelector, NotificationRow } from "./notification-common";
import { useReadState } from "./use-notification-read-state";
import "./i18n";
import "./notifications.css";
import "./attention-i18n";

/** Observe the bounded own preview and expose the shared bell/unread state. */
export function NotificationsMenu({ id, zone }: { id: string; zone: string }) {
  const { t } = useTranslation("inbox");
  const [category, setCategory] = useState<NotificationCategory>("all");
  const online = useOnline();
  const query = useQuery(notificationPreviewQuery(id));
  const mark = useReadState(id);
  const { t: attentionText } = useTranslation("attention");
  const count = query.isError
    ? 0
    : (query.data?.attention_count ?? query.data?.unread_count ?? 0);
  const quiet = !query.isError && query.data?.quiet_active;
  const countLabel = query.isError
    ? t("unavailable")
    : quiet
      ? `${attentionText("criticalCount", { count })}; ${attentionText("active")}; ${attentionText("totalCount", { count: query.data?.unread_count ?? 0 })}`
      : t("count", { count });
  const menu = useRef<HTMLDetailsElement>(null);
  const location = useLocation();
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [location.pathname, location.search]);
  return (
    <details className="notification-menu" ref={menu}>
      <summary aria-label={`${t("title")}: ${countLabel}`}>
        <Bell aria-hidden="true" size={21} />
        {count > 0 && (
          <span className="notification-count" aria-hidden="true">
            {count}
          </span>
        )}
      </summary>
      <div className="notification-popover">
        <h2>{t("title")}</h2>
        <CategorySelector value={category} onChange={setCategory} />
        <p className="notification-filter-scope">{t("recentScope")}</p>
        {query.isPending ? (
          <Loading />
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : !query.data.items.some(
            (item) =>
              category === "all" ||
              notificationCategory(item.kind) === category,
          ) ? (
          <p>{t(category === "all" ? "empty" : "categoryEmpty")}</p>
        ) : (
          <ul>
            {query.data.items
              .filter(
                (item) =>
                  category === "all" ||
                  notificationCategory(item.kind) === category,
              )
              .map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  zone={zone}
                  compact
                  disabled={!online || mark.isPending}
                  mark={(id, read) =>
                    mark.mutate({ ids: [id], before: null, read })
                  }
                />
              ))}
          </ul>
        )}
        {mark.isError && <Notice kind="error">{t("error")}</Notice>}
        <Link to="/notifications">{t("inbox")}</Link>
      </div>
    </details>
  );
}
