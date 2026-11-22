/** Private learner files stay apart from material published to the whole course. */
import { type MouseEvent, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { acceptedFiles, uploadCourseSubmission } from "../files/api";
import { downloadPortalDocument } from "./api";
import {
  courseSubmissionPage,
  type CourseSubmissionEntry,
} from "./course-submission-schema";

function SubmissionRow({
  entry,
  courseId,
  withdraw,
  disabled,
}: {
  entry: CourseSubmissionEntry;
  courseId: string;
  withdraw: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled: boolean;
}) {
  const { t, i18n } = useTranslation("learning");
  const download = useMutation({
    mutationFn: () =>
      downloadPortalDocument(
        {
          kind: "participant_submission",
          id: courseId,
          version_id: entry.version_id,
        },
        entry.name,
      ),
  });
  return (
    <li className="min-w-0 space-y-2 py-3">
      <div className="font-medium [overflow-wrap:anywhere]">{entry.name}</div>
      <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
        {[
          entry.participant,
          new Intl.DateTimeFormat(i18n.language, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(new Date(entry.submitted_at)),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          aria-label={t("submissionDownload", { name: entry.name })}
          disabled={disabled || download.isPending}
          onClick={() => download.mutate()}
        >
          {t("download")}
        </Button>
        {entry.can_withdraw && (
          <Button
            variant="secondary"
            aria-label={t("submissionWithdrawFile", { name: entry.name })}
            disabled={disabled}
            onClick={withdraw}
          >
            {t("submissionWithdraw")}
          </Button>
        )}
      </div>
      {download.isError && <Notice kind="error">{t("downloadError")}</Notice>}
    </li>
  );
}

export function CourseSubmissions({
  actor,
  courseId,
  readOnly = false,
}: {
  actor: string;
  courseId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const input = useId();
  const key = ["course-submissions", actor, courseId];
  const [cursors, setCursors] = useState<string[]>([]);
  const [file, setFile] = useState<{ bytes: File; clientId: string } | null>(
    null,
  );
  const [fileInputKey, setFileInputKey] = useState(0);
  const [confirm, setConfirm] = useState<{
    entry: CourseSubmissionEntry;
    trigger: HTMLButtonElement;
  } | null>(null);
  const cursor = cursors.at(-1) ?? null;
  const list = useQuery({
    queryKey: [...key, cursor],
    enabled: online,
    gcTime: 0,
    retry: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("course_submissions", {
        p_run_id: courseId,
        p_after: cursor,
      });
      if (error) throw error;
      return courseSubmissionPage.parse(data);
    },
  });
  const refresh = () => cache.invalidateQueries({ queryKey: key });
  const settings = useMutation({
    mutationFn: async (enabled: boolean) => {
      requireOnline();
      const { error } = await db().rpc("set_course_submissions", {
        p_run_id: courseId,
        p_enabled: enabled,
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const upload = useMutation({
    mutationFn: (selected: NonNullable<typeof file>) =>
      uploadCourseSubmission(selected.bytes, courseId, selected.clientId),
    onSuccess: () => {
      setFile(null);
      setFileInputKey((previous) => previous + 1);
      setCursors([]);
      return refresh();
    },
  });
  const withdrawal = useMutation({
    mutationFn: async (versionId: string) => {
      requireOnline();
      const { error } = await db().rpc("withdraw_course_submission", {
        p_run_id: courseId,
        p_version_id: versionId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setConfirm(null);
      return refresh();
    },
  });
  const busy = settings.isPending || upload.isPending || withdrawal.isPending;
  const page = online && !list.isError ? list.data : undefined;
  const uploadError = upload.error?.message;
  return (
    <section
      className="card min-w-0 space-y-3"
      aria-labelledby={input + "-heading"}
    >
      <h2 id={input + "-heading"}>{t("submissions")}</h2>
      {!online && <p>{t("submissionOnline")}</p>}
      {online && list.isPending && <Loading />}
      {online && list.isError && (
        <>
          <Notice kind="error">{t("submissionUnavailable")}</Notice>
          <Button variant="secondary" onClick={() => void list.refetch()}>
            {t("submissionRetry")}
          </Button>
        </>
      )}
      {page && (
        <>
          <p>
            {t(
              readOnly
                ? "submissionReadOnly"
                : page.enabled
                  ? "submissionOpen"
                  : "submissionClosed",
            )}
          </p>
          {!readOnly && page.can_manage && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => settings.mutate(!page.enabled)}
            >
              {t(page.enabled ? "submissionDisable" : "submissionEnable")}
            </Button>
          )}
          {settings.isError && <Notice kind="error">{t("saveError")}</Notice>}
          {!readOnly && page.can_upload && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (file && !busy) upload.mutate(file);
              }}
            >
              <Field
                id={input}
                label={t("submissionFile")}
                hint={t("submissionFileLimit")}
              >
                <input
                  id={input}
                  key={fileInputKey}
                  className="max-w-full"
                  type="file"
                  accept={acceptedFiles}
                  disabled={busy}
                  onChange={(event) => {
                    upload.reset();
                    const bytes = event.currentTarget.files?.[0];
                    setFile(
                      bytes ? { bytes, clientId: crypto.randomUUID() } : null,
                    );
                  }}
                />
              </Field>
              <Button type="submit" disabled={!file || busy}>
                {t(upload.isPending ? "submissionScanning" : "submissionSend")}
              </Button>
            </form>
          )}
          {uploadError && (
            <Notice kind="error">
              {t(
                uploadError === "file_size"
                  ? "submissionFileLimit"
                  : uploadError === "scan_rejected"
                    ? "submissionRejected"
                    : uploadError === "scanner_unavailable"
                      ? "submissionScannerUnavailable"
                      : "submissionUploadFailed",
              )}
            </Notice>
          )}
          {upload.isSuccess && <Notice>{t("submissionUploaded")}</Notice>}
          {confirm && (
            <Dialog
              open
              onOpenChange={(open) => {
                if (!open && !withdrawal.isPending) setConfirm(null);
              }}
              returnFocusTo={confirm.trigger}
              title={t("submissionWithdraw")}
              description={t("submissionConfirm", { name: confirm.entry.name })}
            >
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  {t("submissionCancel")}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => withdrawal.mutate(confirm.entry.version_id)}
                >
                  {t("submissionWithdraw")}
                </Button>
              </div>
              {withdrawal.isError && (
                <Notice kind="error">{t("saveError")}</Notice>
              )}
            </Dialog>
          )}
          {withdrawal.isSuccess && <Notice>{t("submissionWithdrawn")}</Notice>}
          {page.entries.length ? (
            <ul className="divide-y">
              {page.entries.map((entry) => (
                <SubmissionRow
                  key={entry.version_id}
                  courseId={courseId}
                  entry={readOnly ? { ...entry, can_withdraw: false } : entry}
                  disabled={busy}
                  withdraw={(event) => {
                    withdrawal.reset();
                    setConfirm({ entry, trigger: event.currentTarget });
                  }}
                />
              ))}
            </ul>
          ) : (
            <p>{t("submissionEmpty")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            {cursors.length > 0 && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setConfirm(null);
                  setCursors((current) => current.slice(0, -1));
                }}
              >
                {t("submissionPrevious")}
              </Button>
            )}
            {page.next && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setConfirm(null);
                  const next = page.next;
                  if (next) setCursors((current) => [...current, next]);
                }}
              >
                {t("submissionNext")}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
