/* global self, URL, MessageChannel, Response, Headers */
/** Serve archive files from the live launcher at a private per-launch origin. */
const prefix = "/scorm/session/";

self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(prefix))
    return;

  event.respondWith(
    (async () => {
      if (!["GET", "HEAD"].includes(event.request.method))
        return new Response(null, { status: 405 });
      const clients = await self.clients.matchAll({ type: "window" });
      const launcher = clients.find(
        ({ url: address }) => new URL(address).pathname === "/launch",
      );
      if (!launcher) return new Response(null, { status: 404 });

      const transfer = new MessageChannel();
      const asset = await new Promise((resolve) => {
        const timer = self.setTimeout(() => resolve(null), 2000);
        transfer.port1.onmessage = ({ data }) => {
          self.clearTimeout(timer);
          resolve(data);
        };
        launcher.postMessage({ path: url.pathname.slice(prefix.length) }, [
          transfer.port2,
        ]);
      });
      transfer.port1.close();
      if (!asset) return new Response(null, { status: 404 });

      const size = asset.bytes.byteLength;
      const headers = new Headers({
        "Content-Type": asset.type,
        "Content-Security-Policy": asset.policy,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
        "Content-Length": String(size),
        "Referrer-Policy": "no-referrer",
        "Accept-Ranges": "bytes",
      });
      if (event.request.method === "HEAD")
        return new Response(null, { headers });
      const range = event.request.headers.get("range");
      if (range === null) return new Response(asset.bytes, { headers });
      const bounds = /^bytes=(\d{1,12})-(\d{0,12})$/.exec(range);
      const start = bounds ? Number(bounds[1]) : size;
      const end = bounds?.[2]
        ? Math.min(Number(bounds[2]), size - 1)
        : size - 1;
      if (start > end) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
      headers.set("Content-Length", String(end - start + 1));
      return new Response(asset.bytes.slice(start, end + 1), {
        status: 206,
        headers,
      });
    })(),
  );
});
