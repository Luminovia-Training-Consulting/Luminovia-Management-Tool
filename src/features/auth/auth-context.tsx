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
interface AuthState {
  session: Session | null;
  loading: boolean;
  error: boolean;
}
const AuthContext = createContext<AuthState>({
  session: null,
  loading: true,
  error: false,
});
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
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, [client]);
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
