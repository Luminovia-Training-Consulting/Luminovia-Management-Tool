/** Presentation limits for guest-only accounts; server operational permissions remain authoritative. */
export function isGuestOnly(roles: readonly string[] | undefined): boolean {
  return Boolean(roles?.length && roles.every((role) => role === "guest"));
}
/** Guests keep only own settings/profile and the public help container. */
export function guestRouteAllowed(pathname: string): boolean {
  return ["/profile", "/settings", "/wiki", "/help"].includes(
    pathname.replace(/\/$/, "") || "/",
  );
}
