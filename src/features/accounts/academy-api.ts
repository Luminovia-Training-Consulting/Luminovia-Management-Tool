/** Caller-scoped access to local academy administration and account creation. */
import { queryOptions } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { accountRequest } from "./api";
import {
  academyAccountReceipt,
  academyAdministration,
  academyOrganisation,
} from "./academy-schema";

export const academyAdministrationQuery = (actor: string) =>
  queryOptions({
    queryKey: ["academy-administration", actor],
    enabled: Boolean(actor),
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_administration")
        .abortSignal(signal);
      if (error) throw error;
      return academyAdministration.nullable().parse(data);
    },
  });

export async function createAcademyOrganisation(
  requestId: string,
  name: string,
  timeZone: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("academy_create_organisation", {
    p_request_id: requestId,
    p_name: name,
    p_time_zone: timeZone,
  });
  if (error) throw error;
  return academyOrganisation.parse(data);
}

export async function createAcademyAccount(account: {
  idempotency_key: string;
  display_name: string;
  email: string;
  mode: "password" | "invite";
  role: "lecturer" | "participant";
  organisation_id: string | null;
  password?: string;
}) {
  requireOnline();
  return academyAccountReceipt.parse(
    await accountRequest("academy/users", "POST", account),
  );
}
