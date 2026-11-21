import {createClient} from "npm:@supabase/supabase-js@2.119.0";
import {createCourseDocumentHandler} from "./handler.ts";
import {renderFactPdf} from "./pdf.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "",
    key = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = createClient(
    url,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    {auth: {persistSession: false, autoRefreshToken: false}},
);
const caller = (token: string) =>
    createClient(url, key, {
        global: {headers: {Authorization: `Bearer ${token}`}},
        auth: {persistSession: false, autoRefreshToken: false},
    });
const font = Deno.readFile(new URL("./assets/DejaVuSans.ttf", import.meta.url));
Deno.serve(
    createCourseDocumentHandler({
        origins: (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        authenticate: async (token) => {
            const user = caller(token);
            const result = await user.auth.getUser(token);
            if (result.error || !result.data.user) return false;
            const active = await user.rpc("portal_access");
            return !active.error && active.data === true;
        },
        rpc: async (token, name, args) => {
            const {data, error} = await caller(token).rpc(name, args);
            return {data, error};
        },
        wikiPath: async (id, version) => {
            const result = await service.rpc("wiki_attachment_storage_path", {
                p_id: id,
                p_version_id: version,
            });
            return result.error || typeof result.data !== "string"
                ? null
                : result.data;
        },
        download: async (path) => {
            const result = await service.storage.from("portal-clean").download(path);
            if (result.error || !result.data) throw new Error("resource_unavailable");
            return new Uint8Array(await result.data.arrayBuffer());
        },
        render: async (kind, facts) => await renderFactPdf(kind, facts, await font),
    }),
);
