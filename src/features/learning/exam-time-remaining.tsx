/** Presents the learner's effective exam deadline using the caller's clock. */
import { useTranslation } from "react-i18next";

export function ExamTimeRemaining({
  deadline,
  now,
}: {
  deadline: string;
  now: number;
}) {
  const { t, i18n } = useTranslation();
  const minutes = Math.ceil((Date.parse(deadline) - now) / 60_000);
  if (!(minutes > 0)) return null;

  const duration = new Intl.NumberFormat(i18n.language, {
    style: "unit",
    unit: "minute",
    unitDisplay: "long",
  }).format(minutes);

  return <p role="timer">{t("examTimeRemaining", { duration })}</p>;
}
