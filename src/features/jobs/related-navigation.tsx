/** Exact server-authorized destinations; revocation errors never retain cached links. */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import "./related-navigation-i18n";

const relatedSchema = z.object({
  course_id: z.uuid().nullable(),
  rooms: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(["lecturer_course", "participant_course"]),
    }),
  ),
});

export function JobRelatedNavigation({
  actor,
  jobId,
  afterWorkspace,
}: {
  actor: string;
  jobId: string;
  afterWorkspace?: ReactNode;
}) {
  const { t } = useTranslation("jobRelated");
  const query = useQuery({
    queryKey: ["job-related-navigation", actor, jobId],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_related_navigation", { p_job_id: jobId })
        .abortSignal(signal);
      if (error) throw error;
      return relatedSchema.parse(data);
    },
    retry: false,
    refetchInterval: 10000,
  });
  const related = query.isSuccess ? query.data : undefined;
  if (
    !query.isError &&
    !afterWorkspace &&
    !related?.course_id &&
    !related?.rooms.length
  )
    return null;
  return (
    <nav aria-label={t("related")} className="page-actions">
      {query.isError && (
        <Notice kind="error">
          {t("unavailable")}{" "}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void query.refetch()}
          >
            {t("retry")}
          </Button>
        </Notice>
      )}
      {related?.course_id && (
        <Button asChild variant="secondary">
          <Link to={`/courses/${related.course_id}/workspace`}>
            {t("course")}
          </Link>
        </Button>
      )}
      {afterWorkspace}
      {related?.rooms.map((room) => (
        <Button key={room.id} asChild variant="secondary">
          <Link to={`/chats?room=${room.id}`}>{t(room.kind)}</Link>
        </Button>
      ))}
    </nav>
  );
}
