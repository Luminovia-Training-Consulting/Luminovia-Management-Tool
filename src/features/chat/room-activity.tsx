/** Display only the already-authorized last message instant in the reader's profile zone. */
import { useTranslation } from "react-i18next";
import i18n from "../../lib/i18n";
for (const [language, value] of [
  ["de", "Letzte Nachricht"],
  ["en", "Last message"],
] as const)
  i18n.addResourceBundle(
    language,
    "chatActivity",
    { lastMessage: value },
    true,
    true,
  );
export function RoomActivity({
  instant,
  zone,
}: {
  instant: string | null;
  zone?: string;
}) {
  const { t, i18n } = useTranslation("chatActivity");
  if (!instant || !zone) return null;
  let text: string;
  try {
    text = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date(instant));
  } catch {
    // Do not replace an unknown timestamp or unconfirmed zone with a misleading value.
    return null;
  }
  return (
    <small>
      {t("lastMessage")}: <time dateTime={instant}>{text}</time>
    </small>
  );
}
