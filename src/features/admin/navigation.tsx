import { NavLink, Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
export function AdminNavigation() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const permissions = useQuery(permissionsQuery(session!.user.id));
  return (
    <>
      <nav className="admin-tabs" aria-label={t("admin")}>
        {permissions.data?.includes("jobs.manage") && (
          <NavLink to="/admin" end>
            {t("jobs")}
          </NavLink>
        )}
        {permissions.data?.includes("users.manage") &&
          permissions.data.includes("qualifications.verify") && (
            <NavLink to="/admin/people">{t("people")}</NavLink>
          )}
        {permissions.data?.includes("users.manage") && (
          <NavLink to="/admin/accounts">{t("accounts")}</NavLink>
        )}
        {permissions.data?.includes("audit.read") && (
          <NavLink to="/admin/audit">{t("auditLog")}</NavLink>
        )}
        {permissions.data?.includes("announcements.manage") && (
          <NavLink to="/admin/announcements">{t("announcements")}</NavLink>
        )}
      </nav>
      <Outlet />
    </>
  );
}
