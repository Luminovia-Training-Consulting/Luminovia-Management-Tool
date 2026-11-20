/** Private environment/service adapter; no server key is returned by the HTTP handler. */
import {createClient} from "npm:@supabase/supabase-js@2.119.0";
import {createWebsiteEnquiryHandler} from "./handler.ts";

/** Environment adapter shared by the deployed worker and isolated HTTP tests. */
export function websiteEnquiryRuntime(
    env: (name: string) => string | undefined,
) {
    const url = env("SUPABASE_URL") ?? "";
    const key = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const service =
        url && key
            ? createClient(url, key, {
                auth: {persistSession: false, autoRefreshToken: false},
            })
            : null;
    return createWebsiteEnquiryHandler(
        {
            enabled: env("PORTAL_WEBSITE_ENQUIRIES_ENABLED") === "true",
            integrationToken: env("PORTAL_WEBSITE_INTEGRATION_TOKEN") ?? "",
            websiteOrigin: env("PORTAL_WEBSITE_ORIGIN") ?? "",
            privacyNoticeVersion: env("PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION") ?? "",
        },
        {
            receive: async (sender, submission, payload) => {
                if (!service) return {data: null, error: {code: "unavailable"}};
                return await service.rpc("receive_website_enquiry", {
                    p_sender_hash: sender,
                    p_submission_id: submission,
                    p_payload: payload,
                });
            },
        },
    );
}