/** Read package assets from the active launch page's memory without persisting them. */
const prefix = "/h5p/session/";
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
      if (event.request.method !== "GET")
        return new Response(null, { status: 405 });
      const windows = await self.clients.matchAll({ type: "window" });
      const source = windows.find((candidate) => {
        const current = new URL(candidate.url);
        return (
          current.origin === self.location.origin &&
          current.pathname === "/h5p/"
        );
      });
      if (!source) return new Response(null, { status: 404 });

      const transfer = new MessageChannel();
      const asset = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        transfer.port1.onmessage = ({ data }) => {
          clearTimeout(timer);
          resolve(data);
        };
        source.postMessage({ path: url.pathname }, [transfer.port2]);
      });
      transfer.port1.close();
      if (!asset) return new Response(null, { status: 404 });
      const size = asset.bytes.byteLength;
      const headers = {
        "Content-Type": asset.type,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
        "Content-Length": String(size),
      };
      const range = event.request.headers.get("Range");
      if (range === null) return new Response(asset.bytes, { headers });
      const match = /^bytes=(\d{1,12})-(\d{0,12})$/.exec(range);
      const first = match ? Number(match[1]) : size;
      const last = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (first > last)
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      return new Response(asset.bytes.slice(first, last + 1), {
        status: 206,
        headers: {
          ...headers,
          "Content-Length": String(last - first + 1),
          "Content-Range": `bytes ${first}-${last}/${size}`,
        },
      });
    })(),
  );
});
