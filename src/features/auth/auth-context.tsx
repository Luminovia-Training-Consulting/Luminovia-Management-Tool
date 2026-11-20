/**
 * React's shared binding to native Supabase session state. Auth events outrank a late initial
 * lookup; identity changes clear private queries before rendering the new actor.
 */
/* eslint-disable react-refresh/only-export-components */
import {createContext, type ReactNode, useContext, useEffect, useRef, useState,} from "react";
import type {Session} from "@supabase/supabase-js";
import {useQueryClient} from "@tanstack/react-query";
import {supabase} from "../../lib/supabase";
import {synchronizePushActor} from "../notifications/push-browser";
import {synchronizeOfflineActor} from "../calendar/offline-store";

/** Session state with distinct initial-loading and initial-lookup failure flags. */
interface AuthState {
    session: Session | null;
    loading: boolean;
    error: boolean;
}

/** Shared context with no fabricated fallback session; without a provider it stays loading. */
const AuthContext = createContext<AuthState>({
    session: null,
    loading: true,
    error: false,
});

/** Synchronize native Auth events and initial lookup; an older result must not overwrite a newer event. */
export function AuthProvider({children}: { children: ReactNode }) {
    const [state, setState] = useState<AuthState>({
        session: null,
        loading: Boolean(supabase),
        error: false,
    });
    const client = useQueryClient();
    const actor = useRef<string | null>(null);
    useEffect(() => {
        if (!supabase) {
            synchronizeOfflineActor(null);
            void synchronizePushActor(null);
            return;
        }
        let alive = true;
        let revision = 0;
        // Clear the previous actor's query cache before publishing the new session.
        // Otherwise new components could briefly observe another actor's retained private data.
        const applySession = (session: Session | null, error = false) => {
            synchronizeOfflineActor(session?.user.id ?? null);
            void synchronizePushActor(session?.user.id ?? null);
            if (actor.current !== (session?.user.id ?? null)) {
                client.clear();
                actor.current = session?.user.id ?? null;
            }
            setState({session, loading: false, error});
        };
        const {
            data: {subscription},
        } = supabase.auth.onAuthStateChange((event, session) => {
            if (!alive) return;
            // Every native Auth event supersedes the pending initial lookup.
            revision++;
            applySession(session);
            if (event === "SIGNED_OUT") {
                client.clear();
            }
            if (event === "TOKEN_REFRESHED")
                void client.invalidateQueries({queryKey: ["permissions"]});
        });
        const initialRevision = revision;
        // The initial read is only a fallback. A later sign-out/actor switch is
        // authoritative even when storage or token refresh resolves out of order.
        void supabase.auth
            .getSession()
            .then(({data, error}) => {
                if (alive && revision === initialRevision)
                    applySession(data.session, Boolean(error));
            })
            .catch(() => {
                if (alive && revision === initialRevision) applySession(null, true);
            });
        // Late promises must not publish a session after this provider unmounts.
        return () => {
            alive = false;
            subscription.unsubscribe();
        };
    }, [client]);
    return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

/** Read the session/loading/error state maintained by the shared AuthProvider. */
export const useAuth = () => useContext(AuthContext);