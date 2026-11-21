/** Present one scanned attachment without looking up a general document record. */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { downloadPortalDocument } from "./api";
import "./course-chat-i18n";

/** Only the message-bound version and display fields are available to the UI. */
export type CourseChatFile = {
  version_id: string;
  name: string;
  size_bytes: number;
};

/** Download as the current member, or submit the explicit reason of an admin inspection. */
export function CourseChatAttachment({
  message,
  attachment,
  inspection,
}: {
  message: string;
  attachment: CourseChatFile;
  inspection?: { organisation_id: string; reason: string };
}) {
  const { t } = useTranslation("courseChat");
  const online = useOnline();
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => request.current?.abort(), []);

  async function download() {
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setFailed(false);
    try {
      await downloadPortalDocument(
        {
          kind: "course_chat_attachment",
          id: message,
          version_id: attachment.version_id,
          ...inspection,
        },
        attachment.name,
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={!online || busy}
        onClick={() => void download()}
      >
        {t("downloadAttachment", { name: attachment.name })}
      </Button>
      {failed && <Notice kind="error">{t("downloadFailed")}</Notice>}
    </>
  );
}
