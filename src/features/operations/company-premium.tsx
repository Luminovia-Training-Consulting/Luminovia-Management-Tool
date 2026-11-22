/** Admin-only per-company Premium controls with audited confirmations and retained-course summaries. */
import { useLayoutEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  companyPremiumCommandSchema,
  retainedCompanyLmsSchema,
  type CompanyPremiumSetting,
} from "./company-premium-schema";
import { AuditedCourseChat } from "./audited-course-chat";
import "./i18n";

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
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const [requested, setRequested] = useState<boolean | null>(null);
  const [confirmationStep, setConfirmationStep] = useState(1);
  const [notice, setNotice] = useState<"saved" | "conflict" | "failed" | null>(
    null,
  );
  const requestId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (requested !== null && confirmationStep === 2)
      backButton.current?.focus();
  }, [confirmationStep, requested]);
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
      return companyPremiumCommandSchema.parse(data);
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

  return (
    <section className="company-premium-control">
      <div className="company-premium-status">
        {isAdmin && !archived ? (
          <Button
            type="button"
            variant="secondary"
            role="switch"
            aria-checked={setting.enabled}
            aria-label={t("premiumSwitch")}
            className={`premium-switch premium-switch-${setting.enabled ? "on" : "off"}`}
            disabled={!online}
            aria-disabled={!online || command.isPending}
            onClick={(event) => {
              if (command.isPending) return;
              setTrigger(event.currentTarget);
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
        {isAdmin &&
          (online ? (
            <RetainedCompanySummary
              key={`${actor}:${setting.organisation_id}`}
              organisation={setting.organisation_id}
              zone={zone}
            />
          ) : (
            <Button type="button" variant="secondary" disabled>
              {t("premiumRetainedData")}
            </Button>
          ))}
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
        returnFocusTo={trigger}
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
              ref={backButton}
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
    </section>
  );
}

/** Own each audited read only while this exact actor and organisation are active
 * and online. Losing that scope unmounts the dialog and its mutation observer. */
function RetainedCompanySummary({
  organisation,
  zone,
}: {
  organisation: string;
  zone?: string;
}) {
  const { t } = useTranslation("operations");
  const [retainedOpen, setRetainedOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const retained = useMutation({
    // A discarded observer must not retain protected response data in the client.
    gcTime: 0,
    mutationFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("retained_company_lms", {
        p_organisation_id: organisation,
      });
      if (error) throw error;
      return retainedCompanyLmsSchema.parse(data);
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        disabled={retained.isPending}
        onClick={(event) => {
          setTrigger(event.currentTarget);
          setRetainedOpen(true);
          retained.mutate();
        }}
      >
        {t("premiumRetainedData")}
      </Button>
      <Dialog
        open={retainedOpen}
        onOpenChange={(open) => {
          if (open) return;
          setRetainedOpen(false);
          retained.reset();
        }}
        title={t("premiumRetainedData")}
        description={t("premiumRetainedHelp")}
        returnFocusTo={trigger}
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
                {course.course_group_messages > 0 && (
                  <AuditedCourseChat
                    key={course.run_id}
                    organisation={organisation}
                    course={course.run_id}
                    zone={zone ?? "UTC"}
                  />
                )}
              </article>
            ))}
          </div>
        )}
      </Dialog>
    </>
  );
}
