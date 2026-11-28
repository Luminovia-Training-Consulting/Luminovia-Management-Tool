import { useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { useDismissibleDisclosure } from "../../components/use-dismissible-disclosure";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { notificationCategory, type NotificationCategory } from "./categories";
import { notificationPreviewQuery } from "./api";
import { CategorySelector, NotificationRow } from "./notification-common";
import { useReadState } from "./use-notification-read-state";
import "./i18n";
import "./notifications.css";
import "./attention-i18n";

/** Observe the bounded own preview and expose the shared bell/unread state. */
export function NotificationsMenu({
  id,
  zone,
  academy,
}: {
  id: string;
  zone: string;
  academy?: "active" | "grace";
}) {
  const { t } = useTranslation("inbox");
  const [category, setCategory] = useState<NotificationCategory>("all");
  const filterId = useId();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const query = useQuery({
    ...notificationPreviewQuery(id),
    ...(academy && {
      enabled: online,
      staleTime: 0,
      refetchOnMount: "always",
      refetchInterval: 10_000,
    }),
  });
  const mark = useReadState(id);
  const { t: attentionText } = useTranslation("attention");
  const awaitingAcademy = Boolean(
    academy && (!online || (query.isFetching && !query.isFetchedAfterMount)),
  );
  const count =
    query.isError || awaitingAcademy
      ? 0
      : (query.data?.attention_count ?? query.data?.unread_count ?? 0);
  const quiet = !query.isError && !awaitingAcademy && query.data?.quiet_active;
  const countLabel =
    query.isError || awaitingAcademy
      ? t("unavailable")
      : quiet
        ? `${attentionText("criticalCount", { count })}; ${attentionText("active")}; ${attentionText("totalCount", { count: query.data?.unread_count ?? 0 })}`
        : t("count", { count });
  const { attributes: disclosure } = useDismissibleDisclosure(
    useLocation().key,
  );
  const page =
    open && !query.isError && !awaitingAcademy ? query.data : undefined;
  const items =
    page?.items.filter(
      (item) =>
        (!unreadOnly || !item.read_at) &&
        (category === "all" || notificationCategory(item.kind) === category),
    ) ?? [];
  const filteredUnread = items
    .filter((item) => !item.read_at)
    .map((item) => item.id);
  return (
    <details
      className={`notification-menu${academy ? " academy-notification-menu" : ""}`}
      {...disclosure}
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary aria-label={`${t("title")}: ${countLabel}`}>
        <Bell aria-hidden="true" size={21} />
        {count > 0 && (
          <span className="notification-count" aria-hidden="true">
            {count}
          </span>
        )}
      </summary>
      {open && (
        <div className="notification-popover">
          <div className="notification-popover-heading">
            <h2>{t("title")}</h2>
            <Link to="/notifications">{t("inbox")}</Link>
          </div>
          {!academy && Boolean(page?.items.length) && (
            <>
              <CategorySelector value={category} onChange={setCategory} />
              <p className="notification-filter-scope">{t("recentScope")}</p>
            </>
          )}
          {Boolean(page?.items.length) && (
            <Field
              id={`notification-preview-filter-${filterId}`}
              label={t("readFilter")}
            >
              <select
                value={unreadOnly ? "unread" : "all"}
                onChange={(event) =>
                  setUnreadOnly(event.target.value === "unread")
                }
              >
                <option value="all">{t("all")}</option>
                <option value="unread">{t("unread")}</option>
              </select>
            </Field>
          )}
          {academy && unreadOnly && (
            <p className="notification-filter-scope">{t("recentScope")}</p>
          )}
          {page && page.unread_count > 0 && academy !== "grace" && (
            <Button
              variant="secondary"
              disabled={
                !online ||
                mark.isPending ||
                (category === "all"
                  ? !page.unread_count
                  : !filteredUnread.length)
              }
              onClick={() =>
                mark.mutate(
                  category === "all"
                    ? { ids: null, before: page.as_of, read: true }
                    : { ids: filteredUnread, before: null, read: true },
                )
              }
            >
              {t(category === "all" ? "markAll" : "markCategoryVisible")}
            </Button>
          )}
          {academy && !online ? (
            <Notice>{t("offlineInbox")}</Notice>
          ) : query.isPending || awaitingAcademy ? (
            <Loading />
          ) : query.isError ? (
            <ErrorState retry={() => void query.refetch()} />
          ) : items.length === 0 ? (
            <p>
              {t(
                unreadOnly
                  ? "recentUnreadEmpty"
                  : category === "all"
                    ? "empty"
                    : "categoryEmpty",
              )}
            </p>
          ) : (
            <ul>
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  zone={zone}
                  compact
                  disabled={!online || mark.isPending}
                  readOnly={academy === "grace"}
                  mark={(id, read) =>
                    mark.mutate({ ids: [id], before: null, read })
                  }
                />
              ))}
            </ul>
          )}
          {mark.isError && <Notice kind="error">{t("error")}</Notice>}
        </div>
      )}
    </details>
  );
}
