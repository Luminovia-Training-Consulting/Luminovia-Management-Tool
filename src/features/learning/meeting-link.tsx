import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { courseWorkspaceKey, type CourseWorkspace } from "./api";
import { isMeetingUrl, maxMeetingUrlLength } from "./meeting-url";

type MeetingLink = NonNullable<CourseWorkspace["meeting_link"]>;

export function CourseMeetingLinkEditor({
  actor,
  courseId,
  current,
}: {
  actor: string;
  courseId: string;
  current: MeetingLink;
}) {
  const { t } = useTranslation("learning");
  const client = useQueryClient();
  const key = courseWorkspaceKey(actor, courseId);
  const [draft, setDraft] = useState<{ url: string; version: number } | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const save = useMutation({
    mutationFn: async (input: { url: string; version: number }) => {
      requireOnline();
      const { data, error } = await db().rpc("set_course_meeting_link", {
        p_run_id: courseId,
        p_url: input.url || null,
        p_expected_version: input.version,
      });
      if (error) throw error;
      return data as MeetingLink;
    },
    onSuccess: async (meetingLink) => {
      await client.cancelQueries({ queryKey: key });
      client.setQueryData<CourseWorkspace>(key, (workspace) =>
        workspace ? { ...workspace, meeting_link: meetingLink } : workspace,
      );
      setDraft(null);
      setConfirmed(true);
      void client.invalidateQueries({ queryKey: key });
    },
    onError: () => void client.invalidateQueries({ queryKey: key }),
  });
  const stale = draft !== null && draft.version !== current.version;
  const conflicting =
    stale ||
    (save.isError && (save.error as { code?: string }).code === "PT409");
  const invalid = !!draft?.url.trim() && !isMeetingUrl(draft.url.trim());
  return (
    <div className="course-meeting-link">
      {draft ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!invalid && !conflicting && !save.isPending) {
              save.mutate({ ...draft, url: draft.url.trim() });
            }
          }}
        >
          <Field
            id="course-meeting-link"
            label={t("meetingLinkLabel")}
            hint={t(invalid ? "meetingLinkInvalid" : "meetingLinkHint")}
          >
            <input
              id="course-meeting-link"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              maxLength={maxMeetingUrlLength}
              value={draft.url}
              disabled={save.isPending}
              onChange={(event) =>
                setDraft({ ...draft, url: event.target.value })
              }
            />
          </Field>
          {conflicting && (
            <Notice kind="error">{t("meetingLinkChanged")}</Notice>
          )}
          {save.isError && !conflicting && (
            <Notice kind="error">{t("saveError")}</Notice>
          )}
          <div className="form-actions">
            <Button
              type="submit"
              disabled={invalid || conflicting || save.isPending}
            >
              {t("meetingLinkPublish")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={save.isPending}
              onClick={() => setDraft(null)}
            >
              {t("meetingLinkCancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              save.reset();
              setConfirmed(false);
              setDraft({ url: current.url ?? "", version: current.version });
            }}
          >
            {t("meetingLinkEdit")}
          </Button>
          {confirmed && <Notice kind="success">{t("saved")}</Notice>}
        </div>
      )}
    </div>
  );
}
