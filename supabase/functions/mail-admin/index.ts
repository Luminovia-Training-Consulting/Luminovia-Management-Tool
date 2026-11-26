/** Deno entry point for caller-authorized, relay-only SMTP/IMAP connection tests. */
import {createClient} from "npm:@supabase/supabase-js@2.119.0";
import { invitationsAvailable } from "../_shared/invitation-availability.ts";
import {createMailAdminHandler} from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const relaySetting = Deno.env.get("PORTAL_MAIL_RELAY_URL") ?? "";
const relayToken = Deno.env.get("PORTAL_MAIL_RELAY_CONTROL_TOKEN") ?? "";
const appOrigin = Deno.env.get("PORTAL_APP_ORIGIN") ?? "";
if (!supabaseUrl || !anonKey || !appOrigin)
    throw new Error("Mail relay configuration is unavailable.");
const relayUrl = relaySetting ? new URL(relaySetting) : null;
if (
    relayUrl &&
    (relayUrl.protocol !== "http:" ||
        relayUrl.hostname !== "mail-relay" ||
        relayUrl.port !== "8080" ||
        relayUrl.pathname !== "/")
)
    throw new Error("Mail relay configuration is invalid.");
const relayAvailable = Boolean(relayUrl && relayToken);

const allowedOrigins = (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
    .split(",").map((value) => value.trim()).filter(Boolean);
const origins = [appOrigin, ...allowedOrigins].map((value) => new URL(value).origin);
const caller = (token: string) => createClient(supabaseUrl, anonKey, {
    auth: {persistSession: false, autoRefreshToken: false},
    global: {headers: {Authorization: `Bearer ${token}`}},
});

const handler = createMailAdminHandler({
    origins,
    relayAvailable,
    invitationsEnabled: invitationsAvailable(
        Deno.env.get("PORTAL_INVITES_ENABLED"), appOrigin, allowedOrigins,
    ),
    authorizeStatus: async (token) => {
        const result = await caller(token).rpc("get_mail_configuration");
        if (result.error?.code === "42501") return false;
        if (result.error) throw new Error("mail_status_unavailable");
        return Boolean(result.data);
    },
    queueTest: async (userToken, protocol) => {
        return await caller(userToken).rpc("queue_mail_connection_test", {
            p_protocol: protocol,
        });
    },
    confirmedEmail: async (token) => {
        const {data, error} = await caller(token).auth.getUser(token);
        if (error && error.status !== 401 && error.status !== 403)
            throw new Error("mail_recipient_unavailable");
        return data.user?.email_confirmed_at ? data.user.email ?? null : null;
    },
    relayTest: async (testId, recipient) => {
        if (!relayUrl || !relayToken) throw new Error("Mail relay unavailable.");
        const result = await fetch(new URL("connection-test", relayUrl), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${relayToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({test_id: testId, ...(recipient && {recipient})}),
            signal: AbortSignal.timeout(20_000),
        });
        if (!result.ok) {
            await result.body?.cancel().catch(() => undefined);
            throw new Error("relay_test_failed");
        }
        return await result.json();
    },
});

Deno.serve(handler);