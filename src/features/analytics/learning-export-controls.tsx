/** Export a fresh, authorised learning report page without exposing cached results after sign-out. */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { saveBlob } from "../../lib/blob-download";
import { downloadCsv } from "../../lib/csv";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { learningExportRows } from "./learning-export";
import type { LearningAnalyticsReport } from "./learning-schema";
import type { AnalyticsPeriod } from "./period";

type ExportFormat = "csv" | "xlsx" | "print";

export function LearningExportControls({
  actor,
  page,
  period,
  refresh,
}: {
  actor: string;
  page: number;
  period: AnalyticsPeriod;
  refresh: () => Promise<LearningAnalyticsReport>;
}) {
  const { t } = useTranslation("learningAnalytics");
  const [print, setPrint] = useState<ReturnType<typeof learningExportRows>>();
  const exportReport = useMutation({
    mutationFn: async (format: ExportFormat) => {
      requireOnline();
      const fresh = await refresh();
      if (fresh.courses.length === 0)
        throw new Error("empty_learning_report_page");
      const table = learningExportRows(fresh, period, t);
      const filename = `lms-${period.from}-${period.through}-${page}`;
      const xlsx =
        format === "xlsx"
          ? await (
              await import("../learning/attendance-xlsx")
            ).spreadsheetXlsxTemplate(table.headers, table.rows, "LMS")
          : null;
      if ((await db().auth.getSession()).data.session?.user.id !== actor)
        throw new Error("account_changed");
      if (format === "csv")
        downloadCsv(`${filename}.csv`, [table.headers, ...table.rows]);
      if (xlsx) saveBlob(xlsx, `${filename}.xlsx`);
      if (format === "print") setPrint(table);
    },
  });

  useEffect(() => {
    if (!print) return;
    const dismiss = () => setPrint(undefined);
    window.addEventListener("afterprint", dismiss, { once: true });
    window.print();
    return () => window.removeEventListener("afterprint", dismiss);
  }, [print]);

  return (
    <>
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={exportReport.isPending}
          onClick={() => exportReport.mutate("csv")}
        >
          {t("reportCsv")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={exportReport.isPending}
          onClick={() => exportReport.mutate("xlsx")}
        >
          {t("reportXlsx")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={exportReport.isPending}
          onClick={() => exportReport.mutate("print")}
        >
          {t("reportPrint")}
        </Button>
      </div>
      {exportReport.isPending && <p role="status">{t("reportPreparing")}</p>}
      {exportReport.isError && (
        <Notice kind="error">{t("reportExportError")}</Notice>
      )}
      {print && (
        <section className="learning-report-print">
          <h1>{t("title")}</h1>
          <table>
            <thead>
              <tr>
                {print.headers.map((header, index) => (
                  <th scope="col" key={index}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {print.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>{cell ?? "—"}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
