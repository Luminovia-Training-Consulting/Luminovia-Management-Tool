/** Local cache partition only. Authorization always comes from the server. */
export function sessionCacheBoundary(accessToken: string | undefined) {
  try {
    const encoded = accessToken?.split(".")[1];
    if (!encoded) return null;
    const { session_id, aal } = JSON.parse(
      atob(encoded.replaceAll("-", "+").replaceAll("_", "/")),
    );
    if (
      typeof session_id === "string" &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(session_id) &&
      (aal === "aal1" || aal === "aal2")
    )
      return `${session_id}:${aal}`;
  } catch {
    // Session data from an older runtime may have no native cache boundary.
  }
  return null;
}
