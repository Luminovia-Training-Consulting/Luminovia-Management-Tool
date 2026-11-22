import { hasTeachingRole } from "../features/auth/internal-capabilities";

/** Navigation follows the existing account capabilities. Each page still checks its own data access. */
export function financeWorkspaceAccess(
  roles: readonly string[] | undefined,
  permissions: readonly string[] | undefined,
) {
  const teaching = hasTeachingRole(roles);
  const company = roles?.includes("client") ?? false;
  const manage = permissions?.includes("finance.manage") ?? false;
  const gross = permissions?.includes("finance.gross.read") ?? false;
  return {
    overview: teaching || manage || gross,
    accounting: teaching || company || manage || gross,
    analytics:
      teaching ||
      company ||
      manage ||
      !!permissions?.some(
        (permission) =>
          permission === "jobs.manage" || permission === "courses.manage",
      ),
  };
}
