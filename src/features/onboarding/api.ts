import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import {
  welcomeProgressSchema,
  type WelcomeProgress,
  type WelcomeStep,
} from "./schema";

export {
  welcomeProgressSchema,
  welcomeStepSchema,
  type WelcomeProgress,
  type WelcomeStep,
} from "./schema";

export const welcomeKey = (actor: string) =>
  ["welcome-progress", actor] as const;
export const welcomeQuery = (actor: string) =>
  queryOptions({
    queryKey: welcomeKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("get_welcome_progress")
        .abortSignal(signal);
      if (error) throw error;
      return welcomeProgressSchema.parse(data);
    },
    staleTime: 30_000,
  });

export async function saveWelcomeProgress(
  progress: WelcomeProgress,
  step: WelcomeStep,
  status: WelcomeProgress["status"],
) {
  requireOnline();
  const { data, error } = await db().rpc("save_welcome_progress", {
    p_step: step,
    p_status: status,
    p_expected_version: progress.version,
  });
  if (error) throw error;
  return welcomeProgressSchema.parse(data);
}
