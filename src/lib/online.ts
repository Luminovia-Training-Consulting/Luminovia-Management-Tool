/**
 * React-kompatible Beobachtung des Browser-Onlinestatus und früher Abbruch von Offlineaktionen. navigator.onLine ist ein Bedienhinweis und garantiert keine Servererreichbarkeit; Erfolg braucht weiterhin die echte Antwort.
 */
import { useSyncExternalStore } from "react";
/** Registriert genau die beiden Browser-Netzwerkereignisse und liefert deren symmetrische Abmeldung. */
const subscribe = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};
/** Abonniert Browser-online/offline-Ereignisse über useSyncExternalStore mit passendem Unsubscribe. */
export const useOnline = () =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
/** Bricht im bekannten Offlinezustand vor einer Mutation ab; verbleibende Netzfehler behandelt der tatsächliche Aufruf. */
export function requireOnline() {
  if (!navigator.onLine) throw new Error("offline");
}
