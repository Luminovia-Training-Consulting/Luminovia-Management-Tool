import { memo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Bell,
  CalendarDays,
  LifeBuoy,
  ListChecks,
  MessagesSquare,
  Wallet,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import {
  notificationCategories,
  notificationCategory,
  type NotificationCategory,
} from "./categories";
import type { NotificationItem } from "./api";

/** Categories filter only already-loaded authorized rows; neither totals nor server cursors change. */
export function CategorySelector({
  value,
  onChange,
}: {
  value: NotificationCategory;
  onChange: (value: NotificationCategory) => void;
}) {
  const { t } = useTranslation("inbox");
  const icons = {
    all: Bell,
    messages: MessagesSquare,
    courses: CalendarDays,
    tasks: ListChecks,
    finance: Wallet,
    support: LifeBuoy,
  };
  return (
    <div
      className="notification-category-selector"
      role="group"
      aria-label={t("categoryFilter")}
    >
      {notificationCategories.map((category) => {
        const Icon = icons[category];
        return (
          <Button
            key={category}
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={category === value}
            onClick={() => onChange(category)}
          >
            <Icon size={16} aria-hidden="true" />
            <span>{t(`category_${category}`)}</span>
          </Button>
        );
      })}
    </div>
  );
}

/** Display validated internal destinations and bind each notification to its read action. */
export const NotificationRow = memo(function NotificationRow({
  item,
  zone,
  compact,
  disabled,
  readOnly,
  mark,
}: {
  item: NotificationItem;
  zone: string;
  compact?: boolean;
  disabled: boolean;
  readOnly?: boolean;
  mark: (id: string, read: boolean) => void;
}) {
  const { t, i18n } = useTranslation("inbox");
  return (
    <li
      className={`notification-row ${item.read_at ? "" : "notification-unread"}`}
    >
      <strong>
        {t(
          item.assignment_removed
            ? "lecturerRemoved"
            : item.assignment_replaced
              ? "lecturerReplaced"
              : notificationCategory(item.kind) !== "other"
                ? item.kind
                : "activity",
        )}
      </strong>
      {item.title && <p>{item.title}</p>}
      {item.removal_reason && <p>{item.removal_reason}</p>}
      <small>{dateTime(item.created_at, i18n.language, zone)}</small>
      {item.href ? (
        <Link to={item.href}>{t("open")}</Link>
      ) : (
        !compact && <p className="muted">{t("unavailable")}</p>
      )}
      {!readOnly && (!compact || !item.read_at) && (
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          onClick={() => mark(item.id, !item.read_at)}
        >
          {t(item.read_at ? "markUnread" : "markRead")}
        </Button>
      )}
    </li>
  );
});
