import { useQuery } from "@tanstack/react-query";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../components/common";
import { useAuth } from "../features/auth/auth-context";
import { financeWorkspaceAccess } from "./finance-access";
import { permissionsQuery, userRolesQuery } from "../lib/queries";

const tabs = [
  { path: "/finance", key: "overview", label: "financeOverview", end: true },
  {
    path: "/finance/accounting",
    key: "accounting",
    label: "accountingExports",
    end: true,
  },
  {
    path: "/finance/analytics",
    key: "analytics",
    label: "analytics",
    end: false,
  },
] as const;
type FinanceTab = (typeof tabs)[number]["path"];

function FinanceNavigation({ paths }: { paths: readonly FinanceTab[] }) {
  const { t } = useTranslation();
  if (paths.length < 2) return null;
  return (
    <nav className="admin-tabs" aria-label={t("finance")}>
      {tabs
        .filter(({ path }) => paths.includes(path))
        .map(({ path, label, end }) => (
          <NavLink key={path} to={path} end={end}>
            {t(label)}
          </NavLink>
        ))}
    </nav>
  );
}

export function FinanceWorkspace() {
  const { pathname } = useLocation();
  const actor = useAuth().session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  const permissions = useQuery(permissionsQuery(actor));
  if (roles.isPending || permissions.isPending) return <Loading />;
  if (roles.isError || permissions.isError)
    return (
      <ErrorState
        retry={() => {
          void roles.refetch();
          void permissions.refetch();
        }}
      />
    );
  const access = financeWorkspaceAccess(roles.data, permissions.data);
  const paths = tabs.filter(({ key }) => access[key]).map(({ path }) => path);
  const selected = pathname.replace(/\/$/, "");
  if (
    !paths.some(
      (path) =>
        path === selected ||
        (path === "/finance/analytics" &&
          selected === "/finance/analytics/learning"),
    )
  )
    return <Navigate to={paths[0] ?? "/"} replace />;
  return (
    <>
      <FinanceNavigation paths={paths} />
      <Outlet
        context={{
          preferCustomer:
            !access.overview && (roles.data?.includes("client") ?? false),
        }}
      />
    </>
  );
}

export function LegacyFinanceRoute({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}
