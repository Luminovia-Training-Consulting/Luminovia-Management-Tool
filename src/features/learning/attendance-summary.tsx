import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Loading } from "../../components/common";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { attendanceSummarySchema } from "./attendance-schema";

import { attendanceSummariesKey } from "./attendance-api";

export function AttendanceSummary({
  actor,
  run,
}: {
  actor: string;
  run: string;
}) {
  const { t, i18n } = useTranslation("learning");
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const after = cursors.at(-1) ?? null;
  const query = useQuery({
    queryKey: [...attendanceSummariesKey(actor), run, after],
    enabled: online && open,
    retry: false,
    gcTime: 0,
    refetchOnMount: "always",
    refetchInterval: open && online ? 15_000 : false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_attendance_summary", {
          p_run_id: run,
          p_after_user_id: after,
        })
        .abortSignal(signal);
      if (error) throw error;
      return attendanceSummarySchema.parse(data);
    },
  });
  const number = new Intl.NumberFormat(i18n.language);
  return (
    <details
      className="attendance-summary"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("attendanceSummary")}</summary>
      {open &&
        (!online ? (
          <p>{t("workspaceOffline")}</p>
        ) : query.isError ? (
          <ErrorState retry={() => void query.refetch()} />
        ) : query.isPending ? (
          <Loading />
        ) : (
          <>
            <p>
              {query.data.class_name
                ? t("attendanceSummaryClass", {
                    name: query.data.class_name,
                    count: query.data.course_count,
                  })
                : t("attendanceSummaryCourse")}
            </p>
            {query.data.rows.length ? (
              <div
                className="attendance-summary-scroll"
                role="region"
                aria-label={t("attendanceSummary")}
                tabIndex={0}
              >
                <table className="attendance-summary-table">
                  <thead>
                    <tr>
                      {[
                        "reportName",
                        "reportPresent",
                        "reportAbsent",
                        "reportExcused",
                        "attendanceSummaryMinutes",
                      ].map((key) => (
                        <th key={key} scope="col">
                          {t(key)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.rows.map((row) => (
                      <tr key={row.user_id}>
                        <th scope="row">
                          {row.name.trim() || t("attendanceUnnamedParticipant")}
                        </th>
                        <td>{number.format(row.present)}</td>
                        <td>{number.format(row.absent)}</td>
                        <td>{number.format(row.excused)}</td>
                        <td>{number.format(row.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>{t("attendanceNoParticipants")}</p>
            )}
            {(after || query.data.next_after) && (
              <div className="form-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!after}
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
                  {t("attendanceSummaryPrevious")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!query.data.next_after}
                  onClick={() => {
                    const cursor = query.data.next_after;
                    if (cursor) setCursors([...cursors, cursor]);
                  }}
                >
                  {t("attendanceSummaryNext")}
                </Button>
              </div>
            )}
          </>
        ))}
    </details>
  );
}
