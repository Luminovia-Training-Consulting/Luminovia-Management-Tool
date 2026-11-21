import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import { db } from "../../lib/supabase";

type Page = {
  items: {
    id: string;
    created_at: string;
    sender_name: string;
    room_title: string | null;
    body: string;
  }[];
  next_cursor: { at: string; id: string } | null;
};

export function AuditedCourseChat({
  organisation,
  course,
  zone,
}: {
  organisation: string;
  course: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("operations");
  const online = useOnline();
  const id = useId();
  const [reason, setReason] = useState("");
  const [accepted, setAccepted] = useState("");
  const [page, setPage] = useState<Page>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function inspect(purpose: string, before: Page["next_cursor"] = null) {
    setBusy(true);
    setFailed(false);
    setPage(undefined);
    try {
      requireOnline();
      const { data, error } = await db().rpc("inspect_company_course_chat", {
        p_organisation_id: organisation,
        p_run_id: course,
        p_reason: purpose,
        p_before_at: before?.at ?? null,
        p_before_id: before?.id ?? null,
      });
      if (error || !Array.isArray(data?.items))
        throw new Error("inspection_unconfirmed");
      setAccepted(purpose);
      setPage(data);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="retained-chat-inspection">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void inspect(reason.trim());
        }}
      >
        <Field id={id} label={t("inspectCourseChatReason")}>
          <input
            id={id}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
            minLength={8}
            maxLength={300}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={!online || busy || reason.trim().length < 8}
        >
          {t(busy ? "loading" : "inspectCourseChat")}
        </Button>
      </form>
      {failed && <Notice kind="error">{t("premiumFailed")}</Notice>}
      {page &&
        (page.items.length ? (
          <>
            <ol className="course-chat-messages">
              {page.items.map((message) => (
                <li key={message.id}>
                  <strong>{message.sender_name}</strong>{" "}
                  <time dateTime={message.created_at}>
                    {dateTime(message.created_at, i18n.language, zone)}
                  </time>
                  {message.room_title && (
                    <p className="muted">{message.room_title}</p>
                  )}
                  <p className="preserve-text">{message.body}</p>
                </li>
              ))}
            </ol>
            {page.next_cursor && (
              <Button
                type="button"
                variant="secondary"
                disabled={!online || busy}
                onClick={() => void inspect(accepted, page.next_cursor)}
              >
                {t("inspectCourseChatOlder")}
              </Button>
            )}
          </>
        ) : (
          <p>{t("inspectCourseChatEmpty")}</p>
        ))}
    </div>
  );
}
