/** Calendar controls share the Portal button design and native keyboard behaviour. */
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { calendarViews, type CalendarView } from "./views";
export function CalendarToolbar({
  title,
  view,
  onNavigate,
  onView,
}: {
  title: string;
  view: CalendarView;
  onNavigate: (direction: "prev" | "next" | "today") => void;
  onView: (view: CalendarView) => void;
}) {
  const { t } = useTranslation("calendarFilter");
  return (
    <div className="calendar-toolbar">
      <div
        className="calendar-date-navigation"
        role="group"
        aria-label={t("navigation")}
      >
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={t("previous")}
          title={t("previous")}
          onClick={() => onNavigate("prev")}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onNavigate("today")}
        >
          <CalendarDays size={18} aria-hidden="true" />
          {t("today")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          aria-label={t("next")}
          title={t("next")}
          onClick={() => onNavigate("next")}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <h2
        className="calendar-range-title"
        aria-live="polite"
        aria-atomic="true"
      >
        {title}
      </h2>
      <div
        className="calendar-view-switcher"
        role="group"
        aria-label={t("view")}
      >
        {calendarViews.map((kind) => (
          <Button
            key={kind}
            type="button"
            variant="ghost"
            aria-pressed={view === kind}
            onClick={() => onView(kind)}
          >
            {t(kind)}
          </Button>
        ))}
      </div>
    </div>
  );
}
