/** State shared by the portal's explicit sign-out controls. */
import { useRef, useState } from "react";
import { db } from "../../lib/supabase";

/** Keep one request in flight and preserve the session UI on returned or rejected failures. */
export function useSignOut(onSignedOut?: () => void) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setFailed(false);
    setPending(true);
    try {
      const { error } = await db().auth.signOut({ scope: "local" });
      if (error) throw error;
      onSignedOut?.();
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { pending, failed, signOut };
}
