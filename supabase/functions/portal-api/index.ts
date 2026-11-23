import {
  portalHttpMethods,
  portalHttpPutTargets,
  portalHttpPutVersions,
} from "../_shared/portal-http-methods.ts";
import { createPortalHttpHandler } from "./handler.ts";

Deno.serve(createPortalHttpHandler({
  backend: Deno.env.get("SUPABASE_URL") ?? "",
  publicKey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
  origins: (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
    .split(",").map((origin) => origin.trim()).filter(Boolean),
  operations: portalHttpMethods,
  putTargets: portalHttpPutTargets,
  putVersions: portalHttpPutVersions,
}));
