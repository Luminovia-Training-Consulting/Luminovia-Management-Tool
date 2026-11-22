/** Recognize PostgreSQL's insufficient_privilege response by its SQLSTATE. */
export function isDatabasePermissionDenied(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "42501"
  );
}
