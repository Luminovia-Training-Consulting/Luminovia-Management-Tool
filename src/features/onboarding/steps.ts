import type { WelcomeStep } from "./api";

export interface GuideStep {
  id: WelcomeStep;
  path?: string;
}

// These values come from current server queries. Presentation never grants access.
export function welcomeSteps(
  roles: readonly string[],
  permissions: readonly string[],
): GuideStep[] {
  const teaching = roles.some((role) =>
    ["owner", "admin", "lecturer", "senior_lecturer"].includes(role),
  );
  const staff = teaching || roles.includes("management");
  return [
    { id: "welcome" },
    { id: "profile", path: "/profile" },
    ...(staff
      ? [
          { id: "jobs" as const, path: "/jobs" },
          { id: "availability" as const, path: "/availability" },
        ]
      : []),
    ...(roles.some((role) => ["owner", "admin", "client"].includes(role))
      ? [{ id: "client" as const, path: "/client" }]
      : []),
    { id: "calendar", path: "/calendar" },
    { id: "collaboration", path: "/chats" },
    { id: "files", path: "/files" },
    ...(teaching || permissions.includes("contracts.read")
      ? [{ id: "contracts" as const, path: "/profile/contracts" }]
      : []),
    { id: "notifications", path: "/settings" },
    ...(permissions.includes("users.manage") ||
    permissions.includes("users.roles.manage")
      ? [{ id: "administration" as const, path: "/admin/accounts" }]
      : []),
    { id: "finish" },
  ];
}
