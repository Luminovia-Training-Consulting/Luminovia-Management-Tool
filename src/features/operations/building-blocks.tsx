/**
 * Readable course provenance and template-based course planning entry points. Display source
 * hashes/references without publishing original teaching PDFs.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileCheck2 } from "lucide-react";
import { DateTime } from "luxon";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { jobSourceAvailable, saveDownload, saveJobSource } from "../files/api";
import { FileUpload } from "../files/files";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading, Notice } from "../../components/common";
import {
  type BuildingBlock,
  type BuildingBlockSource,
  buildingBlocksQuery,
} from "./data";
import "./i18n";
import "./building-blocks.css";
import { jobBuildingBlockQuery } from "./building-blocks-api";

/** Display the canonical course building block and its referenced provenance. */
export function BuildingBlockReference({
  buildingBlockId,
  sourceId,
  templateId,
  jobId,
  canManageJobSource,
}: {
  buildingBlockId?: string | null;
  sourceId?: string | null;
  templateId?: string;
  jobId?: string;
  canManageJobSource?: boolean;
}) {
  const { session } = useAuth();
  const reference = useQuery({
    queryKey: [
      "operations",
      "template-reference",
      session!.user.id,
      templateId,
    ],
    enabled: Boolean(templateId),
    queryFn: async () => {
      const { data, error } = await db()
        .from("course_templates")
        .select("building_block_id,building_block_source_id")
        .eq("id", templateId!)
        .maybeSingle();
      if (error) throw error;
      return data as {
        building_block_id: string | null;
        building_block_source_id: string | null;
      } | null;
    },
  });
  const selectedBlockId = buildingBlockId ?? reference.data?.building_block_id;
  const selectedSourceId = sourceId ?? reference.data?.building_block_source_id;
  const blocks = useQuery({
    ...buildingBlocksQuery(session!.user.id),
    enabled: Boolean(selectedBlockId),
  });
  if (templateId && reference.isPending) return <Loading />;
  if (templateId && reference.isError)
    return <ErrorState retry={() => void reference.refetch()} />;
  if (!selectedBlockId) return null;
  if (blocks.isPending) return <Loading />;
  if (blocks.isError) return <ErrorState retry={() => void blocks.refetch()} />;
  const block = blocks.data.find((row) => row.id === selectedBlockId);
  return block ? (
    <BuildingBlockSources
      block={block}
      sourceId={selectedSourceId}
      jobId={jobId}
      canManageJobSource={canManageJobSource}
    />
  ) : null;
}

/** Read one job's protected source chain and render it only when a reference exists. */
export function JobBuildingBlockReference({
  jobId,
  canManage,
}: {
  jobId: string;
  canManage: boolean;
}) {
  const { session } = useAuth();
  const reference = useQuery(jobBuildingBlockQuery(session!.user.id, jobId));
  if (reference.isPending) return <Loading />;
  if (reference.isError)
    return <ErrorState retry={() => void reference.refetch()} />;
  return reference.data ? (
    <BuildingBlockReference
      buildingBlockId={reference.data.building_block_id}
      sourceId={reference.data.source_id}
      jobId={jobId}
      canManageJobSource={canManage}
    />
  ) : null;
}

/** Show distinct original revisions with provenance metadata without copying source files. */
export function BuildingBlockSources({
  block,
  sourceId,
  jobId,
  canManageJobSource = false,
}: {
  block: BuildingBlock;
  sourceId?: string | null;
  jobId?: string;
  canManageJobSource?: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
  const date = (value: string) =>
    DateTime.fromISO(value)
      .setLocale(i18n.language)
      .toLocaleString(DateTime.DATE_MED);
  const sources = [...block.building_block_sources].sort(
    (a, b) =>
      Number(b.id === sourceId) - Number(a.id === sourceId) ||
      Number(b.is_primary) - Number(a.is_primary) ||
      a.file_name.localeCompare(b.file_name),
  );
  return (
    <section
      className="building-block-reference"
      aria-label={t("sourceReference")}
    >
      <h3>
        <FileCheck2 size={18} />
        {t("sourceReference")}
      </h3>
      <p>
        <strong>{block.code}</strong> ·{" "}
        {t("sourceDuration", {
          days: block.duration_days,
          hours: block.duration_hours,
        })}
      </p>
      <p className="muted">
        {t(jobId ? "jobSourceDownloadHelp" : "sourcePrivacy")}
      </p>
      {jobId && (
        <Link to={{ hash: "#job-documents" }}>{t("openJobAttachments")}</Link>
      )}
      <ul className="building-block-sources">
        {sources.map((source: BuildingBlockSource) => (
          <li key={source.id}>
            {jobId ? (
              <JobSourceDownload
                jobId={jobId}
                source={source}
                canUpload={canManageJobSource && source.id === sourceId}
              />
            ) : (
              <strong>{source.file_name}</strong>
            )}
            <span className="badge">
              {t(
                source.id === sourceId
                  ? "referencedSource"
                  : source.is_primary
                    ? "primarySource"
                    : "sourceVariant",
              )}
            </span>
            <p>
              {t("sourceRevision")}: {date(source.revision_on)} ·{" "}
              {t("sourceCreated")}: {date(source.created_on)}
            </p>
            <p>
              {t("contentPages")}: {source.content_pages.join(", ")} ·{" "}
              {t("sourcePageCount", { count: source.page_count })}
            </p>
            <details>
              <summary>{t("sourceHash")}</summary>
              <code>{source.sha256}</code>
            </details>
          </li>
        ))}
      </ul>
      <p className="muted">{block.notes}</p>
    </section>
  );
}

/** Offer the authorized entry point for an offer derived from this specific course run. */
export function CourseRunOfferLink({
  runId,
  additional = false,
  compact = false,
}: {
  runId: string;
  additional?: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation("operations");
  return (
    <Button asChild variant={compact ? "ghost" : "secondary"}>
      <Link to={`/courses?offer=${runId}`}>
        {t(additional ? "createAdditionalRunOffer" : "createRunOffer")}
      </Link>
    </Button>
  );
}

/** A reference can download only its exact, scanned PDF attached to this job. */
function JobSourceDownload({
  jobId,
  source,
  canUpload,
}: {
  jobId: string;
  source: BuildingBlockSource;
  canUpload: boolean;
}) {
  const { session } = useAuth();
  const { t } = useTranslation("files");
  const { t: sourceText } = useTranslation("operations");
  const online = useOnline();
  const attachment = useQuery({
    queryKey: [
      "documents",
      session?.user.id,
      "job-source",
      jobId,
      source.sha256,
    ],
    enabled: Boolean(session) && online,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .from("document_versions")
        .select(
          "id,document_id,documents!document_versions_document_id_fkey!inner(job_id,deleted_at)",
        )
        .eq("documents.job_id", jobId)
        .is("documents.deleted_at", null)
        .eq("status", "clean")
        .eq("mime_type", "application/pdf")
        .eq("sha256", source.sha256)
        .order("id")
        .limit(1)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data as { id: string; document_id: string } | null;
    },
  });
  const librarySource = useQuery({
    queryKey: [
      "documents",
      session?.user.id,
      "job-source-library",
      jobId,
      source.id,
    ],
    enabled:
      Boolean(session) && online && attachment.isSuccess && !attachment.data,
    queryFn: ({ signal }) => jobSourceAvailable(jobId, source.id, signal),
  });
  const download = useMutation({
    mutationFn: () =>
      attachment.data
        ? saveDownload(
            attachment.data.document_id,
            source.file_name,
            attachment.data.id,
          )
        : saveJobSource(jobId, source.id, source.file_name),
  });

  if (
    (!attachment.data && !librarySource.data) ||
    attachment.isError ||
    librarySource.isError
  )
    return (
      <>
        <strong>{source.file_name}</strong>
        {online && attachment.isSuccess && librarySource.isSuccess && (
          <>
            <p className="muted">{sourceText("jobSourceUnavailable")}</p>
            {canUpload && (
              <details>
                <summary>{sourceText("attachJobSource")}</summary>
                <FileUpload
                  context={{ scope: "job_after", jobId }}
                  sourceSha256={source.sha256}
                />
              </details>
            )}
          </>
        )}
        {attachment.isError && (
          <ErrorState retry={() => void attachment.refetch()} />
        )}
        {librarySource.isError && (
          <ErrorState retry={() => void librarySource.refetch()} />
        )}
      </>
    );
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        aria-label={`${t("download")}: ${source.file_name}`}
        disabled={!online || download.isPending}
        onClick={() => download.mutate()}
      >
        {source.file_name}
      </Button>
      {download.isError && <Notice kind="error">{t("error")}</Notice>}
    </>
  );
}
