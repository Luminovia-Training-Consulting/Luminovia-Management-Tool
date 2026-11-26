/** Serve the isolated, cookie-free H5P runtime behind wildcard HTTPS. */
import { createServer } from "node:http";
import { opendir, readFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.LUMINOVIA_H5P_PORT ?? "6212");
const portal = new URL(process.env.LUMINOVIA_H5P_PORTAL_ORIGIN ?? "");
const suffix = process.env.LUMINOVIA_H5P_CONTENT_HOST_SUFFIX ?? "";
const localTestPortal =
  process.env.PORTAL_TEST_MODE === "1" &&
  /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(portal.origin);
if (
  portal.origin !== portal.href.slice(0, -1) ||
  (portal.protocol !== "https:" && !localTestPortal) ||
  portal.username ||
  portal.password ||
  !/^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+){2,}$/.test(suffix) ||
  portal.hostname === suffix ||
  portal.hostname.endsWith("." + suffix)
)
  throw new Error(
    "Configure distinct HTTPS portal and wildcard content domains",
  );
const launchHost = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".eot": "font/eot",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};
const policy = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self'",
  "font-src 'self'",
  "worker-src 'self'",
  "frame-src 'self' about:",
  `frame-ancestors 'self' ${portal.origin}`,
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
].join("; ");
const staticHeaders = {
  "Content-Security-Policy": policy,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};
const names = new Set([
  "index.html",
  "launch.mjs",
  "virtual-files.js",
  "content-policy.mjs",
  "catalogue.json",
]);
for (const directory of ["player", "libraries"]) {
  async function register(base, route) {
    const listing = await opendir(base);
    for await (const item of listing) {
      const next = route + "/" + item.name;
      if (item.isDirectory()) await register(join(base, item.name), next);
      else if (item.isFile() && types[extname(item.name)]) names.add(next);
    }
  }
  await register(join(root, directory), directory);
}

const server = createServer(async (request, response) => {
  const host = request.headers.host ?? "";
  const label = host.endsWith("." + suffix)
    ? host.slice(0, -suffix.length - 1)
    : "";
  if (
    !launchHost.test(label) ||
    request.method !== "GET" ||
    !request.url?.startsWith("/h5p/")
  ) {
    response.writeHead(404, staticHeaders).end();
    return;
  }
  try {
    const url = new URL(request.url, "http://localhost");
    const route =
      decodeURIComponent(url.pathname.slice("/h5p/".length)) || "index.html";
    if (route === "configuration.json") {
      response
        .writeHead(200, { ...staticHeaders, "Content-Type": types[".json"] })
        .end(JSON.stringify({ portalOrigin: portal.origin }));
      return;
    }
    if (!names.has(route)) {
      response.writeHead(404, staticHeaders).end();
      return;
    }
    const bytes = await readFile(join(root, route));
    response
      .writeHead(200, {
        ...staticHeaders,
        "Content-Type": types[extname(route)],
        "Content-Length": bytes.length,
      })
      .end(bytes);
  } catch {
    response.writeHead(400, staticHeaders).end();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Isolated H5P runtime listening on loopback port ${server.address().port}`),
);
