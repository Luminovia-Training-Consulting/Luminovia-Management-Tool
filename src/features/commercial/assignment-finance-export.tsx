/** Authorised reconciliation export for a selected period on the staff finance page. */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { saveAssignmentFinanceExport } from "./assignment-finance-export-file";
import { assignmentFinanceExportSchema } from "./assignment-finance-schema";
import "./assignment-finance-i18n";
import "./commercial.css";

export default function AssignmentFinanceExport({
  actor,
  zone,
}: {
  actor: string;
  zone: string;
}) {
  const { t } = useTranslation("assignmentFinance");
  const online = useOnline();
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(() =>
    DateTime.now().setZone(zone).minus({ days: 29 }).toISODate()!,
  );
  const [through, setThrough] = useState(() =>
    DateTime.now().setZone(zone).toISODate()!,
  );
  const [requested, setRequested] = useState(false);
  const download = useMutation({
    mutationFn: async (format: "csv" | "json") => {
      requireOnline();
      const client = db();
      const { data, error } = await client.rpc(
        "assignment_finance_export",
        { p_from: from, p_through: through },
        { get: true },
      );
      if (error) throw error;
      const report = assignmentFinanceExportSchema.parse(data);
      const latest = await client.auth.getSession();
      if (latest.error || latest.data.session?.user.id !== actor)
        throw new Error("Export session changed");
      if (report.assignments.length > 0)
        saveAssignmentFinanceExport(report, format);
      return report.assignments.length;
    },
  });
  const begin = DateTime.fromISO(from, { zone: "UTC" });
  const end = DateTime.fromISO(through, { zone: "UTC" });
  const days = end.diff(begin, "days").days;
  const valid = begin.isValid && end.isValid && days >= 0 && days < 93;
  const tooMany = z
    .object({ code: z.literal("54000") })
    .safeParse(download.error).success;

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={!online}
        onClick={() => {
          download.reset();
          setRequested(false);
          setOpen(true);
        }}
      >
        <Download size={16} aria-hidden="true" />
        {t("exportTitle")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        closeDisabled={download.isPending}
        title={t("exportDialogTitle")}
        description={t("exportDescription")}
      >
        <div className="section-stack settlement-export-dialog">
          <div className="form-row">
            <Field id={`${fieldId}-from`} label={t("exportFrom")}>
              <input
                id={`${fieldId}-from`}
                type="date"
                value={from}
                disabled={download.isPending}
                onChange={(event) => {
                  setFrom(event.target.value);
                  download.reset();
                }}
              />
            </Field>
            <Field id={`${fieldId}-through`} label={t("exportThrough")}>
              <input
                id={`${fieldId}-through`}
                type="date"
                value={through}
                disabled={download.isPending}
                onChange={(event) => {
                  setThrough(event.target.value);
                  download.reset();
                }}
              />
            </Field>
          </div>
          {requested && !valid && (
            <Notice kind="error">{t("exportPeriod")}</Notice>
          )}
          {download.isError && (
            <Notice kind="error">
              {t(tooMany ? "exportLimit" : "exportFailure")}
            </Notice>
          )}
          {download.isPending && (
            <p role="status" className="muted">
              {t("exportPending")}
            </p>
          )}
          {download.isSuccess && (
            <Notice>
              {t(download.data === 0 ? "exportEmpty" : "exportReady")}
            </Notice>
          )}
          <div className="form-actions">
            {(["csv", "json"] as const).map((format) => (
              <Button
                key={format}
                type="button"
                variant={format === "csv" ? "default" : "secondary"}
                disabled={!online || download.isPending}
                onClick={() => {
                  setRequested(true);
                  if (valid) download.mutate(format);
                }}
              >
                {t(format === "csv" ? "exportCsv" : "exportJson")}
              </Button>
            ))}
          </div>
        </div>
      </Dialog>
    </>
  );
}
