import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";

export const companyClassDirectorySchema = z.object({
  classes: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      meeting_url: z.string().nullable(),
    }),
  ),
  contact_id: z.uuid().nullable(),
  contacts: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
    }),
  ),
});

export const companyClassDirectoryQuery = (
  actor: string,
  organisationId: string,
) =>
  queryOptions({
    queryKey: ["company-class-directory", actor, organisationId],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("company_class_directory", { p_organisation_id: organisationId })
        .abortSignal(signal);
      if (error) throw error;
      return companyClassDirectorySchema.parse(data);
    },
  });
