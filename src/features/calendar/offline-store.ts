// Explicitly opted-in teaching snapshots contain only titles, instants and zones.
// Auth generations and transaction cancellation prevent cross-account persistence.
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone } from "../../lib/dates";
import { calendarExportSchema } from "./ical";

const eventSchema = z
  .object({
    title: z.string().max(200),
    starts_at: z.string().datetime({ offset: true }),
    ends_at: z.string().datetime({ offset: true }),
    time_zone: z.string().refine(validZone),
  })
  .strict();
export const offlineScheduleSchema = z
  .object({
    actor: z.string().uuid(),
    saved_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
    items: z.array(eventSchema).max(500),
  })
  .strict();
export type OfflineScheduleSnapshot = z.infer<typeof offlineScheduleSchema>;
let identity: string | null | undefined;
let generation = 0;
let serial: Promise<unknown> = Promise.resolve();
let storeRevision = 0;
const listeners = new Set<() => void>(),
  requests = new Set<AbortController>(),
  transactions = new Set<IDBTransaction>();

function announce() {
  storeRevision++;
  for (const listener of listeners) listener();
}

export function subscribeOfflineSchedule(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const offlineScheduleRevision = () => storeRevision;

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = serial.then(operation, operation);
  serial = result.then(
    () => {},
    () => {},
  );
  return result;
}

/** Validate delayed database opens before creating any transaction or write. */
function stored(
  value?: OfflineScheduleSnapshot | null,
  valid?: () => boolean,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("luminovia-offline-schedule", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("snapshot");
    open.onerror = () => reject(new Error("offline_storage_unavailable"));
    open.onsuccess = () => {
      const database = open.result;
      if (valid && !valid()) {
        database.close();
        reject(new DOMException("Offline storage cancelled", "AbortError"));
        return;
      }
      const transaction = database.transaction(
        "snapshot",
        value === undefined ? "readonly" : "readwrite",
      );
      transactions.add(transaction);
      const table = transaction.objectStore("snapshot"),
        request =
          value === undefined
            ? table.get("current")
            : value === null
              ? table.clear()
              : table.put(value, "current");
      let result: unknown = null;
      request.onsuccess = () => {
        result = value === undefined ? request.result : value;
      };
      transaction.oncomplete = () => {
        transactions.delete(transaction);
        database.close();
        resolve(result);
      };
      transaction.onabort = transaction.onerror = () => {
        transactions.delete(transaction);
        database.close();
        reject(new DOMException("Offline storage cancelled", "AbortError"));
      };
    };
  });
}

/** Called synchronously BEFORE Auth exposes another identity or clears it. */
export function synchronizeOfflineActor(actor: string | null) {
  if (identity === actor) return;
  const initial = identity === undefined;
  identity = actor;
  generation++;
  for (const request of requests) request.abort();
  requests.clear();
  for (const transaction of transactions) {
    try {
      transaction.abort();
    } catch {
      // Completed transactions have no remaining writes to cancel.
    }
  }
  transactions.clear();
  announce();
  if (typeof indexedDB === "undefined") return;
  if (!initial || actor === null) {
    void enqueue(() => stored(null)).catch(() => {});
    return;
  }
  const stamp = generation;
  void enqueue(async () => {
    const previous = await stored();
    if (stamp !== generation) return;
    if (
      !previous ||
      typeof previous !== "object" ||
      !("actor" in previous) ||
      previous.actor !== actor
    )
      await stored(null);
  }).catch(() => {});
}

/** Return only this actor's unexpired snapshot; corrupt or foreign data is cleared. */
export async function readOfflineSchedule(
  actor: string,
  now = Date.now(),
): Promise<OfflineScheduleSnapshot | null> {
  if (identity !== actor) return null;
  const stamp = generation;
  const raw = await enqueue(() => stored());
  if (identity !== actor || generation !== stamp) return null;
  const parsed = offlineScheduleSchema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.actor !== actor ||
    Date.parse(parsed.data.expires_at) <= now ||
    Date.parse(parsed.data.saved_at) > now + 60000 ||
    Date.parse(parsed.data.expires_at) - Date.parse(parsed.data.saved_at) >
      7 * 86400000
  ) {
    await enqueue(() => stored(null));
    return null;
  }
  return parsed.data;
}

/** Clear every snapshot and abort pending requests, including while offline. */
export async function clearOfflineSchedule() {
  generation++;
  for (const request of requests) request.abort();
  requests.clear();
  for (const transaction of transactions) {
    try {
      transaction.abort();
    } catch {
      // Completed transactions have no remaining writes to cancel.
    }
  }
  transactions.clear();
  await enqueue(() => stored(null));
  announce();
}

/** Verify the server identity and fetch afresh before storing the strict whitelist. */
export async function refreshOfflineSchedule(actor: string) {
  requireOnline();
  if (identity !== actor) throw new Error("offline_actor_changed");
  const stamp = generation;
  const controller = new AbortController();
  requests.add(controller);
  try {
    const verified = await db().auth.getUser();
    if (
      verified.error ||
      verified.data.user?.id !== actor ||
      controller.signal.aborted ||
      identity !== actor ||
      stamp !== generation
    )
      throw new Error("offline_verified_identity_required");
    const start = DateTime.utc().startOf("day");
    const { data, error } = await db()
      .rpc("export_my_calendar", {
        p_from: start.toISO(),
        p_until: start.plus({ days: 30 }).toISO(),
        p_include_private: false,
      })
      .abortSignal(controller.signal);
    if (error) throw error;
    if (controller.signal.aborted || identity !== actor || stamp !== generation)
      throw new DOMException("Offline snapshot cancelled", "AbortError");
    const events = calendarExportSchema.parse(data);
    if (events.some((event) => event.kind !== "assignment"))
      throw new Error("offline_private_event_rejected");
    const now = Date.now();
    const snapshot = offlineScheduleSchema.parse({
      actor,
      saved_at: new Date(now).toISOString(),
      expires_at: new Date(now + 7 * 86400000).toISOString(),
      items: events.map((event) => ({
        title: event.title,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        time_zone: event.time_zone,
      })),
    });
    await enqueue(async () => {
      if (
        controller.signal.aborted ||
        identity !== actor ||
        stamp !== generation
      )
        throw new DOMException("Offline snapshot cancelled", "AbortError");
      await stored(
        snapshot,
        () =>
          !controller.signal.aborted &&
          identity === actor &&
          stamp === generation,
      );
      if (
        controller.signal.aborted ||
        identity !== actor ||
        stamp !== generation
      )
        throw new DOMException("Offline snapshot cancelled", "AbortError");
    });
    announce();
    return snapshot;
  } finally {
    requests.delete(controller);
  }
}
