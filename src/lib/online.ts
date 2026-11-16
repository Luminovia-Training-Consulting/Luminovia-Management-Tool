/**
 * React-compatible browser connectivity observation and early rejection of known offline
 * actions. navigator.onLine is a UX hint, not proof of server reachability; success still
 * requires the actual response.
 */
import { useSyncExternalStore } from "react";
/** Subscribe to the two browser network events and return their matching cleanup. */
const subscribe = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
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
