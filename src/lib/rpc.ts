import { db } from "./supabase";

/** Forward native RPC results and preserve the server error for callers. */
export async function callRpc<T>(
  name: string,
  parameters: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await db().rpc(name, parameters);
  if (error) throw error;
  return data as T;
}
