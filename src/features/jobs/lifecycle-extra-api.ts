import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { ownWaitlistSchema, waitlistSchema } from "./handover-schema";

const uuid = z.string().uuid();
export const waitlistKey = (actor: string, job: string) =>
  ["job-waitlist", actor, job] as const;
export const waitlistQuery = (actor: string, job: string) =>
  queryOptions({
    queryKey: waitlistKey(actor, job),
    enabled: uuid.safeParse(job).success,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("job_waitlist", { p_job_id: job })
        .abortSignal(signal);
      if (error) throw error;
      return waitlistSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });
export const myWaitlistQuery = (actor: string) =>
  queryOptions({
    queryKey: ["my-job-waitlist", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("my_job_waitlist")
        .abortSignal(signal);
      if (error) throw error;
      return ownWaitlistSchema.parse(data);
    },
    staleTime: 15000,
    retry: false,
  });

export async function setWaitlist(job: string, join: boolean) {
  requireOnline();
  const { data, error } = await db().rpc("set_job_waitlist", {
    p_job_id: job,
    p_join: join,
  });
  if (error) throw error;
  return waitlistSchema.parse(data);
}
