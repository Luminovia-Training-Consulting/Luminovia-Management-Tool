/** Compact navigation across administration subpages and existing workflow links. */
import {
  Link,
  matchPath,
  Outlet,
  useLocation,
  useOutletContext,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import {
  administrationAreas,
  administrationLinks,
  isAssignmentRequest,
  type AdministrationArea,
} from "./navigation-links";
import { useAuth } from "../auth/auth-context";
import "../deletions/i18n";
import {
  permissionsQuery,
  profileQuery,
  userRolesQuery,
} from "../../lib/queries";

type AdministrationContext = {
  links: ReturnType<typeof administrationLinks>;
  pending: boolean;
  failed: boolean;
  retry: () => void;
};

export function AdminNavigation() {
  const { t } = useTranslation();
  const actor = useAuth().session!.user.id;
  const permissions = useQuery(permissionsQuery(actor));
  const roles = useQuery(userRolesQuery(actor));
  const profile = useQuery(profileQuery(actor));
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const failed = permissions.isError || roles.isError || profile.isError;
  const links = administrationLinks(
    roles.data,
    permissions.data,
    profile.data?.active === true && !failed,
  );
  const current = links.find(({ to, end }) =>
    matchPath({ path: to, end: end ?? false }, pathname),
  );
  const inAdministration =
    pathname === "/admin" || pathname.startsWith("/admin/");
  const context: AdministrationContext = {
    links,
    pending: permissions.isPending || roles.isPending || profile.isPending,
    failed,
    retry: () => {
      void permissions.refetch();
      void roles.refetch();
      void profile.refetch();
    },
  };
  const legacyAssignment =
    pathname === "/admin" &&
    isAssignmentRequest(params) &&
    links.some(({ to }) => to === "/admin/assignments");
  const areaLinks = Object.entries(administrationAreas).filter(([area]) =>
    links.some((entry) => entry.area === area),
  );

  return (
    <>
      {!!links.length && (inAdministration || current) && (
        <nav className="admin-tabs administration-tabs" aria-label={t("admin")}>
          <Link
            to="/admin"
            aria-current={
              pathname === "/admin" && !legacyAssignment ? "page" : undefined
            }
          >
            {t("adminOverview")}
          </Link>
          {areaLinks.map(([area, { to, label }]) => (
            <Link
              key={to}
              to={to}
              aria-current={
                pathname === to
                  ? "page"
                  : current?.area === area ||
                      (legacyAssignment && area === "operations")
                    ? "location"
                    : undefined
              }
            >
              {t(label)}
            </Link>
          ))}
        </nav>
      )}
      <Outlet context={context} />
    </>
  );
}

/** The overview lists only available areas, and area pages list just their own destinations. */
export function AdministrationSection({ area }: { area?: AdministrationArea }) {
  const { t } = useTranslation();
  const { links, pending, failed, retry } =
    useOutletContext<AdministrationContext>();
  if (failed) return <ErrorState retry={retry} />;
  if (pending) return <Loading />;
  const items: { to: string; label: string; description?: string }[] = area
    ? links.filter((item) => item.area === area)
    : Object.entries(administrationAreas)
        .filter(([key]) => links.some((item) => item.area === key))
        .map(([, item]) => item);
  const title = area ? t(administrationAreas[area].label) : t("admin");
  const description = area
    ? t(administrationAreas[area].description)
    : undefined;

  return (
    <>
      <PageHeading title={title} description={description} />
      {items.length ? (
        <ul className="administration-destinations">
          {items.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className="panel">
                <span>
                  <strong>{t(item.label)}</strong>
                  {item.description && <small>{t(item.description)}</small>}
                </span>
                <ArrowRight size={18} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Notice kind="error">{t("noAccess")}</Notice>
      )}
    </>
  );
}
