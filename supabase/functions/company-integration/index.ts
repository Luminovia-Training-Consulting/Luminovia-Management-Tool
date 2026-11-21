import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createCompanyIntegrationHandler } from "./handler.ts";

const service = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve(createCompanyIntegrationHandler(async (input) => {
  const { data, error } = await service.rpc("integration_course_index", input);
  if (error) throw new Error("integration_unavailable");
  return data;
}));
