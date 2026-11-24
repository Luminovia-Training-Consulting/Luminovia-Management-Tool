/** Shared role-scoped navigation for administration and operational deep links. */
import {
  matchPath,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useDismissibleDisclosure } from "../../components/use-dismissible-disclosure";
import { administrationLinks } from "./navigation-links";
import { useAuth } from "../auth/auth-context";
import "../deletions/i18n";
import {
  permissionsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";

/** Shared routes stay a standalone workflow for lecturers and companies. */
export function AdminNavigation() {
  const { t } = useTranslation();
  const actor = useAuth().session!.user.id;
  const permissions = useQuery(permissionsQuery(actor));
  const roles = useQuery(userRolesQuery(actor));
  const profile = useQuery(profileQuery(actor));
  const location = useLocation();
  const { attributes, close } = useDismissibleDisclosure(location.key, true);
  const links = administrationLinks(
    roles.data,
    permissions.data,
    profile.data?.active === true && !roles.isError && !permissions.isError,
  );
  const current = links.find(({ to, end }) =>
    matchPath({ path: to, end: end ?? false }, location.pathname),
  );
  const inAdministration =
    location.pathname === "/admin" || location.pathname.startsWith("/admin/");

  if (
    location.pathname === "/admin" &&
    !current &&
    links.length &&
    permissions.isSuccess &&
    roles.isSuccess &&
    !location.search
  )
    return <Navigate to={links[0].to} replace />;
  if (!links.length || (!inAdministration && !current)) return <Outlet />;

  const sectionLinks = links.map(({ to, label, end }) => (
    <NavLink to={to} end={end} key={to} onClick={() => close(true)}>
      {t(label)}
    </NavLink>
  ));
  return (
    <>
      <nav className="admin-tabs administration-tabs" aria-label={t("admin")}>
        {sectionLinks}
      </nav>
      <details className="administration-menu" {...attributes}>
        <summary>
          <span>{t("admin")}</span>
          {current && <strong>{t(current.label)}</strong>}
        </summary>
        <nav aria-label={t("admin")}>{sectionLinks}</nav>
      </details>
      <Outlet />
    </>
  );
}
