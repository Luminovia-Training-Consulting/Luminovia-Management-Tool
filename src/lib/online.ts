/**
 * React-compatible browser connectivity observation and early rejection of known offline
 * actions. navigator.onLine is a UX hint, not proof of server reachability; success still
 * requires the actual response.
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function notifyConnectivity() {
  for (const listener of listeners) listener();
}

/** Share one browser listener pair regardless of the number of mounted controls. */
const subscribe = (callback: () => void) => {
  if (!listeners.size) {
    window.addEventListener("online", notifyConnectivity);
    window.addEventListener("offline", notifyConnectivity);
  }
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
    if (!listeners.size) {
      window.removeEventListener("online", notifyConnectivity);
      window.removeEventListener("offline", notifyConnectivity);
    }
  };
};
/** Observe online/offline events through useSyncExternalStore with the corresponding unsubscribe. */
export const useOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

/** Reject known offline mutations early; each actual request still handles remaining network failures. */
export function requireOnline() {
  if (!navigator.onLine) throw new Error("offline");
}
