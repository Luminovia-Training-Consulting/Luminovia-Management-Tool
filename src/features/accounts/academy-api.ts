/** Caller-scoped access to local academy administration and account creation. */
import { queryOptions } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { accountRequest } from "./api";
import {
  academyAccountReceipt,
  academyAdministration,
  academyInvitationReceipt,
  academyManagedAccount,
  academyMemberRoles,
  academyOrganisation,
  type AcademyManagedAccount,
  type AcademyRoleAssignment,
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

/** Read the live scope for one account when a local admin opens its role editor. */
export const academyMemberRolesQuery = (actor: string, accountId: string) =>
  queryOptions({
    queryKey: ["academy-member-roles", actor, accountId],
    enabled: Boolean(actor),
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("academy_member_roles", { p_user_id: accountId })
        .abortSignal(signal);
      if (error) throw error;
      return academyMemberRoles.parse(data);
    },
  });

/** Change one reviewed role and exact scope without replacing unrelated grants. */
export async function setAcademyMemberRole(
  accountId: string,
  assignment: Pick<AcademyRoleAssignment, "role" | "organisation_id">,
  enabled: boolean,
  revision: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("academy_set_member_role", {
    p_user_id: accountId,
    p_role: assignment.role,
    p_organisation_id: assignment.organisation_id,
    p_enabled: enabled,
    p_expected_revision: revision,
  });
  if (error) throw error;
  return academyMemberRoles.parse(data);
}

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

export async function inviteAcademyLearner(invitation: {
  idempotency_key: string;
  course_id: string;
  display_name: string;
  email: string;
}) {
  requireOnline();
  return academyInvitationReceipt.parse(
    await accountRequest("academy/company-invitations", "POST", invitation),
  );
}

export async function createAcademyAccount(account: {
  idempotency_key: string;
  display_name: string;
  email: string;
  mode: "password" | "invite";
  role: AcademyManagedAccount["role"];
  organisation_id: string | null;
  password?: string;
}) {
  requireOnline();
  return academyAccountReceipt.parse(
    await accountRequest("academy/users", "POST", account),
  );
}

export async function setAcademyMemberActive(
  account: AcademyManagedAccount,
  active: boolean,
) {
  requireOnline();
  const { data, error } = await db().rpc("academy_set_member_active", {
    p_user_id: account.id,
    p_active: active,
    p_expected_active: account.active,
  });
  if (error) throw error;
  return academyManagedAccount.parse(data);
}

export async function setAcademyManagement(
  account: AcademyManagedAccount,
  enabled: boolean,
) {
  requireOnline();
  const { data, error } = await db().rpc("academy_set_management", {
    p_user_id: account.id,
    p_enabled: enabled,
    p_expected_version: account.management_version,
  });
  if (error) throw error;
  return academyManagedAccount.parse(data);
}
