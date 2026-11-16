/** Own loopback Deno HTTP listener using the exact deployed environment adapter. */
/* global Deno */
import { websiteEnquiryRuntime } from "../../supabase/functions/website-enquiries/runtime.ts";
if (Deno.env.get("PORTAL_TEST_MODE") !== "1")
  throw Error("Only canonical isolated enquiry HTTP tests");
const url = new URL(Deno.env.get("SUPABASE_URL") ?? "");
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  url.port !== "55321"
)
  throw Error("Only canonical loopback enquiry backend");
const project = await Deno.readTextFile("supabase/config.toml");
if (!/^project_id\s*=\s*"luminovia-portal-test-[a-f0-9]+"/m.test(project))
  throw Error("Only canonical owned enquiry project");
Deno.serve(
  {
    hostname: "127.0.0.1",
    port: 0,
    onListen: ({ port }) => console.log(`PORTAL_ENQUIRY_TEST_PORT=${port}`),
  },
  websiteEnquiryRuntime((name) => Deno.env.get(name)),
);
