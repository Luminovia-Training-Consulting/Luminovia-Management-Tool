/** Export only a freshly authorized forecast for the active scenario. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { downloadCsv } from "../../lib/csv";
import { requireOnline, useOnline } from "../../lib/online";
import { permissionsQuery } from "../../lib/queries";
import { db } from "../../lib/supabase";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";
import { forecastQuery, type FinancePeriod } from "./finance-api";

/** The scenario key unmounts this observer when the account or inputs change. */
export function ForecastExport({
  actor,
  boundary,
  period,
  probability,
  hasRows,
}: {
  actor: string;
  boundary: string | null;
  period: FinancePeriod;
  probability: number;
  hasRows: boolean;
}) {
  const { t } = useTranslation("financeOps");
  const queryClient = useQueryClient();
  const online = useOnline();
  const [notice, setNotice] = useState<"downloaded" | "noItems" | null>(null);
  const report = useMutation({
    gcTime: 0,
    networkMode: "always",
    mutationFn: async () => {
      requireOnline();
      const forecast = await queryClient.fetchQuery({
        ...forecastQuery(actor, period, probability, true),
        staleTime: 0,
      });
      const permissions = permissionsQuery(actor);
      // Forecast reads already enforce the finance role. Refresh the page's
      // management and gross capabilities as well before releasing the export.
      await queryClient.fetchQuery({ ...permissions, staleTime: 0 });
      const { data, error } = await db().auth.getSession();
      requireOnline();
      const current = queryClient.getQueryData<string[]>(permissions.queryKey);
      if (
        error ||
        data.session?.user.id !== actor ||
        sessionCacheBoundary(data.session?.access_token) !== boundary ||
        !current?.includes("jobs.manage") ||
        !current.includes("finance.manage") ||
        forecast.from !== period.from ||
        forecast.until !== period.until ||
        forecast.pipeline_probability !== probability
      ) {
        throw new Error("forecast_unavailable");
      }
      return {
        forecast,
        gross:
          current.includes("finance.gross.read") && forecast.gross_authorized,
      };
    },
  });

  function download() {
    setNotice(null);
    // Per-call handlers are removed on unmount, so retired scenarios cannot download.
    report.mutate(undefined, {
      onSuccess({ forecast, gross }) {
        if (!navigator.onLine) return;
        if (!forecast.months.length) {
          setNotice("noItems");
          return;
        }
        downloadCsv(
          `luminovia-forecast-${forecast.from}-${forecast.until}.csv`,
          [
            [
              t("from"),
              t("until"),
              t("forecastZone"),
              t("appliedProbability"),
              t("month"),
              t("currency"),
              t("acceptedCost"),
              ...(gross
                ? [t("knownGross"), t("unknownGrossCount"), t("knownMargin")]
                : []),
              t("pipelineCost"),
              t("unknownPipelineCostCount"),
              ...(gross ? [t("pipelineGross")] : []),
              t("payments"),
            ],
            ...forecast.months.map((row) => [
              forecast.from,
              forecast.until,
              forecast.time_zone,
              Math.round(forecast.pipeline_probability * 100),
              row.month,
              row.currency,
              row.accepted_lecturer_cost,
              ...(gross
                ? [
                    row.accepted_gross_known,
                    row.unknown_gross_claims,
                    row.accepted_margin_known,
                  ]
                : []),
              row.pipeline_lecturer_cost_known,
              row.pipeline_cost_unknown_positions,
              ...(gross ? [row.pipeline_gross_known] : []),
              row.lecturer_invoice_payments,
            ]),
          ],
        );
        setNotice("downloaded");
      },
    });
  }

  return (
    <>
      <Button
        variant="secondary"
        disabled={!online || !hasRows || report.isPending}
        aria-busy={report.isPending}
        onClick={download}
      >
        {t("forecastExport")}
      </Button>
      {!online ? (
        <Notice kind="error">{t("forecastExportOffline")}</Notice>
      ) : report.isError ? (
        <Notice kind="error">{t("forecastExportError")}</Notice>
      ) : notice ? (
        <Notice>{t(notice)}</Notice>
      ) : null}
    </>
  );
}
