/**
 * Einzige React-Anbindung an den nativen Supabase-Sessionzustand. Auth-Ereignisse haben Vorrang vor einem verspäteten Initialabruf; ein Identitätswechsel entfernt private Query-Daten vor der neuen Anzeige.
 */
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
/** Sessionzustand mit getrenntem Initialladen und fehlgeschlagenem Initialabruf. */
interface AuthState {
  session: Session | null;
  loading: boolean;
  error: boolean;
}
/** Gemeinsamer Context ohne erfundene Ersatzsession; ohne Provider bleibt er im Ladezustand. */
const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  error: false,
});
/** Synchronisiert native Sessionereignisse und Initialabruf; ältere Ergebnisse dürfen neuere Auth-Ereignisse nicht überschreiben. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    loading: Boolean(supabase),
    error: false,
  });
  const client = useQueryClient();
  const actor = useRef<string | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    let revision = 0;
    // Erst den alten Akteurscache entfernen, dann die neue Session veröffentlichen.
    // Sonst könnten neue Komponenten kurzzeitig bereits geladene fremde Daten beobachten.
    const applySession = (session: Session | null, error = false) => {
      if (actor.current !== (session?.user.id ?? null)) {
        client.clear();
        actor.current = session?.user.id ?? null;
      }
      setState({ session, loading: false, error });
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      // Jedes echte Auth-Ereignis überholt den noch ausstehenden Initialabruf.
      revision++;
      applySession(session);
      if (event === "SIGNED_OUT") {
        client.clear();
      }
      if (event === "TOKEN_REFRESHED")
        void client.invalidateQueries({ queryKey: ["permissions"] });
    });
    const initialRevision = revision;
    // The initial read is only a fallback. A later sign-out/actor switch is
    // authoritative even when storage or token refresh resolves out of order.
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (alive && revision === initialRevision)
          applySession(data.session, Boolean(error));
      })
      .catch(() => {
        if (alive && revision === initialRevision) applySession(null, true);
      });
    // Späte Promises dürfen nach Unmount keine Session mehr veröffentlichen.
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [client]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
/** Liest den vom gemeinsamen AuthProvider gepflegten Session-/Lade-/Fehlerzustand. */
export const useAuth = () => useContext(AuthContext);
