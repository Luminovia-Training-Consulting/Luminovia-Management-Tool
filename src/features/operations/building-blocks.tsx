/**
 * Readable course provenance and template-based course planning entry points. Display source
 * hashes/references without publishing original teaching PDFs.
 */
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { BookOpen, FileCheck2 } from "lucide-react";
import { DateTime } from "luxon";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading } from "../../components/common";
import {
  buildingBlocksQuery,
  type BuildingBlock,
  type BuildingBlockSource,
} from "./data";
import "./i18n";
import "./building-blocks.css";
import { jobBuildingBlockQuery } from "./building-blocks-api";

/** Display the canonical course building block and its referenced provenance. */
export function BuildingBlockReference({
  buildingBlockId,
  sourceId,
  templateId,
}: {
  buildingBlockId?: string | null;
  sourceId?: string | null;
  templateId?: string;
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
    <BuildingBlockSources block={block} sourceId={selectedSourceId} />
  ) : null;
}

/** Read one job's protected source chain and render it only when a reference exists. */
export function JobBuildingBlockReference({ jobId }: { jobId: string }) {
  const { session } = useAuth();
  const reference = useQuery(jobBuildingBlockQuery(session!.user.id, jobId));
  if (reference.isPending) return <Loading />;
  if (reference.isError)
    return <ErrorState retry={() => void reference.refetch()} />;
  return reference.data ? (
    <BuildingBlockReference
      buildingBlockId={reference.data.building_block_id}
      sourceId={reference.data.source_id}
    />
  ) : null;
}

/** Show distinct original revisions with provenance metadata without copying source files. */
export function BuildingBlockSources({
  block,
  sourceId,
}: {
  block: BuildingBlock;
  sourceId?: string | null;
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
      <p className="muted">{t("sourcePrivacy")}</p>
      <ul className="building-block-sources">
        {sources.map((source: BuildingBlockSource) => (
          <li key={source.id}>
            <strong>{source.file_name}</strong>
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

/** Select existing canonical blocks for a new course template or run. */
export function BuildingBlockCards({
  blocks,
  canManage,
  online,
  onView,
  onPlan,
}: {
  blocks: BuildingBlock[];
  canManage: boolean;
  online: boolean;
  onView: (id: string) => void;
  onPlan: (id: string) => void;
}) {
  const { t } = useTranslation("operations");
  return (
    <div className="operations-courses-grid building-block-cards">
      {blocks.map((block) => (
        <article className="panel operations-course" key={block.id}>
          <div className="section-heading">
            <BookOpen className="blue" />
            <span className="badge">{block.code}</span>
          </div>
          <h2>{block.title}</h2>
          <p>
            {t("sourceDuration", {
              days: block.duration_days,
              hours: block.duration_hours,
            })}
          </p>
          <p className="muted">{t("reusableBlock")}</p>
          <div className="operations-actions">
            <Button variant="secondary" onClick={() => onView(block.id)}>
              {t("blockDetails")}: {block.code}
            </Button>
            {canManage && (
              <Button
                disabled={!online}
                onClick={() => onPlan(block.default_template_id)}
              >
                {t("planRun")}: {block.code}
              </Button>
            )}
          </div>
        </article>
      ))}
      {!blocks.length && <p className="panel">{t("empty")}</p>}
    </div>
  );
}

/** Offer the authorized entry point for an offer derived from this specific course run. */
export function CourseRunOfferLink({ runId }: { runId: string }) {
  const { t } = useTranslation("operations");
  return (
    <Button asChild variant="secondary">
      <Link to={`/admin?courseRun=${runId}`}>{t("createRunOffer")}</Link>
    </Button>
  );
}
