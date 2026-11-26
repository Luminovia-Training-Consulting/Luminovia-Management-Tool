/** Download and attach scanned evidence within an exact portfolio revision. */
import { useId, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { acceptedFiles, uploadPortfolioEvidence } from "../files/api";
import { downloadPortalDocument } from "./api";
import type { PortfolioEvidence } from "./portfolio-schema";

export function PortfolioEvidenceFiles({
  items,
  id,
  revision,
  shared = false,
  archived = false,
  unlink,
  pending,
}: {
  items: PortfolioEvidence[];
  id: string;
  revision: number;
  shared?: boolean;
  archived?: boolean;
  unlink?: (id: string) => void;
  pending?: boolean;
}) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const download = useMutation({
    mutationFn: ({ version_id, name }: PortfolioEvidence) =>
      downloadPortalDocument(
        { kind: "portfolio_evidence", id, revision, shared, version_id },
        name,
      ),
  });
  if (!items.length) return null;
  return (
    <div className="space-y-2">
      <p className="font-semibold">{t("portfolioEvidenceHeading")}</p>
      <ul className="space-y-2" aria-label={t("portfolioEvidenceHeading")}>
        {items.map((file) => (
          <li
            key={file.version_id}
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            <span className="min-w-0 break-all">{file.name}</span>
            {!archived && (
              <Button
                type="button"
                variant="secondary"
                aria-label={t("portfolioDownloadEvidenceNamed", {
                  name: file.name,
                })}
                disabled={!online || download.isPending}
                onClick={() => download.mutate(file)}
              >
                {t("portfolioDownloadEvidence")}
              </Button>
            )}
            {unlink && (
              <Button
                type="button"
                variant="secondary"
                aria-label={t("portfolioUnlinkEvidenceNamed", {
                  name: file.name,
                })}
                disabled={!online || pending}
                onClick={() => unlink(file.version_id)}
              >
                {t("portfolioUnlinkEvidence")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {download.isError && (
        <Notice kind="error">{t("portfolioEvidenceDownloadError")}</Notice>
      )}
    </div>
  );
}

export function PortfolioEvidencePicker({
  link,
  error,
  pending,
  clearError,
}: {
  link: (versionId: string) => Promise<unknown>;
  error: (failure: unknown) => ReactNode;
  pending: boolean;
  clearError: () => void;
}) {
  const { t } = useTranslation("learning");
  const id = useId();
  const online = useOnline();
  const [selection, setSelection] = useState<{
    file: File;
    requestId: string;
  }>();
  const upload = useMutation({
    mutationFn: async ({ file, requestId }: NonNullable<typeof selection>) =>
      link(await uploadPortfolioEvidence(file, requestId)),
  });
  const largeFile =
    selection &&
    (selection.file.size < 1 || selection.file.size > 10 * 1024 * 1024);
  return (
    <details className="space-y-2">
      <summary>{t("portfolioAttach")}</summary>
      <p>{t("portfolioEvidenceHelp")}</p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (selection && !largeFile && !pending && !upload.isPending)
            upload.mutate(selection);
        }}
      >
        <Field id={id} label={t("portfolioChooseFile")}>
          <input
            type="file"
            accept={acceptedFiles}
            disabled={pending || upload.isPending || !online}
            onChange={(event) => {
              const chosen = event.currentTarget.files?.[0];
              setSelection(
                chosen
                  ? { file: chosen, requestId: crypto.randomUUID() }
                  : undefined,
              );
              upload.reset();
              clearError();
            }}
          />
        </Field>
        {largeFile && (
          <Notice kind="error">{t("portfolioEvidenceSizeError")}</Notice>
        )}
        <Button
          type="submit"
          disabled={
            !selection || largeFile || pending || upload.isPending || !online
          }
        >
          {t(
            upload.isPending
              ? "portfolioScanningEvidence"
              : "portfolioUploadEvidence",
          )}
        </Button>
      </form>
      {error(upload.error)}
    </details>
  );
}
