import { financeWorkspaceAccess } from "../../app/finance-access";

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
    description: string;
    visible: boolean | undefined;
    area: AdministrationArea;
    end?: boolean;
  }[] = [
    {
      to: "/admin/assignments",
      label: "adminCoursesAssignments",
      description: "adminDestination_adminCoursesAssignments",
      visible: has("jobs.manage"),
      area: "operations",
      end: true,
    },
    {
      to: "/control-center",
      label: "controlCenter",
      description: "adminDestination_controlCenter",
      area: "operations",
      visible: has("jobs.manage"),
    },
    {
      to: "/topics",
      label: "topics",
      description: "adminDestination_topics",
      area: "operations",
      visible: has("taxonomy.manage"),
    },
    {
      to: "/changes",
      label: "assignmentChanges",
      description: "adminDestination_assignmentChanges",
      area: "operations",
      visible: management,
    },
    {
      to: "/admin/clients",
      label: "companies",
      description: "adminDestination_companies",
      area: "directory",
      visible: has("organisations.manage"),
    },
    {
      to: "/people",
      label: "staffDirectory",
      description: "adminDestination_staffDirectory",
      area: "directory",
      visible: management,
    },
    {
      to: "/admin/accounts",
      label: "adminAccounts",
      description: "adminDestination_adminAccounts",
      area: "directory",
      visible: has("users.manage"),
    },
    {
      to: "/admin/finance",
      label: "platformFinance",
      description: "adminDestination_platformFinance",
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
      description: "adminDestination_announcements",
      area: "platform",
      visible: has("announcements.manage"),
    },
    {
      to: "/admin/audit",
      label: "auditLog",
      description: "adminDestination_auditLog",
      area: "platform",
      visible: has("audit.read") || has("audit.activity.read"),
    },
    {
      to: "/admin/mail",
      label: "mailSettings",
      description: "adminDestination_mailSettings",
      area: "platform",
      visible: has("mail.settings.manage"),
    },
    {
      to: "/admin/white-label",
      label: "whiteLabel",
      description: "adminDestination_whiteLabel",
      area: "platform",
      visible: administrator,
    },
    {
      to: "/admin/reset",
      label: "fullPlatformReset",
      description: "adminDestination_fullPlatformReset",
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
