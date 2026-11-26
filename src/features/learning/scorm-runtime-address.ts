/** Runtime launches use a fresh HTTPS origin that cannot equal the portal origin. */
export function scormRuntimeAddress(launch: string, parent: URL) {
  const domain = import.meta.env.VITE_SCORM_RUNTIME_DOMAIN as
    string | undefined;
  const local = import.meta.env.DEV
    ? (import.meta.env.VITE_SCORM_RUNTIME_TEST_ORIGIN as string | undefined)
    : undefined;
  if (
    local &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(local) &&
    parent.hostname === "127.0.0.1" &&
    local !== parent.origin
  )
    return new URL("/launch#" + launch, local);
  if (
    !domain ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain) ||
    parent.hostname === domain ||
    parent.hostname.endsWith("." + domain)
  )
    return null;
  return new URL(
    "https://" +
      launch.replaceAll("-", "") +
      "." +
      domain +
      "/launch#" +
      launch,
  );
}
