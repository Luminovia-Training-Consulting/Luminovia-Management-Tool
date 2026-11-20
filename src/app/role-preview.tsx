/** Read-only role navigation preview made solely from bilingual in-memory fictional examples. */
import {BookOpen, BriefcaseBusiness, Building2, Users, Wallet} from "lucide-react";
import {useTranslation} from "react-i18next";
import {Notice, PageHeading} from "../components/common";
import {guideModules, guideText} from "../features/help/catalog";
import "./role-preview-i18n";

export type PreviewRole = "management" | "lecturer" | "company";

/** Show safe sample cards, never a different account identity or a privileged page loader. */
export function RolePreview({
                                role,
                                path,
                            }: {
    role: PreviewRole;
    path: string;
}) {
    const {t, i18n} = useTranslation("rolePreview");
    const cards = {
        management: [
            ["managementCourses", "managementCoursesBody", BookOpen],
            ["managementJobs", "managementJobsBody", BriefcaseBusiness],
            ["managementClients", "managementClientsBody", Building2],
        ],
        lecturer: [
            ["lecturerCourses", "lecturerCoursesBody", BookOpen],
            ["lecturerJobs", "lecturerJobsBody", BriefcaseBusiness],
            ["lecturerInvoices", "lecturerInvoicesBody", Wallet],
        ],
        company: [
            ["companyCourses", "companyCoursesBody", BookOpen],
            ["companyParticipants", "companyParticipantsBody", Users],
            ["companyInvoices", "companyInvoicesBody", Wallet],
        ],
    } as const;
    const roleLabel = t(
        role === "management"
            ? "modeManagement"
            : role === "lecturer"
                ? "modeLecturer"
                : "modeCompany",
    );
    const sectionPath = path.replace(/^\/demo/, "") || "/";
    const section = guideModules.find((item) => item.path === sectionPath);
    return (
        <section
            className="role-preview"
            aria-label={t("previewTitle", {role: roleLabel})}
        >
            <PageHeading
                title={t("previewTitle", {role: roleLabel})}
                description={t("previewDescription")}
            />
            <Notice>{t("previewWarning")}</Notice>
            <section className="panel role-preview-current-section">
                <h2>{t("currentSection")}: {section ? guideText(section.title, i18n.language) : roleLabel}</h2>
                <p>{t("sectionSample")}</p>
                <span className="badge">{t("sample")}</span>
            </section>
            <div className="role-preview-grid">
                {cards[role].map(([title, description, Icon]) => (
                    <article className="panel role-preview-card" key={title}>
                        <div className="role-preview-card-heading">
                            <Icon size={20} aria-hidden="true"/>
                            <h2>{t(title)}</h2>
                        </div>
                        <p>{t(description)}</p>
                        <span className="badge">{t("sample")}</span>
                    </article>
                ))}
            </div>
        </section>
    );
}