/** Commercial teaching actions require an actual teaching role. Staff roles may coexist. */
export function hasTeachingRole(roles: readonly string[] | undefined) {
  return Boolean(
    roles?.some((role) => role === "lecturer" || role === "senior_lecturer"),
  );
}

/** Teaching offers can be viewed by teaching staff and by operational staff. */
export function hasJobStaffRole(roles: readonly string[] | undefined) {
  return (
    hasTeachingRole(roles) ||
    Boolean(
      roles?.some(
        (role) => role === "owner" || role === "admin" || role === "management",
      ),
    )
  );
}
