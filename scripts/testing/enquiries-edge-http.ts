/** Own loopback Deno HTTP listener using the exact deployed environment adapter. */
/* global Deno */
import {websiteEnquiryRuntime} from "../../supabase/functions/website-enquiries/runtime.ts";

if (Deno.env.get("PORTAL_TEST_MODE") !== "1")
    throw Error("Only isolated enquiry HTTP tests");
const url = new URL(Deno.env.get("SUPABASE_URL") ?? "");
const config = await Deno.readTextFile("supabase/config.toml");
const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    config,
)?.[1];
// The Node API fixture confirms the native candidate's exact endpoint and real
// Docker ownership label before spawning this listener. Require that same tuple
// and its config here; a flag alone never substitutes for the parent fixture.
if (
    !project ||
    project !== Deno.env.get("PORTAL_ENQUIRY_TEST_PROJECT") ||
    url.origin !== Deno.env.get("PORTAL_ENQUIRY_TEST_API_ORIGIN") ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
)
    throw Error("Only confirmed owned loopback enquiry backend");
const candidateOwner = Deno.env.get("PORTAL_CANDIDATE_OWNER");
if (candidateOwner) {
    if (
        !/^luminovia-portal-test-[a-f0-9]{24}$/.test(project) ||
        candidateOwner !== project ||
        Deno.env.get("PORTAL_DB_CONTAINER") !== `supabase_db_${project}` ||
        url.protocol !== "https:" ||
        url.hostname !== "127.0.0.1" ||
        Number(url.port) <= 1024
    )
        throw Error("Only confirmed owned native enquiry backend");
} else if (Deno.env.get("PORTAL_TEST_RANDOM_SERVICE_PORTS") === "1") {
    const api = /\[api\]([\s\S]*?)(?=\n\[|$)/.exec(config)?.[1] ?? "";
    const port = /^port\s*=\s*(\d+)/m.exec(api)?.[1];
    // The parent already verified the bound gateway and Mailpit against Docker.
    // Require that same project and its configured API port at the listener.
    if (
        !/^luminovia-portal-test-[a-f0-9]{8}$/.test(project) ||
        Deno.env.get("PORTAL_DB_CONTAINER") !== `supabase_db_${project}` ||
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        !port ||
        url.port !== port
    )
        throw Error("Only confirmed owned random-port enquiry backend");
} else if (url.protocol !== "http:" || url.port !== "55321") {
    throw Error("Only canonical loopback enquiry backend");
}
Deno.serve(
    {
        hostname: "127.0.0.1",
        port: 0,
        onListen: ({port}) => console.log(`PORTAL_ENQUIRY_TEST_PORT=${port}`),
    },
    websiteEnquiryRuntime((name) => Deno.env.get(name)),
);
