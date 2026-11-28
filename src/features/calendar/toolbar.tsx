/** Calendar controls share the Portal button design and native keyboard behaviour. */
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { type CalendarView, calendarViews } from "./views";

/** Navigate the mounted grid without remounting, including a local calendar-date jump. */
export function CalendarToolbar({
  title,
  view,
  onNavigate,
  onView,
  getDate,
  onGoToDate,
  waitingForDate,
}: {
  title: string;
  view: CalendarView;
  onNavigate: (direction: "prev" | "next" | "today") => void;
  onView: (view: CalendarView) => void;
  getDate: () => string | undefined;
  onGoToDate: (date: string) => void;
  waitingForDate?: boolean;
}) {
  const { t } = useTranslation("calendarFilter");
  const [jumpDate, setJumpDate] = useState<string | null>(null);
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
          disabled={waitingForDate}
          onClick={() => onNavigate("prev")}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={waitingForDate}
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
          disabled={waitingForDate}
          onClick={() => onNavigate("next")}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <div className="calendar-range">
        <h2
          className="calendar-range-title"
          aria-live="polite"
          aria-atomic="true"
        >
          {title}
        </h2>
        <Button
          type="button"
          variant="ghost"
          aria-haspopup="dialog"
          disabled={waitingForDate}
          onClick={() => setJumpDate(getDate() ?? "")}
        >
          {t("chooseDate")}
        </Button>
      </div>
      <Dialog
        open={jumpDate !== null}
        onOpenChange={(open) => {
          if (!open) setJumpDate(null);
        }}
        title={t("chooseDate")}
        description={t("jumpDateHelp")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!jumpDate) return;
            onGoToDate(jumpDate);
            setJumpDate(null);
          }}
        >
          <Field id="calendar-jump-date" label={t("date")}>
            <input
              id="calendar-jump-date"
              type="date"
              value={jumpDate ?? ""}
              onChange={(event) => setJumpDate(event.currentTarget.value)}
              required
            />
          </Field>
          <Button type="submit">{t("goToDate")}</Button>
        </form>
      </Dialog>
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
            disabled={waitingForDate}
            onClick={() => onView(kind)}
          >
            {t(kind)}
          </Button>
        ))}
      </div>
    </div>
  );
}
