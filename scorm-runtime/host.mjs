/** Cookie-free SCORM 1.2 launcher. Serve only these immutable files on a dedicated wildcard host. */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { URL, pathToFileURL } from "node:url";
import process from "node:process";

const originPattern = /^https:\/\/[a-z0-9.-]+(?::[0-9]+)?$/;
const domainPattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const labelPattern = /^[a-f0-9]{32}$/;
const modules = new Map([
  ["/runner.mjs", await readFile(new URL("./runner.mjs", import.meta.url))],
  ["/api.mjs", await readFile(new URL("./api.mjs", import.meta.url))],
  [
    "/virtual-files.js",
    await readFile(new URL("./virtual-files.js", import.meta.url)),
  ],
]);

export function createScormHost({ portalOrigin, domain, localHost = null }) {
  const portal = new URL(portalOrigin);
  const local =
    localHost &&
    /^127\.0\.0\.1:[0-9]+$/.test(localHost) &&
    /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(portalOrigin) &&
    portal.host !== localHost;
  if (
    portalOrigin !== portal.origin ||
    (!local &&
      (localHost ||
        !originPattern.test(portalOrigin) ||
        !domainPattern.test(domain) ||
        portal.hostname.split(".").slice(-2).join(".") ===
          domain.split(".").slice(-2).join(".")))
  ) {
    throw new Error(
      "The SCORM launcher requires a separate approved runtime domain and portal origin.",
    );
  }
  const contentPolicy = [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    "frame-src 'self' about:",
    "connect-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self' " + portalOrigin,
    "sandbox allow-same-origin allow-scripts",
  ].join("; ");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="portal-origin" content="${portalOrigin}"><meta name="content-policy" content="${contentPolicy}"><title>SCORM 1.2</title><style>body{margin:0} iframe{width:100%;height:100vh;border:0;display:block}</style></head><body><script type="module" src="/runner.mjs"></script></body></html>`;
  const headers = {
    "Cache-Control": "no-store",
    "Content-Security-Policy": contentPolicy.replace(
      "worker-src 'none'",
      "worker-src 'self'",
    ),
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
  return createServer((request, response) => {
    const host = request.headers.host?.toLowerCase() ?? "";
    const domainSuffix = "." + domain;
    const accepted = local
      ? host === localHost
      : host.endsWith(domainSuffix) &&
        labelPattern.test(host.slice(0, -domainSuffix.length));
    const target = request.url;
    const body = target === "/launch" ? html : modules.get(target);
    if (
      !accepted ||
      request.headers.cookie !== undefined ||
      !body ||
      !["GET", "HEAD"].includes(request.method ?? "")
    ) {
      response.writeHead(404, headers).end();
      return;
    }
    response.writeHead(200, {
      ...headers,
      "Content-Type":
        target === "/launch"
          ? "text/html; charset=utf-8"
          : "text/javascript; charset=utf-8",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const host = createScormHost({
    domain: process.env.SCORM_RUNTIME_DOMAIN ?? "",
    portalOrigin: process.env.SCORM_PORTAL_ORIGIN ?? "",
  });
  host.listen(Number(process.env.SCORM_RUNTIME_PORT ?? 5761), "127.0.0.1");
}
