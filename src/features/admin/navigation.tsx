/**
 * Capability-aware administration navigation. These links provide orientation; direct routes and
 * data access retain their independent authorization checks.
 */
import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/auth-context";
import "../deletions/i18n";
import {
  permissionsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";

/** Show sections allowed by loaded capabilities; links do not replace server permissions. */
export function AdminNavigation() {
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  const profile = useQuery(profileQuery(session!.user.id));
  const isAdministrator =
    profile.data?.active &&
    roles.data?.some((role) => role === "admin" || role === "owner");
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
        {permissions.data?.includes("users.manage") && (
          <NavLink to="/admin/accounts">
            {i18n.language.startsWith("de")
              ? "Konten & Expertise"
              : "Accounts & expertise"}
          </NavLink>
        )}
        {permissions.data?.includes("organisations.manage") && (
          <NavLink to="/admin/clients">{t("companies")}</NavLink>
        )}
        {permissions.data?.some((permission) =>
          ["audit.read", "audit.activity.read"].includes(permission),
        ) && <NavLink to="/admin/audit">{t("auditLog")}</NavLink>}
        {permissions.data?.includes("mail.settings.manage") && (
          <NavLink to="/admin/mail">{t("mailSettings")}</NavLink>
        )}
        {permissions.data?.includes("announcements.manage") && (
          <NavLink to="/admin/announcements">{t("announcements")}</NavLink>
        )}
        {isAdministrator && (
          <NavLink to="/admin/white-label">White Label</NavLink>
        )}
        {isAdministrator && (
          <NavLink to="/admin/reset">{t("fullPlatformReset")}</NavLink>
        )}
      </nav>
      <Outlet />
    </>
  );
}
