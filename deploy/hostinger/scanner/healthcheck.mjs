/**
 * Container readiness probe for the scanner gateway's configured localhost health URL. Success does not validate a particular upload.
 */
import { readToken } from "./server.mjs";

try {
  const response = await fetch(
    `http://127.0.0.1:${process.env.PORT ?? 8080}/health`,
    {
      headers: { Authorization: `Bearer ${readToken()}` },
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    },
  );
  // A scan in progress temporarily consumes the sole operation slot.
  // It is not evidence that the gateway is unhealthy.
  if (response.status === 503) {
    const value = await response.json();
    process.exitCode = value.error === "scanner_busy" ? 0 : 1;
  } else {
    process.exitCode =
      response.ok && (await response.json()).ready === true ? 0 : 1;
  }
} catch {
  process.exitCode = 1;
}
