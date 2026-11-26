/** Request personal portfolio records or the teacher's named course shares. */
import { queryOptions } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  portfolioCommand,
  portfolioOwner,
  portfolioTeacher,
  type PortfolioCommand,
} from "./portfolio-schema";

export const portfolioKey = (actor: string) =>
  ["learning-portfolio", actor] as const;

export const personalPortfolioQuery = (
  actor: string,
  entry: string | null = null,
) =>
  queryOptions({
    queryKey: [...portfolioKey(actor), "personal", entry],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("learning_portfolio", { p_entry_id: entry })
        .abortSignal(signal);
      if (error) throw error;
      return portfolioOwner.parse(data);
    },
    retry: false,
    gcTime: 0,
  });

export const portfolioPageSize = 20;
export const coursePortfolioQuery = (
  actor: string,
  course: string,
  offset: number,
) =>
  queryOptions({
    queryKey: [...portfolioKey(actor), "course", course, offset],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("learning_portfolio", {
          p_course_id: course,
          p_offset: offset,
        })
        .abortSignal(signal);
      if (error) throw error;
      return portfolioTeacher.parse(data);
    },
    refetchInterval: 15000,
    retry: false,
    gcTime: 0,
  });

/** Export only the current actor's entries and complete revision histories. */
export async function exportPortfolio() {
  requireOnline();
  const { data, error } = await db().rpc("learning_portfolio", {
    p_export: true,
  });
  if (error) throw error;
  return portfolioOwner.parse(data).entries;
}

export async function changePortfolio(input: PortfolioCommand) {
  requireOnline();
  const { error } = await db().rpc(
    "learning_portfolio_command",
    portfolioCommand.parse(input),
  );
  if (error) throw error;
}
