import {createClient} from "npm:@supabase/supabase-js@2.119.0";
import {createCourseDocumentHandler} from "./handler.ts";

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
            return !active.error && active.data === true && result.data.user.id;
        },
        recordDownload: async (actor, resource) => {
            const {error} = await service.rpc("record_admin_file_download", {
                p_actor_id: actor,
                p_resource_id: resource,
            });
            if (error) throw new Error("document_unavailable");
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
        retainedPath: async (version, sha256) => {
            const result = await service.from("document_versions")
                .select("object_path")
                .eq("id", version).eq("status", "clean").eq("sha256", sha256)
                .maybeSingle();
            return result.error ? null : result.data?.object_path ?? null;
        },
        submissionPath: async (course, version) => {
            const result = await service.rpc("course_submission_storage_path", {
                p_run_id: course,
                p_version_id: version,
            });
            return result.error || typeof result.data !== "string" ? null : result.data;
        },
        download: async (path) => {
            const result = await service.storage.from("portal-clean").download(path);
            if (result.error || !result.data) throw new Error("resource_unavailable");
            return new Uint8Array(await result.data.arrayBuffer());
        },
        render: async (kind, facts) => {
            // Attachment downloads and CSV requests do not need the PDF runtime.
            const {renderPackagedFactPdf} = await import("./pdf.ts");
            return await renderPackagedFactPdf(kind, facts);
        },
    }),
);
