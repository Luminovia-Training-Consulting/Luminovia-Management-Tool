/**
 * Capability-aware administration navigation. These links provide orientation; direct routes and
 * data access retain their independent authorization checks.
 */
import {NavLink, Outlet} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {useQuery} from "@tanstack/react-query";
import {useAuth} from "../auth/auth-context";
import "../deletions/i18n";
import {permissionsQuery} from "../../lib/queries";

/** Show sections allowed by loaded capabilities; links do not replace server permissions. */
export function AdminNavigation() {
    const {t, i18n} = useTranslation();
    const {session} = useAuth();
    const permissions = useQuery(permissionsQuery(session!.user.id));
    return (
        <>
            <nav className="admin-tabs" aria-label={t("admin")}>
                {permissions.data?.includes("jobs.manage") && (
                    <NavLink to="/admin" end>
                        {i18n.language.startsWith("de")
                            ? "Kurse & Aufträge"
                            : "Courses & assignments"}
                    </NavLink>
                )}
                {permissions.data?.includes("users.manage") &&
                    permissions.data.includes("qualifications.verify") && (
                        <NavLink to="/admin/people">{t("people")}</NavLink>
                    )}
                {permissions.data?.includes("users.manage") && (
                    <NavLink to="/admin/accounts">{t("accounts")}</NavLink>
                )}
                {permissions.data?.includes("organisations.manage") && (
                    <NavLink to="/admin/clients">{t("companies")}</NavLink>
                )}
                {permissions.data?.includes("audit.read") && (
                    <NavLink to="/admin/audit">{t("auditLog")}</NavLink>
                )}
                {permissions.data?.includes("mail.settings.manage") && (
                    <NavLink to="/admin/mail">{t("mailSettings")}</NavLink>
                )}
                {permissions.data?.includes("announcements.manage") && (
                    <NavLink to="/admin/announcements">{t("announcements")}</NavLink>
                )}
            </nav>
            <Outlet/>
        </>
    );
}