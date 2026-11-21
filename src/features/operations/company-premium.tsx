/** Admin-only per-company Premium controls with audited confirmations and retained-course summaries. */
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import type { CompanyPremiumSetting } from "./data";
import { AuditedCourseChat } from "./audited-course-chat";
import "./i18n";

type PremiumCommandResult = {
  status: "updated" | "unchanged" | "conflict";
  enabled: boolean;
  version: number;
};
type RetainedCourse = {
  run_id: string;
  title: string;
  archived_at: string | null;
  sessions: number;
  enrolments: number;
  resources: {
    name: string;
    version: number;
    audience: string;
    removed: boolean;
  }[];
  attendance_entries: number;
  course_group_messages: number;
  questions: number;
  quiz_attempts: number;
  completion_records: number;
};
type RetainedData = {
  organisation_id: string;
  premium_enabled: boolean;
  course_count: number;
  courses: RetainedCourse[];
};

/** Keep every role's status readable while only a current admin receives mutation controls. */
export function CompanyPremiumControl({
  actor,
  setting,
  isAdmin,
  archived = false,
  zone,
}: {
  actor: string;
  setting: CompanyPremiumSetting;
  isAdmin: boolean;
  archived?: boolean;
  zone?: string;
}) {
  const { t } = useTranslation("operations");
  const online = useOnline();
  const cache = useQueryClient();
  const [requested, setRequested] = useState<boolean | null>(null);
  const [confirmationStep, setConfirmationStep] = useState(1);
  const [retainedOpen, setRetainedOpen] = useState(false);
  const [notice, setNotice] = useState<"saved" | "conflict" | "failed" | null>(
    null,
  );
  const requestId = useRef<string | null>(null);
  const command = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (requested === null) throw new Error("toggle_not_requested");
      requestId.current ??= crypto.randomUUID();
      const { data, error } = await db().rpc("set_company_premium", {
        p_organisation_id: setting.organisation_id,
        p_enabled: requested,
        p_expected_version: setting.version,
        p_request_id: requestId.current,
      });
      if (error) throw error;
      return data as PremiumCommandResult;
    },
    onSuccess: async (result) => {
      setNotice(result.status === "conflict" ? "conflict" : "saved");
      setRequested(null);
      setConfirmationStep(1);
      requestId.current = null;
      await cache.invalidateQueries({
        queryKey: ["operations", "company-premium", actor],
      });
    },
    onError: () => {
      setNotice("failed");
      void cache.invalidateQueries({
        queryKey: ["operations", "company-premium", actor],
      });
    },
  });
  const retained = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("retained_company_lms", {
        p_organisation_id: setting.organisation_id,
      });
      if (error) throw error;
      return data as RetainedData;
    },
  });

  return (
    <section className="company-premium-control">
      <div className="company-premium-status">
        {isAdmin && !archived ? (
          <Button
            type="button"
            variant="secondary"
            role="switch"
            aria-checked={setting.enabled}
            aria-label={t(setting.enabled ? "premiumDisable" : "premiumEnable")}
            className={`premium-switch premium-switch-${setting.enabled ? "on" : "off"}`}
            disabled={!online || command.isPending}
            onClick={() => {
              setNotice(null);
              setRequested(!setting.enabled);
              setConfirmationStep(1);
              requestId.current = crypto.randomUUID();
            }}
          >
            <span className="premium-switch-indicator" aria-hidden="true" />
            {t(setting.enabled ? "premiumEnabled" : "premiumDisabled")}
          </Button>
        ) : (
          <span
            className={`badge premium-status-${setting.enabled && !archived ? "on" : "off"}`}
          >
            {t(
              setting.enabled && !archived
                ? "premiumEnabled"
                : "premiumDisabled",
            )}
          </span>
        )}
        <small className="muted">
          {t("premiumVersion", { version: setting.version })}
        </small>
      </div>
      <div className="form-actions">
        {!isAdmin && !archived && (
          <span className="muted">{t("premiumAdminOnly")}</span>
        )}
        {isAdmin && (
          <Button
            type="button"
            variant="secondary"
            disabled={!online || retained.isPending}
            onClick={() => {
              setRetainedOpen(true);
              retained.mutate();
            }}
          >
            {t("premiumRetainedData")}
          </Button>
        )}
      </div>
      {notice && (
        <Notice kind={notice === "saved" ? "success" : "error"}>
          {t(
            notice === "saved"
              ? "premiumSaved"
              : notice === "conflict"
                ? "premiumConflict"
                : "premiumFailed",
          )}
        </Notice>
      )}
      <Dialog
        open={requested !== null}
        onOpenChange={(open) => {
          if (!open && !command.isPending) {
            setRequested(null);
            setConfirmationStep(1);
            requestId.current = null;
          }
        }}
        title={t(requested ? "premiumConfirmEnable" : "premiumConfirmDisable")}
        description={t("premiumConfirmHelp")}
      >
        {requested !== null && confirmationStep === 1 ? (
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRequested(null);
                requestId.current = null;
              }}
            >
              {t("cancel")}
            </Button>
            <Button type="button" onClick={() => setConfirmationStep(2)}>
              {t("premiumContinue")}
            </Button>
          </div>
        ) : requested !== null ? (
          <div className="form-actions">
            <Button
              type="button"
              variant="secondary"
              disabled={command.isPending}
              onClick={() => setConfirmationStep(1)}
            >
              {t("premiumBack")}
            </Button>
            <Button
              type="button"
              disabled={!online || command.isPending}
              onClick={() => command.mutate()}
            >
              {command.isPending
                ? t("saving")
                : t(
                    requested
                      ? "premiumConfirmEnableFinal"
                      : "premiumConfirmDisableFinal",
                  )}
            </Button>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={retainedOpen}
        onOpenChange={(open) => {
          if (!open) setRetainedOpen(false);
        }}
        title={t("premiumRetainedData")}
        description={t("premiumRetainedHelp")}
      >
        {retained.isPending ? (
          <p role="status">{t("loading")}</p>
        ) : retained.isError ? (
          <Notice kind="error">{t("premiumFailed")}</Notice>
        ) : (
          <div className="retained-course-list">
            <p>
              {t("retainedCourseCount", {
                count: retained.data?.course_count ?? 0,
              })}
            </p>
            {retained.data?.courses.map((course) => (
              <article className="retained-course" key={course.run_id}>
                <h3>{course.title}</h3>
                {course.archived_at && (
                  <span className="badge">{t("archive")}</span>
                )}
                <p>
                  {t("retainedCourseSummary", {
                    sessions: course.sessions,
                    enrolments: course.enrolments,
                    resources: course.resources.length,
                    attendance: course.attendance_entries,
                    messages: course.course_group_messages,
                    questions: course.questions,
                    quizAttempts: course.quiz_attempts,
                    completions: course.completion_records,
                  })}
                </p>
                {isAdmin && course.course_group_messages > 0 && (
                  <AuditedCourseChat
                    key={course.run_id}
                    organisation={setting.organisation_id}
                    course={course.run_id}
                    zone={zone ?? "UTC"}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </Dialog>
    </section>
  );
}
