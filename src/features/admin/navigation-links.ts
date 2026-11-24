import { hasTeachingRole } from "../auth/internal-capabilities";

/** Define which administrative destinations the current account can discover. */
export function administrationLinks(
  roles: readonly string[] | undefined,
  permissions: readonly string[] | undefined,
  active: boolean,
) {
  const administrator =
    active && roles?.some((role) => role === "admin" || role === "owner");
  const management = administrator || (active && roles?.includes("management"));
  const has = (permission: string) =>
    active && permissions?.includes(permission);

  return [
    {
      to: "/admin",
      label: "adminCoursesAssignments",
      visible: has("jobs.manage"),
      end: true,
    },
    { to: "/changes", label: "assignmentChanges", visible: management },
    {
      to: "/contracts",
      label: "contracts",
      visible:
        management &&
        (has("contracts.manage") ||
          has("contracts.read") ||
          hasTeachingRole(roles)),
    },
    {
      to: "/admin/clients",
      label: "companies",
      visible: has("organisations.manage"),
    },
    {
      to: "/admin/accounts",
      label: "adminAccountsExpertise",
      visible: has("users.manage"),
    },
    {
      to: "/admin/announcements",
      label: "announcements",
      visible: has("announcements.manage"),
    },
    {
      to: "/admin/audit",
      label: "auditLog",
      visible: has("audit.read") || has("audit.activity.read"),
    },
    {
      to: "/admin/mail",
      label: "mailSettings",
      visible: has("mail.settings.manage"),
    },
    { to: "/admin/white-label", label: "whiteLabel", visible: administrator },
    { to: "/admin/reset", label: "fullPlatformReset", visible: administrator },
  ].filter(({ visible }) => visible);
}
