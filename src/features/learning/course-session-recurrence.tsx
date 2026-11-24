import { useState } from "react";
import { useTranslation } from "react-i18next";
import { RecurrenceFields } from "../../components/recurrence-fields";
import type { LocalScheduleEntry, RecurrenceRule } from "../../lib/recurrence";
import "./i18n";

/** Add repeats of the final editable row, preserving the source and all other rows. */
export function CourseSessionRecurrence({
  anchor,
  zone,
  sessionCount,
  onAppend,
  disabled,
}: {
  anchor: LocalScheduleEntry;
  zone: string;
  sessionCount: number;
  onAppend: (sessions: LocalScheduleEntry[]) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("learning");
  const [rule, setRule] = useState<RecurrenceRule | null>(null);
  if (sessionCount >= 60) return null;
  return (
    <div>
      <p className="muted">{t("courseSessionRecurrenceHint")}</p>
      <RecurrenceFields
        anchor={anchor}
        zone={zone.trim()}
        value={rule}
        onChange={setRule}
        max={61 - sessionCount}
        disabled={disabled}
        onApply={(entries) => {
          const repeats = entries.slice(1);
          if (!repeats.length) return;
          onAppend(repeats);
          setRule(null);
        }}
      />
    </div>
  );
}
