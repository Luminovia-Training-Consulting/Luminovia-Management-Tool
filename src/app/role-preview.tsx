/** Read-only role navigation preview made solely from bilingual in-memory fictional examples. */
import {
  BookOpen,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  GraduationCap,
  type LucideIcon,
  SlidersHorizontal,
  Users,
  Wallet,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Notice, PageHeading } from "../components/common";
import { Button } from "../components/ui/button";
import helpCatalogue from "@edition-help";
import { guideText } from "../features/help/guide";
import { publicDemoEnabled } from "../lib/installation-brand";
import type { PreviewRole, RolePreviewState } from "./role-preview-state";
import "./role-preview-i18n";

const roleLabels = {
  management: "modeManagement",
  lecturer: "modeLecturer",
  company: "modeCompany",
  participant: "modeParticipant",
} as const;

export function RolePreviewControls({ state }: { state: RolePreviewState }) {
  const { t } = useTranslation("rolePreview");
  const { t: common } = useTranslation();
  if (state.allowed.length === 0 && !state.requested) return null;
  return (
    <div className="role-preview-controls">
      {(state.visible.length > 0 || state.requested) && (
        <label className="role-preview-switch">
          <span>{common("viewPreview")}</span>
          <select
            aria-label={common("viewPreview")}
            value={state.current ?? (state.requested ? "unavailable" : "live")}
            onChange={(event) => state.select(event.currentTarget.value)}
          >
            {state.requested && !state.current && (
              <option value="unavailable" disabled>
                {t("unavailableShort")}
              </option>
            )}
            <option value="live">{t("live")}</option>
            {state.visible.map((role) => (
              <option key={role} value={role}>
                {t(roleLabels[role])}
              </option>
            ))}
          </select>
        </label>
      )}
      {state.allowed.length > 0 && (
        <details className="role-preview-options">
          <summary aria-label={t("customise")} title={t("customise")}>
            <SlidersHorizontal size={17} aria-hidden="true" />
          </summary>
          <fieldset>
            <legend>{t("customise")}</legend>
            {state.allowed.map((role) => (
              <label key={role}>
                <input
                  type="checkbox"
                  checked={state.visible.includes(role)}
                  onChange={(event) =>
                    state.setVisible(role, event.currentTarget.checked)
                  }
                />
                {t(roleLabels[role])}
              </label>
            ))}
          </fieldset>
        </details>
      )}
    </div>
  );
}

export function RolePreviewUnavailable() {
  const { t } = useTranslation("rolePreview");
  return <Notice>{t("unavailable")}</Notice>;
}

/** Show safe sample cards, never a different account identity or a privileged page loader. */
export function RolePreview({
  role,
  path,
  academy = false,
}: {
  role: PreviewRole;
  path: string;
  academy?: boolean;
}) {
  const { t, i18n } = useTranslation("rolePreview");
  const cards: Record<PreviewRole, readonly [string, string, LucideIcon][]> = {
    management: [
      ["managementCourses", "managementCoursesBody", BookOpen],
      academy
        ? ["academySchedule", "academyScheduleBody", CalendarDays]
        : ["managementJobs", "managementJobsBody", BriefcaseBusiness],
      ["managementClients", "managementClientsBody", Building2],
    ],
    lecturer: [
      ["lecturerCourses", "lecturerCoursesBody", BookOpen],
      academy
        ? ["academySchedule", "academyScheduleBody", CalendarDays]
        : ["lecturerJobs", "lecturerJobsBody", BriefcaseBusiness],
      academy
        ? ["lecturerLearning", "lecturerLearningBody", BookOpen]
        : ["lecturerInvoices", "lecturerInvoicesBody", Wallet],
    ],
    company: [
      ["companyCourses", "companyCoursesBody", BookOpen],
      ["companyParticipants", "companyParticipantsBody", Users],
      academy
        ? ["academySchedule", "academyScheduleBody", CalendarDays]
        : ["companyInvoices", "companyInvoicesBody", Wallet],
    ],
    participant: [
      ["learnerCourses", "learnerCoursesBody", GraduationCap],
      ["learnerMaterials", "learnerMaterialsBody", BookOpen],
      ["learnerProgress", "learnerProgressBody", CalendarDays],
    ],
  };
  const roleLabel = t(roleLabels[role]);
  const sectionPath = path.replace(/^\/demo/, "") || "/";
  const section = helpCatalogue.modules.find(
    (item) => item.path === sectionPath,
  );
  return (
    <section
      className="role-preview"
      aria-label={t("previewTitle", { role: roleLabel })}
    >
      <PageHeading
        title={t("previewTitle", { role: roleLabel })}
        description={t("previewDescription")}
      />
      <Notice>{t("previewWarning")}</Notice>
      <section className="panel role-preview-current-section">
        <h2>
          {t("currentSection")}:{" "}
          {section ? guideText(section.title, i18n.language) : roleLabel}
        </h2>
        <p>{t("sectionSample")}</p>
        <span className="badge">{t("sample")}</span>
      </section>
      <div className="role-preview-grid">
        {cards[role].map(([title, description, Icon]) => (
          <article className="panel role-preview-card" key={title}>
            <div className="role-preview-card-heading">
              <Icon size={20} aria-hidden="true" />
              <h2>{t(title)}</h2>
            </div>
            <p>{t(description)}</p>
            <span className="badge">{t("sample")}</span>
          </article>
        ))}
      </div>
      {publicDemoEnabled && (
        <Button asChild>
          <Link to={`/demo?role=${role === "company" ? "client" : role}`}>
            {t("openDemo")}
          </Link>
        </Button>
      )}
    </section>
  );
}
