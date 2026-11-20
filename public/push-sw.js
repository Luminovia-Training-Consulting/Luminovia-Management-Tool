/* global self, indexedDB, URL */
// Notification data is deliberately generic. No API response/private file cache.
const bindingDatabase = "luminovia-push-binding";

function binding() {
    return new Promise((resolve) => {
        const open = indexedDB.open(bindingDatabase, 1);
        open.onupgradeneeded = () => open.result.createObjectStore("binding");
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
            const db = open.result;
            const request = db
                .transaction("binding")
                .objectStore("binding")
                .get("current");
            request.onsuccess = () => {
                resolve(request.result ?? null);
                db.close();
            };
            request.onerror = () => {
                resolve(null);
                db.close();
            };
        };
    });
}

self.addEventListener("push", (event) => {
    event.waitUntil(
        (async () => {
            let payload;
            try {
                payload = event.data?.json();
            } catch {
                return;
            }
            const current = await binding();
            if (
                !current ||
                !payload ||
                payload.token !== current.token ||
                !/^[0-9a-f-]{36}$/.test(payload.id ?? "") ||
                !["de", "en"].includes(payload.locale)
            )
                return;
            const german = payload.locale === "de";
            await self.registration.showNotification("Luminovia", {
                body: german
                    ? "Es gibt eine neue Meldung im Portal."
                    : "There is a new update in the portal.",
                icon: "/icons/icon-192.png",
                badge: "/icons/icon-192.png",
                tag: `luminovia-${payload.id}`,
                data: {path: "/notifications"},
            });
        })(),
    );
});
self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    // No push-controlled URL, token, signed link or account identifier is opened.
    event.waitUntil(
        (async () => {
            const destination = new URL("/notifications", self.location.origin).href;
            const windows = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true,
            });
            const existing = windows.find((client) =>
                client.url.startsWith(self.location.origin + "/"),
            );
            if (existing) {
                await existing.navigate(destination);
                await existing.focus();
            } else await self.clients.openWindow(destination);
        })(),
    );
});