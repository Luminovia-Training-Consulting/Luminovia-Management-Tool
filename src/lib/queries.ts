/**
 * Shared profile, current-capability, expertise, claim and private-event queries. Actor
 * keys prevent cache mixing; RLS/RPCs remain the authoritative access boundary.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "./supabase";
import type { Claim, Topic, Profile, Expertise, PersonalEvent } from "./types";
/** Read the current resource through its native actor-scoped client contract. */
export const profileQuery = (id: string) =>
  queryOptions({
    queryKey: ["profile", id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data as Profile | null;
    },
  });
/** Read the get_my_permissions server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const permissionsQuery = (id: string) =>
  queryOptions({
    queryKey: ["permissions", id],
    refetchInterval: 30000,
    queryFn: async () => {
      const { data, error } = await db().rpc("get_my_permissions");
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
/** Read authorized topic rows through the native client and propagate read/access errors. */
export const topicsQuery = queryOptions({
  queryKey: ["topics"],
  queryFn: async () => {
    const { data, error } = await db()
      .from("topics")
      .select("*")
      .order("label_de");
    if (error) throw error;
    return data as Topic[];
  },
});
/** Read lecturer_topics through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const expertiseQuery = (id: string) =>
  queryOptions({
    queryKey: ["expertise", id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("lecturer_topics")
        .select("*")
        .eq("user_id", id);
      if (error) throw error;
      return data as Expertise[];
    },
  });
/** Read the actor’s committed claim snapshots; roles and fees remain server-owned. */
export const claimsQuery = (id: string) =>
  queryOptions({
    queryKey: ["claims", id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("job_claims")
        .select("*,assignment_sessions(*)")
        .eq("lecturer_id", id)
        .eq("status", "confirmed")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Claim[];
    },
  });
/** Read personal_events through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const eventsQuery = (id: string) =>
  queryOptions({
    queryKey: ["events", id],
    queryFn: async () => {
      const { data, error } = await db()
        .from("personal_events")
        .select("*")
        .eq("user_id", id)
        .order("starts_at");
      if (error) throw error;
      return data as PersonalEvent[];
    },
  });

/** Read user_roles through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const userRolesQuery = (id: string) =>
  queryOptions({
    queryKey: ["user-roles", id],
    queryFn: async () => {
      const result = await db()
        .from("user_roles")
        .select("role")
        .eq("user_id", id);
      if (result.error) throw result.error;
      return (result.data ?? []).map((row) => row.role as string);
    },
    refetchInterval: 30000,
  });
