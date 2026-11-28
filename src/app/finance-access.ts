import { hasTeachingRole } from "../features/auth/internal-capabilities";

export const financeRoots = {
  personal: "/finance",
  company: "/client/finance",
  staff: "/admin/finance",
} as const;

export type FinanceScope = keyof typeof financeRoots;

export function financeWorkspaceAccess(
  roles: readonly string[] | undefined,
  permissions: readonly string[] | undefined,
) {
  const teaching = hasTeachingRole(roles);
  const company = roles?.includes("client") ?? false;
  const management =
    roles?.some(
      (role) => role === "owner" || role === "admin" || role === "management",
    ) ?? false;
  const can = (permission: string) =>
    permissions?.includes(permission) ?? false;
  const overview =
    management && (can("finance.manage") || can("finance.gross.read"));
  const analytics = management && (can("finance.manage") || can("jobs.manage"));

  return {
    personal: {
      // Keep the sidebar shortcut for lecturers outside platform administration.
      sidebar: teaching && !management,
      overview: teaching,
      accounting: teaching,
      analytics: teaching,
      learning: teaching,
    },
    company: {
      overview: false,
      accounting: company,
      analytics: company,
      learning: company,
    },
    staff: {
      overview,
      accounting: overview,
      analytics,
      learning: management && (analytics || can("courses.manage")),
    },
  };
}
