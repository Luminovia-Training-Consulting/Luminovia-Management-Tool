import { queryOptions } from "@tanstack/react-query";
import { installationBrand } from "../../lib/installation-brand";
import { db } from "../../lib/supabase";
import { academyLicenceReceiptSchema } from "./academy-licence-schema";

export function academyLicenceQuery(actor: string) {
  return queryOptions({
    queryKey: ["academy-licence", installationBrand.installationId, actor],
    enabled: Boolean(actor),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchInterval: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const client = db();
      const { data: session, error: sessionError } =
        await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (session.session?.user.id !== actor) return null;
      const { data, error } = await client
        .rpc("academy_licence_receipt")
        .setHeader("Authorization", "Bearer " + session.session.access_token)
        .abortSignal(signal);
      if (error?.code === "42501") return null;
      if (error) throw error;
      return academyLicenceReceiptSchema.parse(data);
    },
  });
}
