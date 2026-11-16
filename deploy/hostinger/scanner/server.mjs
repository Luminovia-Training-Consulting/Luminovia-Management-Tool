/**
 * Authentifiziertes HTTP-Gateway vor dem privaten clamd. Begrenzt Header, Uploadgröße, Parallelität und Laufzeit; nur ein expliziter ClamAV-Befund wird als Scanergebnis ausgegeben.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createClamavScanner, MAX_BYTES, validateVersion } from "./clamav.mjs";

// Lädt ausschließlich den serverseitigen Gateway-Token und verweigert eine unbrauchbare Konfiguration.
export function readToken(environment = process.env) {
  const value = environment.PORTAL_SCANNER_TOKEN;
  const file = environment.PORTAL_SCANNER_TOKEN_FILE;
  if (!!value === !!file) throw new Error("scanner_token_configuration");
  const token = file ? readFileSync(file, "utf8").trim() : value;
  // 32 random bytes encoded as base64url (43 chars) or hex (64 chars).
  // Entropy is supplied by the deployment generator, never a committed token.
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token ?? ""))
    throw new Error("scanner_token_configuration");
  return token;
}

// Bildet Bearerwerte auf gleich lange SHA-256-Puffer ab, damit timingSafeEqual keinen direkten Längenvergleich des Tokens benötigt.
function digest(value) {
  return createHash("sha256").update(value).digest();
}

// Schreibt die begrenzte JSON-Antwort samt explizitem HTTP-Status und Sicherheitsheadern.
function json(response, status, value, extraHeaders = {}) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  response.end(JSON.stringify(value));
}

// Beendet eine abgewiesene Request-Verbindung nach der Antwort, damit Restbytes nicht als weiterer Upload fortgesetzt werden.
function closeAfterReply(request, response) {
  response.setHeader("Connection", "close");
  response.once("finish", () => request.destroy());
}

// Zählt echte rohe Headerfelder; zusammengeführte Headerwerte würden doppelte Auth-/Längenangaben verdecken.
function headerCount(request, name) {
  let count = 0;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === name) count++;
  }
  return count;
}

// Erzeugt das begrenzte Scan-Gateway mit injizierbarem Adapter, Authentifizierung und kontrollierter Belegung.
export function createScannerServer({
  token,
  scanner = createClamavScanner(),
  uploadTimeoutMs = 15000,
  operationTimeoutMs = 30000,
  rateWindowMs = 60000,
  maxRequestsPerWindow = 60,
} = {}) {
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token ?? ""))
    throw new Error("scanner_token_configuration");
  const expected = digest(`Bearer ${token}`);
  let active = false;
  let rateStarted = Date.now();
  let rateRequests = 0;
  const server = createServer(
    { maxHeaderSize: 8192 },
    async (request, response) => {
      const authorization = request.headers.authorization;
      if (
        headerCount(request, "authorization") !== 1 ||
        typeof authorization !== "string" ||
        !timingSafeEqual(expected, digest(authorization))
      ) {
        closeAfterReply(request, response);
        json(response, 401, { error: "unauthorized" });
        return;
      }
      // Origins are not used as authorization. Reject browser-originated traffic
      // and preflight; the caller is a server-side Supabase Edge Function.
      if (request.headers.origin) {
        closeAfterReply(request, response);
        json(response, 403, { error: "origin_not_allowed" });
        return;
      }
      const health = request.method === "GET" && request.url === "/health";
      const scan = request.method === "POST" && request.url === "/scan";
      if (!health && !scan) {
        closeAfterReply(request, response);
        json(response, 404, { error: "not_found" });
        return;
      }
      if (Date.now() - rateStarted >= rateWindowMs) {
        rateStarted = Date.now();
        rateRequests = 0;
      }
      if (++rateRequests > maxRequestsPerWindow) {
        closeAfterReply(request, response);
        json(response, 429, { error: "rate_limited" }, { "Retry-After": "60" });
        return;
      }
      // Health checks share the one-operation limit, preventing overlapping
      // signature probes/scans from taking memory away from a small VPS.
      if (active) {
        closeAfterReply(request, response);
        json(response, 503, { error: "scanner_busy" }, { "Retry-After": "2" });
        return;
      }
      if (
        scan &&
        request.headers["content-type"] !== "application/octet-stream"
      ) {
        closeAfterReply(request, response);
        json(response, 415, { error: "unsupported_media_type" });
        return;
      }
      const lengthHeader = request.headers["content-length"];
      const declaredLength =
        lengthHeader === undefined ? null : Number(lengthHeader);
      if (
        scan &&
        declaredLength !== null &&
        (!/^\d+$/.test(lengthHeader) ||
          !Number.isSafeInteger(declaredLength) ||
          declaredLength < 1 ||
          declaredLength > MAX_BYTES)
      ) {
        closeAfterReply(request, response);
        json(response, 413, { error: "file_size" });
        return;
      }
      active = true;
      let operationExpired = false;
      let uploadDeadline;
      const operationDeadline = setTimeout(() => {
        operationExpired = true;
        closeAfterReply(request, response);
        json(response, 503, { error: "scanner_unavailable" });
      }, operationTimeoutMs);
      try {
        if (health) {
          validateVersion(await scanner.version());
          if (!operationExpired) json(response, 200, { ready: true });
          return;
        }
        const chunks = [];
        let size = 0;
        let uploadExpired = false;
        uploadDeadline = setTimeout(() => {
          uploadExpired = true;
          closeAfterReply(request, response);
          json(response, 408, { error: "upload_timeout" });
        }, uploadTimeoutMs);
        for await (const chunk of request) {
          if (uploadExpired || operationExpired) return;
          size += chunk.length;
          if (size > MAX_BYTES) {
            closeAfterReply(request, response);
            json(response, 413, { error: "file_size" });
            return;
          }
          chunks.push(chunk);
        }
        clearTimeout(uploadDeadline);
        if (!size || (declaredLength !== null && size !== declaredLength)) {
          json(response, 400, { error: "file_size" });
          return;
        }
        if (uploadExpired || operationExpired) return;
        const result = await scanner.scan(Buffer.concat(chunks, size));
        if (
          !result ||
          typeof result.clean !== "boolean" ||
          typeof result.version !== "string"
        ) {
          throw new Error("scanner_protocol");
        }
        validateVersion(result.version);
        if (!operationExpired)
          json(response, 200, { clean: result.clean, version: result.version });
      } catch {
        // Never include request bodies, token values, file names or upstream
        // error strings in an HTTP response or application log.
        json(response, 503, { error: "scanner_unavailable" });
      } finally {
        clearTimeout(uploadDeadline);
        clearTimeout(operationDeadline);
        active = false;
      }
    },
  );
  server.requestTimeout = Math.max(uploadTimeoutMs + 1000, 2000);
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxRequestsPerSocket = 1;
  server.maxConnections = 32;
  server.on("clientError", (_error, socket) => {
    if (socket.writable)
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const port = Number(process.env.PORT ?? 8080);
    const clamdPort = Number(process.env.SCANNER_CLAMAV_PORT ?? 3310);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("scanner_configuration");
    const scanner = createClamavScanner({
      host: process.env.SCANNER_CLAMAV_HOST ?? "clamav",
      port: clamdPort,
    });
    const server = createScannerServer({ token: readToken(), scanner });
    server.listen(port, "0.0.0.0");
    server.on("error", () => {
      process.stderr.write("Scanner gateway could not start.\n");
      process.exitCode = 1;
    });
    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        server.close();
        server.closeIdleConnections();
        const deadline = setTimeout(() => process.exit(1), 5000);
        deadline.unref();
      });
    }
  } catch {
    process.stderr.write("Scanner gateway configuration is invalid.\n");
    process.exitCode = 1;
  }
}
