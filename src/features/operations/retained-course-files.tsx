import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { downloadPortalDocument } from "../learning/api";
import {
  retainedCourseFilesSchema,
  type RetainedCourseFiles,
} from "./company-premium-schema";

export function RetainedCourseFilesPanel({
  organisation,
  course,
}: {
  organisation: string;
  course: string;
}) {
  const { t } = useTranslation("operations");
  const online = useOnline();
  const reasonId = useId();
  const titleId = useId();
  const [reason, setReason] = useState("");
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => download.current?.abort(), []);

  const purpose = reason.trim();
  const inspection = useMutation({
    gcTime: 0,
    mutationFn: async (cursor: RetainedCourseFiles["next_cursor"]) => {
      requireOnline();
      const { data, error } = await db().rpc("inspect_retained_course_files", {
        p_organisation_id: organisation,
        p_run_id: course,
        p_reason: purpose,
        p_after_kind: cursor?.file_kind ?? null,
        p_after_id: cursor?.id ?? null,
      });
      if (error) throw error;
      return retainedCourseFilesSchema.parse(data);
    },
  });
  const page = online ? inspection.data : undefined;
  const busy = inspection.isPending || downloadId !== null;

  async function downloadFile(item: RetainedCourseFiles["items"][number]) {
    if (!online || busy || download.current) return;
    const controller = new AbortController();
    download.current = controller;
    setDownloadId(item.id);
    setDownloadFailed(false);
    try {
      await downloadPortalDocument(
        {
          kind: "retained_course_file",
          organisation_id: organisation,
          run_id: course,
          file_kind: item.file_kind,
          id: item.id,
          version_id: item.version_id,
          reason: purpose,
        },
        item.name,
        controller.signal,
      );
    } catch {
      if (!controller.signal.aborted) setDownloadFailed(true);
    } finally {
      download.current = null;
      if (!controller.signal.aborted) setDownloadId(null);
    }
  }

  return (
    <section aria-labelledby={titleId}>
      <h4 id={titleId}>{t("retainedFilesTitle")}</h4>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (online && purpose.length >= 8 && !busy) {
            setDownloadFailed(false);
            inspection.mutate(null);
          }
        }}
      >
        <Field id={reasonId} label={t("retainedFilesReason")}>
          <input
            id={reasonId}
            value={reason}
            required
            minLength={8}
            maxLength={300}
            disabled={busy}
            onChange={(event) => {
              setReason(event.currentTarget.value);
              setDownloadFailed(false);
              inspection.reset();
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={!online || purpose.length < 8 || busy}
        >
          {t(inspection.isPending ? "loading" : "inspectRetainedFiles")}
        </Button>
      </form>
      {inspection.isError && <Notice kind="error">{t("premiumFailed")}</Notice>}
      {downloadFailed && (
        <Notice kind="error">{t("downloadRetainedFileFailed")}</Notice>
      )}
      {page && (
        <>
          {page.items.length === 0 ? (
            <p>{t("retainedFilesEmpty")}</p>
          ) : (
            <ul className="course-chat-messages">
              {page.items.map((item) => (
                <li key={`${item.file_kind}:${item.id}`}>
                  <p>
                    <strong>{item.name}</strong>
                  </p>
                  <p>
                    {t(`retainedFileKind.${item.file_kind}`)} ·{" "}
                    {t("retainedFileVersion", { version: item.version })} ·{" "}
                    {t(`retainedFileAudience.${item.audience}`)}
                  </p>
                  {item.withdrawn && <p>{t("retainedFileWithdrawn")}</p>}
                  <Button
                    type="button"
                    variant="secondary"
                    aria-label={t("downloadRetainedFile", { name: item.name })}
                    disabled={busy}
                    onClick={() => void downloadFile(item)}
                  >
                    {t(
                      downloadId === item.id
                        ? "loading"
                        : "retainedFileDownload",
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {page.next_cursor && (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDownloadFailed(false);
                inspection.mutate(page.next_cursor);
              }}
            >
              {t("retainedFilesNext")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}
