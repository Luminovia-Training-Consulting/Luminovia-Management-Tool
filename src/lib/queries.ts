import { queryOptions } from "@tanstack/react-query";
import { db } from "./supabase";
import type {
  Job,
  Claim,
  Topic,
  Profile,
  Expertise,
  PersonalEvent,
} from "./types";
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
export const permissionsQuery = (id: string) =>
  queryOptions({
    queryKey: ["permissions", id],
    queryFn: async () => {
      const { data, error } = await db().rpc("get_my_permissions");
      if (error) throw error;
      return (data ?? []) as string[];
    },
  });
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
export const jobsQuery = queryOptions({
  queryKey: ["jobs"],
  queryFn: async () => {
    const { data, error } = await db()
      .from("jobs")
      .select("*,job_sessions(*),job_requirements(topic_id)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as Job[];
  },
});
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
