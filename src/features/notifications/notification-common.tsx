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
  type NotificationCategory,
} from "./categories";
import type { NotificationItem } from "./api";

/** Known notification kinds for translated labels; unknown kinds use the defined fallback. */
const knownKinds = new Set([
  "assignment_change",
  "claim_confirmed",
  "claim_cancelled",
  "assignment_withdrawal_requested",
  "assignment_withdrawal_approved",
  "assignment_withdrawal_rejected",
  "assignment_withdrawal_withdrawn",
  "job_reopened",
  "job_matching",
  "chat_message",
  "forum_reply",
  "session_reminder",
  "calendar_invitation",
  "contract_expiring",
  "contract_available",
  "support_update",
  "readiness_task",
  "website_enquiry",
  "replacement_available",
  "replacement_completed",
  "delivery_submitted",
  "delivery_confirmed",
  "delivery_disputed",
  "delivery_correction_requested",
  "delivery_customer_confirmed",
  "job_waitlist_available",
  "substitution_proposed",
  "substitution_closed",
  "task_assigned",
  "task_due",
  "timesheet_reviewed",
  "qualification_expiring",
  "course_preparation_updated",
  "course_question",
  "course_answer",
  "course_resource_shared",
  "course_quiz_published",
  "course_attendance_updated",
  "course_schedule_changed",
  "course_start_due",
  "course_start_escalated",
  "academy_course_enrolled",
  "course_completion_issued",
  "course_completion_revoked",
  "portal_announcement",
  "invoice_review_requested",
  "invoice_exception_available",
  "invoice_exception_revoked",
  "invoice_series_available",
  "invoice_series_revoked",
  "invoice_correction_proposed",
  "invoice_correction_acknowledged",
  "invoice_correction_disputed",
  "invoice_correction_withdrawn",
  "invoice_correction_repayment_recorded",
  "invoice_correction_repayment_voided",
  "invoice_submitted",
  "invoice_approved",
  "invoice_paid",
  "invoice_fully_credited",
  "invoice_rejected",
  "invoice_cancelled",
  "payment_received",
]);

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
export function NotificationRow({
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
      <strong>{t(knownKinds.has(item.kind) ? item.kind : "activity")}</strong>
      {item.title && <p>{item.title}</p>}
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
}
