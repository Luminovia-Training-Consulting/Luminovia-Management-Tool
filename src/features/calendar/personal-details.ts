/** Match the server's narrow URL grammar, then use the browser parser as a second check. */
export function privateMeetingHref(value: string): string | null {
  if (
    value.length > 2000 ||
    !/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^\s<>"\\]*)?$/.test(
      value,
    )
  )
    return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || Number(url.port) > 0)
      ? url.href
      : null;
  } catch {
    return null;
  }
}
