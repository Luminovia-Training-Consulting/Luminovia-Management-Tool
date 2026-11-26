/** Current external grades are visible to course staff in a separate reviewed view. */
import "./lti-course-i18n";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

type Column = {
  id: string;
  label: string;
  maximum: number;
  graded: number;
  results: {
    subject_id: string;
    name: string;
    score: number | null;
    grading_progress: string;
    comment: string | null;
  }[];
};
const pageSize = 10;

export function LtiGrades({
  actor,
  deployment,
  version,
  enabled,
  canConfigure,
  saved,
}: {
  actor: string;
  deployment: string;
  version: number;
  enabled: boolean;
  canConfigure: boolean;
  saved: () => void;
}) {
  const { t, i18n } = useTranslation("learning");
  const [open, setOpen] = useState(false);
  const [after, setAfter] = useState<string | null>(null);
  const formatter = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 2,
  });
  const rows = useQuery({
    queryKey: ["course-lti-ags-grades", actor, deployment, after],
    enabled: open,
    gcTime: 0,
    retry: false,
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_lti_ags_grades", {
          p_registration_id: deployment,
          p_after: after,
          p_limit: pageSize,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as Column[];
    },
  });
  const toggle = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("configure_course_lti_ags", {
        p_registration_id: deployment,
        p_expected_version: version,
        p_ags: !enabled,
      });
      if (error) throw error;
    },
    onSuccess: saved,
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("ltiGrades")}</summary>
      <p>{t("ltiGradesHelp")}</p>
      {canConfigure && (
        <Button
          type="button"
          variant="secondary"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate()}
        >
          {t(enabled ? "ltiGradesDisable" : "ltiGradesEnable")}
        </Button>
      )}
      {toggle.isError && <Notice kind="error">{t("ltiAdvantageError")}</Notice>}
      {open &&
        (rows.isPending ? (
          <Loading />
        ) : rows.isError ? (
          <ErrorState retry={() => void rows.refetch()} />
        ) : rows.data.length ? (
          <>
            {rows.data.slice(0, pageSize).map((column) => (
              <details key={column.id}>
                <summary>{column.label}</summary>
                <p>{t("ltiGradesCount", { count: column.graded })}</p>
                {column.graded > 100 && <p>{t("ltiGradesFirst")}</p>}
                <ul className="learning-resources">
                  {column.results.map((result) => (
                    <li key={result.subject_id}>
                      <strong>{result.name}</strong>
                      <p>{t(`ltiGrade_${result.grading_progress}`)}</p>
                      {result.score !== null && (
                        <p>
                          {t("ltiGradesMaximum", {
                            score: formatter.format(result.score),
                            maximum: formatter.format(column.maximum),
                          })}
                        </p>
                      )}
                      {result.comment && (
                        <p className="preserve-text">{result.comment}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
            <div className="form-actions">
              {rows.data.length > pageSize && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setAfter(rows.data[pageSize - 1].id)}
                >
                  {t("ltiGradesMore")}
                </Button>
              )}
              {after && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setAfter(null)}
                >
                  {t("ltiGradesBack")}
                </Button>
              )}
            </div>
          </>
        ) : (
          <p>{t("ltiGradesEmpty")}</p>
        ))}
    </details>
  );
}
