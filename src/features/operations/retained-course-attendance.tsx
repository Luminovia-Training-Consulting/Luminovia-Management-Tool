/** Inspect recorded marks without enabling the operational attendance register. */
import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  retainedCourseAttendanceSchema,
  type RetainedCourseAttendance,
} from "./company-premium-schema";

export function RetainedCourseAttendancePanel({
  organisation,
  course,
}: {
  organisation: string;
  course: string;
}) {
  const { t, i18n } = useTranslation("operations");
  const online = useOnline();
  const reasonId = useId();
  const [reason, setReason] = useState("");
  const purpose = reason.trim();
  const inspection = useMutation({
    gcTime: 0,
    mutationFn: async (cursor: RetainedCourseAttendance["next_cursor"]) => {
      requireOnline();
      const { data, error } = await db().rpc(
        "inspect_retained_course_attendance",
        {
          p_organisation_id: organisation,
          p_run_id: course,
          p_reason: purpose,
          p_after_start: cursor?.starts_at ?? null,
          p_after_session_id: cursor?.session_id ?? null,
          p_after_user_id: cursor?.user_id ?? null,
        },
      );
      if (error) throw error;
      return retainedCourseAttendanceSchema.parse(data);
    },
  });
  const page = online ? inspection.data : undefined;
  const formatTime = (value: string) =>
    dateTime(value, i18n.language, page?.time_zone ?? "UTC");

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (online && purpose.length >= 8 && !inspection.isPending)
            inspection.mutate(null);
        }}
      >
        <Field id={reasonId} label={t("retainedAttendanceReason")}>
          <input
            id={reasonId}
            value={reason}
            required
            minLength={8}
            maxLength={300}
            disabled={inspection.isPending}
            onChange={(event) => {
              setReason(event.currentTarget.value);
              inspection.reset();
            }}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={!online || purpose.length < 8 || inspection.isPending}
        >
          {t(inspection.isPending ? "loading" : "inspectRetainedAttendance")}
        </Button>
      </form>
      {inspection.isError && <Notice kind="error">{t("premiumFailed")}</Notice>}
      {page && (
        <>
          {page.items.length === 0 ? (
            <p>{t("retainedAttendanceEmpty")}</p>
          ) : (
            <ul className="course-chat-messages">
              {page.items.map((item) => (
                <li key={`${item.session_id}:${item.user_id}`}>
                  <strong>{item.name}</strong> ·{" "}
                  {t(`retainedAttendanceStatus.${item.status}`)}
                  <p>
                    {formatTime(item.starts_at)} – {formatTime(item.ends_at)}
                  </p>
                  {item.arrival_at && (
                    <p>
                      {t("retainedAttendanceArrival", {
                        time: formatTime(item.arrival_at),
                      })}
                    </p>
                  )}
                  {item.departure_at && (
                    <p>
                      {t("retainedAttendanceDeparture", {
                        time: formatTime(item.departure_at),
                      })}
                    </p>
                  )}
                  {item.note && <p className="preserve-text">{item.note}</p>}
                </li>
              ))}
            </ul>
          )}
          {page.next_cursor && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => inspection.mutate(page.next_cursor)}
            >
              {t("retainedAttendanceNext")}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
