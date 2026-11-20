import {createClient} from "npm:@supabase/supabase-js@2.119.0";
import {createCalendarFeedHandler} from "./handler.ts";

const service = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {auth: {persistSession: false, autoRefreshToken: false}},
);
Deno.serve(createCalendarFeedHandler({
    snapshot: async (hash, signal) => {
        const {data, error} = await service.rpc(
            "calendar_subscription_snapshot",
            {p_token_hash: hash},
        ).abortSignal(signal);
        if (error) throw new Error("calendar_unavailable");
        return data;
    },
    recheck: async (hash, signal) => {
        const {data, error} = await service.rpc("recheck_calendar_subscription", {
            p_token_hash: hash,
        }).abortSignal(signal);
        return !error && data === true;
    },
}));