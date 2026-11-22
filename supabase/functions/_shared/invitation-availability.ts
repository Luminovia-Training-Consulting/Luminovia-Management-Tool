/** The account invitation route requires an explicitly enabled, allowlisted application origin. */
export function invitationsAvailable(
  enabled: string | undefined,
  appOrigin: string,
  origins: readonly string[],
) {
  return enabled === "true" && origins.includes(appOrigin);
}
