import { useTranslation } from "react-i18next";

/** Display verified teaching time separately from self-reported experience. */
export function LuminoviaTeachingTime({ minutes }: { minutes: number | null }) {
  const { t, i18n } = useTranslation("people");
  if (minutes == null) return null;

  return (
    <p>
      <strong>{t("luminoviaTeachingHours")}</strong>{" "}
      {t("hoursValue", {
        value: new Intl.NumberFormat(i18n.language, {
          maximumFractionDigits: 2,
        }).format(minutes / 60),
      })}
    </p>
  );
}
