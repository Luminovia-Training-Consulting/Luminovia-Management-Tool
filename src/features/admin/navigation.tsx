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
import { SectionLink } from "../../components/section-card";
import { ArrowRight, LayoutDashboard } from "lucide-react";
import { ErrorState, Loading, PageHeading } from "../../components/common";
import { PageNotFound } from "../../components/page-not-found";
import { isDatabasePermissionDenied } from "../../lib/database-errors";
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
  const inAdministration = Boolean(matchPath("/admin/*", pathname));
  const overview = Boolean(matchPath("/admin", pathname));
  const resetAlias = Boolean(matchPath("/reset", pathname));
  const controlCenter = Boolean(matchPath("/control-center", pathname));
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
  const legacyAssignment = overview && isAssignmentRequest(params);
  const areaLinks = Object.entries(administrationAreas).filter(([area]) =>
    links.some((entry) => entry.area === area),
  );

  // Mount administrative routes only for the capabilities used to advertise
  // them. Shared routes outside /admin still have their own audience rules.
  if (inAdministration || resetAlias || controlCenter) {
    if (
      [permissions.error, roles.error, profile.error].some(
        isDatabasePermissionDenied,
      )
    )
      return <PageNotFound />;
    if (failed) return <ErrorState retry={context.retry} />;
    if (context.pending) return <Loading />;
    const allowed = overview
      ? legacyAssignment
        ? links.some(({ to }) => to === "/admin/assignments")
        : areaLinks.length > 0
      : resetAlias
        ? links.some(({ to }) => to === "/admin/reset")
        : current ||
          areaLinks.some(([, { to }]) => matchPath(to, pathname)) ||
          (matchPath("/admin/people", pathname) &&
            links.some(({ to }) => to === "/people")) ||
          (matchPath("/admin/deletions", pathname) &&
            roles.data?.some((role) => role === "admin" || role === "owner") &&
            links.some(({ to }) => to === "/admin/accounts"));
    if (!allowed) return <PageNotFound />;
  }

  return (
    <>
      {!!links.length && (inAdministration || current) && (
        <nav className="section-navigation" aria-label={t("admin")}>
          <SectionLink
            to="/admin"
            title={t("adminOverview")}
            description={t("adminOverviewDescription")}
            aria-current={overview && !legacyAssignment ? "page" : undefined}
          />
          {areaLinks.map(([area, { to, label, description }]) => (
            <SectionLink
              key={to}
              to={to}
              title={t(label)}
              description={t(description)}
              aria-current={
                matchPath(to, pathname)
                  ? "page"
                  : current?.area === area ||
                      (legacyAssignment && area === "operations")
                    ? "location"
                    : undefined
              }
            />
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
  const items: { to: string; label: string; description: string }[] = area
    ? links.filter((item) => item.area === area)
    : Object.entries(administrationAreas)
        .filter(([key]) => links.some((item) => item.area === key))
        .map(([, item]) => item);
  const title = area ? t(administrationAreas[area].label) : t("admin");
  const description = area
    ? t(administrationAreas[area].description)
    : undefined;
  if (!items.length) return <PageNotFound />;

  return (
    <>
      <PageHeading title={title} description={description} />
      <ul className="administration-destinations">
        {items.map((item) => (
          <li key={item.to}>
            <Link to={item.to} className="panel">
              <span>
                <strong className="administration-destination-label">
                  {item.to === "/control-center" && (
                    <LayoutDashboard size={20} aria-hidden="true" />
                  )}
                  {t(item.label)}
                </strong>{" "}
                <small>{t(item.description)}</small>
              </span>
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
