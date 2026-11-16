// Pass only the source message ID. The server enforces an own private task and
// current room membership; no message body is copied into the task draft.
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import "./i18n";
export function TaskFromMessageAction({ messageId }: { messageId: string }) {
  const { t } = useTranslation("workbench");
  return (
    <Link to={`/workbench?message=${messageId}`}>{t("taskFromMessage")}</Link>
  );
}
