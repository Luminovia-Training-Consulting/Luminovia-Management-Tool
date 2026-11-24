import { db } from "../../lib/supabase";

/** Exchange an email and password for one native Supabase Auth session. */
export async function signInHuman(identifier: string, password: string) {
  const { data, error } = await db().functions.invoke("human-login", {
    body: { identifier, password },
  });
  if (
    error ||
    !data ||
    typeof data.access_token !== "string" ||
    typeof data.refresh_token !== "string"
  )
    throw new Error("login_failed");
  const session = await db().auth.setSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });
  if (session.error || !session.data.session) throw new Error("login_failed");
}
