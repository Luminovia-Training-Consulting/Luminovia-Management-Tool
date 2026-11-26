/** Inspect a selected SCORM archive in memory without exposing its contents as HTML or URLs. */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import type { ScormPackageReview as Review } from "./scorm-package";

export function ScormPackageReview() {
  const { t, i18n } = useTranslation("learning");
  const id = useId();
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Review>();
  const [error, setError] = useState<string>();
  const active = useRef<AbortController>(null);
  // Leaving the course section drops both the selected file and its review.
  useEffect(() => () => active.current?.abort(), []);

  async function inspect(event: FormEvent) {
    event.preventDefault();
    if (!file || busy) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(undefined);
    setReport(undefined);
    try {
      const validator = await import("./scorm-package");
      controller.signal.throwIfAborted();
      if (!/\.zip$/i.test(file.name))
        throw new validator.ScormReviewError("invalid_archive");
      if (file.size < 4 || file.size > validator.scormPackageMaxBytes)
        throw new validator.ScormReviewError("file_size");
      const review = await validator.reviewScormPackage(
        await file.arrayBuffer(),
        controller.signal,
      );
      if (!controller.signal.aborted) setReport(review);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "invalid_archive");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function cancelReview() {
    active.current?.abort();
    setBusy(false);
  }

  const number = new Intl.NumberFormat(i18n.language);
  return (
    <section
      className="panel learning-panel min-w-0 space-y-3"
      aria-labelledby={id + "-heading"}
    >
      <h2 id={id + "-heading"}>{t("scormReviewTitle")}</h2>
      <p>{t("scormReviewHint")}</p>
      <form onSubmit={inspect} className="space-y-2">
        <Field
          id={id + "-package"}
          label={t("scormReviewFile")}
          hint={t("scormReviewLimit")}
        >
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy}
            onChange={(event) => {
              setFile(event.currentTarget.files?.[0]);
              setError(undefined);
              setReport(undefined);
            }}
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!file || busy}>
            {t("scormReviewInspect")}
          </Button>
          {busy && (
            <Button type="button" variant="secondary" onClick={cancelReview}>
              {t("submissionCancel")}
            </Button>
          )}
        </div>
      </form>
      {busy && <p role="status">{t("scormReviewBusy")}</p>}
      {error && (
        <Notice kind="error">
          {t("scormError_" + error, {
            defaultValue: t("scormError_invalid_archive"),
          })}
        </Notice>
      )}
      {report && (
        <div className="space-y-2">
          <p role="status">
            {t("scormReviewReady", {
              files: number.format(report.files),
              size: number.format(report.expandedBytes),
            })}
          </p>
          <p>
            {t("scormReviewDigest")}{" "}
            <code className="[overflow-wrap:anywhere]">{report.sha256}</code>
          </p>
          <h3 className="[overflow-wrap:anywhere]">{report.organisation}</h3>
          <ol className="list-decimal pl-6">
            {report.launches.map(({ id, path, title }) => (
              <li key={id} className="[overflow-wrap:anywhere]">
                <strong>{title}</strong> · <code>{path}</code>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
