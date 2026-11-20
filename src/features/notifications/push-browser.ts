// Persist only the opaque push binding; identity generations fence asynchronous
// IndexedDB and browser operations when Auth switches accounts or logs out.
interface Binding {
    actor: string;
    token: string;
}

const database = "luminovia-push-binding";
let revision = 0;
let currentActor: string | null | undefined;
const transactions = new Set<IDBTransaction>();

function cancelTransactions() {
    for (const transaction of transactions) {
        try {
            transaction.abort();
        } catch {
            // A completed transaction cannot write after this identity boundary.
        }
    }
    transactions.clear();
}

async function storage(
    value?: Binding | null,
    valid?: () => boolean,
): Promise<Binding | null> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(database, 1);
        open.onupgradeneeded = () => open.result.createObjectStore("binding");
        open.onerror = () => reject(new Error("push_storage_unavailable"));
        open.onsuccess = () => {
            const db = open.result;
            if (valid && !valid()) {
                db.close();
                reject(new DOMException("Push identity changed", "AbortError"));
                return;
            }
            const transaction = db.transaction(
                "binding",
                value === undefined ? "readonly" : "readwrite",
            );
            transactions.add(transaction);
            const table = transaction.objectStore("binding");
            const request =
                value === undefined
                    ? table.get("current")
                    : value === null
                        ? table.delete("current")
                        : table.put(value, "current");
            let result: Binding | null = null;
            request.onsuccess = () => {
                result =
                    value === undefined ? (request.result ?? null) : (value ?? null);
            };
            transaction.oncomplete = () => {
                transactions.delete(transaction);
                db.close();
                resolve(result);
            };
            transaction.onabort = transaction.onerror = () => {
                transactions.delete(transaction);
                db.close();
                reject(new Error("push_storage_unavailable"));
            };
        };
    });
}

export function pushSupported() {
    return (
        typeof window !== "undefined" &&
        window.isSecureContext &&
        "Notification" in window &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "indexedDB" in window
    );
}

export function pushCapability() {
    const ios =
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (ios && !standalone) return "install" as const;
    if (!pushSupported()) return "unsupported" as const;
    if (Notification.permission === "denied") return "blocked" as const;
    return "ready" as const;
}

/** Auth calls this before exposing the next session; late old-device writes fail. */
export async function synchronizePushActor(actor: string | null) {
    currentActor = actor;
    const stamp = ++revision;
    cancelTransactions();
    if (!pushSupported()) return;
    const valid = () => stamp === revision;
    try {
        const old = await storage(undefined, valid);
        if (stamp !== revision || (old && old.actor === actor)) return;
        await storage(null, valid);
        if (!valid()) return;
        const registration = await navigator.serviceWorker.getRegistration();
        if (!valid()) return;
        const subscription = await registration?.pushManager.getSubscription();
        if (stamp === revision) await subscription?.unsubscribe();
        const notifications = await registration?.getNotifications();
        if (stamp === revision)
            notifications?.forEach((notification) => notification.close());
    } catch {
        /* A missing binding suppresses push; no private fallback cache. */
    }
}

/** Bind only after server registration, without allowing a delayed old actor write. */
export async function bindPushDevice(actor: string, token: string) {
    if (currentActor !== undefined && currentActor !== actor)
        throw new Error("push_actor_changed");
    const stamp = ++revision;
    await storage(
        {actor, token},
        () =>
            stamp === revision &&
            (currentActor === undefined || currentActor === actor),
    );
}

/** Remove the initiating actor's local binding; never clear a later login. */
export async function clearPushDevice(actor = currentActor) {
    if (actor !== currentActor) return;
    const stamp = ++revision;
    cancelTransactions();
    const valid = () => stamp === revision && actor === currentActor;
    await storage(null, valid);
    if (!valid()) return;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!valid()) return;
    const subscription = await registration?.pushManager.getSubscription();
    if (!valid()) return;
    await subscription?.unsubscribe();
    const notifications = await registration?.getNotifications();
    if (valid()) notifications?.forEach((notification) => notification.close());
}

export async function currentPushToken(actor: string) {
    const stamp = revision;
    const valid = () =>
        stamp === revision &&
        (currentActor === undefined || currentActor === actor);
    if (!valid()) return null;
    const value = await storage();
    if (!valid() || value?.actor !== actor) return null;
    const registration = await navigator.serviceWorker.getRegistration();
    if (!valid()) return null;
    const subscription = await registration?.pushManager.getSubscription();
    return valid() && subscription ? value.token : null;
}

/** Request permission only from the explicit action and renew rotated VAPID keys. */
export async function browserSubscription(publicKey: string) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) throw new Error("push_pwa_required");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("push_permission_denied");
    const bytes = Uint8Array.from(
        atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + "="),
        (character) => character.charCodeAt(0),
    );
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
        const previous = new Uint8Array(
            existing.options.applicationServerKey ?? new ArrayBuffer(0),
        );
        if (
            previous.length === bytes.length &&
            previous.every((value, index) => value === bytes[index])
        )
            return existing;
        await existing.unsubscribe();
    }
    return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes,
    });
}