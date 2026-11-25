import { useQuery } from "@tanstack/react-query";
import {
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading } from "../components/common";
import { PageNotFound } from "../components/page-not-found";
import { useAuth } from "../features/auth/auth-context";
import {
  financeRoots,
  financeWorkspaceAccess,
  type FinanceScope,
} from "./finance-access";
import { permissionsQuery, userRolesQuery } from "../lib/queries";
import { isDatabasePermissionDenied } from "../lib/database-errors";

const tabs = [
  {
    suffix: "",
    key: "overview",
    label: "financeOverview",
    personal: "myFinanceOverview",
    staff: "platformFinanceOverview",
  },
  {
    suffix: "/accounting",
    key: "accounting",
    label: "accountingExports",
    personal: "myFinanceExports",
    staff: "platformFinanceExports",
  },
  {
    suffix: "/analytics",
    key: "analytics",
    label: "analytics",
    personal: "myFinanceAnalytics",
    staff: "platformFinanceAnalytics",
  },
] as const;

export function FinanceWorkspace({ scope }: { scope: FinanceScope }) {
  const { t } = useTranslation();
  const { pathname, search, hash } = useLocation();
  const [params] = useSearchParams();
  const actor = useAuth().session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  const permissions = useQuery(permissionsQuery(actor));
  if (
    [roles.failureReason, permissions.failureReason].some(
      isDatabasePermissionDenied,
    )
  )
    return <PageNotFound />;
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
  const base = financeRoots[scope];
  const selected = pathname.toLowerCase().replace(/\/+$/, "");
  const suffix = selected.slice(base.length);
  if (scope === "personal") {
    if (
      !suffix &&
      params.has("claim") &&
      !access.personal.overview &&
      !access.staff.overview
    )
      return (
        <Navigate to={access.company.accounting ? "/client" : "/"} replace />
      );
    // Older links had one URL for all three audiences. Retain explicit
    // company/management links and management invoice-series notices.
    const requested = params.get("scope");
    const legacyScope =
      suffix.startsWith("/analytics") &&
      requested === "company" &&
      access.company.analytics
        ? "company"
        : (suffix.startsWith("/analytics") &&
              requested === "staff" &&
              (access.staff.analytics || access.staff.learning)) ||
            (!suffix && params.has("series") && access.staff.overview)
          ? "staff"
          : undefined;
    const fallback =
      access.staff.overview || access.staff.analytics || access.staff.learning
        ? "staff"
        : access.company.accounting
          ? "company"
          : undefined;
    const destination =
      legacyScope ?? (!access.personal.overview ? fallback : undefined);
    if (destination)
      return (
        <Navigate
          to={{ pathname: financeRoots[destination] + suffix, search, hash }}
          replace
        />
      );
  }
  const current = access[scope];
  const visible = tabs.filter(({ key }) => current[key]);
  const isLearning = suffix === "/analytics/learning";
  if (scope !== "personal" && !visible.length && !current.learning)
    return <PageNotFound />;
  if (
    !(isLearning
      ? current.learning
      : visible.some((tab) => tab.suffix === suffix))
  ) {
    if (scope === "staff" && suffix) return <PageNotFound />;
    const next =
      visible[0]?.suffix ??
      (current.learning && !isLearning ? "/analytics/learning" : null);
    return (
      <Navigate
        to={
          next === null
            ? scope === "company"
              ? "/client"
              : "/"
            : { pathname: base + next, search, hash }
        }
        replace
      />
    );
  }
  return (
    <>
      <nav
        className={scope === "company" ? "admin-tabs" : "section-navigation"}
        aria-label={t(
          scope === "staff"
            ? "platformFinance"
            : scope === "company"
              ? "companyFinance"
              : "myFinance",
        )}
      >
        {visible.map(({ suffix: path, label, personal, staff }) => (
          <NavLink key={path} to={base + path} end={path !== "/analytics"}>
            <strong>
              {t(
                scope === "personal" && path === "/accounting"
                  ? "myInvoiceExports"
                  : label,
              )}
            </strong>
            {scope !== "company" && (
              <>
                {" "}
                <small>{t(scope === "personal" ? personal : staff)}</small>
              </>
            )}
          </NavLink>
        ))}
        {scope === "staff" && current.learning && !current.analytics && (
          <NavLink to={base + "/analytics/learning"}>
            {t("learningAnalytics:title")}
          </NavLink>
        )}
      </nav>
      <Outlet />
    </>
  );
}

export function LegacyFinanceRoute({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate to={{ pathname: to, search, hash }} replace />;
}
