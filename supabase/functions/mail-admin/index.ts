/** Deno entry point for caller-authorized, relay-only SMTP/IMAP connection tests. */
import {createClient} from "npm:@supabase/supabase-js@2.119.0";
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

const origins = [
    appOrigin,
    ...(Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "").split(","),
]
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(value).origin);

const handler = createMailAdminHandler({
    origins,
    relayAvailable,
    queueTest: async (userToken, protocol) => {
        const userClient = createClient(supabaseUrl, anonKey, {
            auth: {persistSession: false, autoRefreshToken: false},
            global: {headers: {Authorization: `Bearer ${userToken}`}},
        });
        return await userClient.rpc("queue_mail_connection_test", {
            p_protocol: protocol,
        });
    },
    relayTest: async (testId) => {
        if (!relayUrl || !relayToken) throw new Error("Mail relay unavailable.");
        const result = await fetch(new URL("connection-test", relayUrl), {
            method: "POST",
            headers: {
                Authorization: `Bearer ${relayToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({test_id: testId}),
            signal: AbortSignal.timeout(20_000),
        });
        if (!result.ok) throw new Error("relay_test_failed");
        return await result.json();
    },
});

Deno.serve(handler);