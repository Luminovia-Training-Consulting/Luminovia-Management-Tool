import { FunctionsHttpError } from "@supabase/supabase-js";
import { db } from "../../lib/supabase";

/** Exchange credentials and install an independent native Auth session. */
export async function signInHuman(identifier: string, password: string) {
  const { data, error } = await db().functions.invoke("human-login", {
    body: { identifier, password },
  });
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status;
    if (status === 429) return "loginRateLimited";
    if (status === 400 || status === 401) return "loginFailed";
  }
  if (
    error ||
    !data ||
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string"
  )
    return "loginUnavailable";
  const session = await db().auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  return session.error || !session.data.session ? "loginUnavailable" : null;
}
