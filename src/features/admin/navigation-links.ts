import { financeWorkspaceAccess } from "../../app/finance-access";
import { hasTeachingRole } from "../auth/internal-capabilities";

export const administrationAreas = {
  operations: {
    to: "/admin/operations",
    label: "adminOperations",
    description: "adminOperationsDescription",
  },
  directory: {
    to: "/admin/directory",
    label: "adminDirectory",
    description: "adminDirectoryDescription",
  },
  finance: {
    to: "/admin/finance",
    label: "platformFinance",
    description: "platformFinanceDescription",
  },
  platform: {
    to: "/admin/platform",
    label: "adminPlatform",
    description: "adminPlatformDescription",
  },
} as const;

export type AdministrationArea = keyof typeof administrationAreas;

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

  const links: {
    to: string;
    label: string;
    visible: boolean | undefined;
    area: AdministrationArea;
    end?: boolean;
  }[] = [
    {
      to: "/admin/assignments",
      label: "adminCoursesAssignments",
      visible: has("jobs.manage"),
      area: "operations",
      end: true,
    },
    {
      to: "/control-center",
      label: "controlCenter",
      area: "operations",
      visible: has("jobs.manage"),
    },
    {
      to: "/topics",
      label: "topics",
      area: "operations",
      visible: has("taxonomy.manage"),
    },
    {
      to: "/changes",
      label: "assignmentChanges",
      area: "operations",
      visible: management,
    },
    {
      to: "/contracts",
      label: "contracts",
      area: "operations",
      visible:
        management &&
        (has("contracts.manage") ||
          has("contracts.read") ||
          hasTeachingRole(roles)),
    },
    {
      to: "/admin/clients",
      label: "companies",
      area: "directory",
      visible: has("organisations.manage"),
    },
    {
      to: "/people",
      label: "staffDirectory",
      area: "directory",
      visible: management,
    },
    {
      to: "/admin/accounts",
      label: "adminAccounts",
      area: "directory",
      visible: has("users.manage"),
    },
    {
      to: "/admin/finance",
      label: "platformFinance",
      area: "finance",
      visible:
        active &&
        Object.values(financeWorkspaceAccess(roles, permissions).staff).some(
          Boolean,
        ),
    },
    {
      to: "/admin/announcements",
      label: "announcements",
      area: "platform",
      visible: has("announcements.manage"),
    },
    {
      to: "/admin/audit",
      label: "auditLog",
      area: "platform",
      visible: has("audit.read") || has("audit.activity.read"),
    },
    {
      to: "/admin/mail",
      label: "mailSettings",
      area: "platform",
      visible: has("mail.settings.manage"),
    },
    {
      to: "/admin/white-label",
      label: "whiteLabel",
      area: "platform",
      visible: administrator,
    },
    {
      to: "/admin/reset",
      label: "fullPlatformReset",
      area: "platform",
      visible: administrator,
    },
  ];
  return links.filter(({ visible }) => visible);
}

/** The original administration URL still accepts these published assignment views. */
export function isAssignmentRequest(params: URLSearchParams) {
  return (
    params.get("create") === "job" ||
    params.get("view") === "jobs" ||
    params.has("courseRun")
  );
}
