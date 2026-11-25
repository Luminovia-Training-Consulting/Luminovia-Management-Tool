/** Exercise account-facade status decoding with a simulated FunctionsHttpError only. */
import { FunctionsHttpError } from "@supabase/supabase-js";
import { afterEach, expect, it, vi } from "vitest";
import { accountRequest } from "./api";

const fake = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ functions: { invoke: fake.invoke } }),
}));

afterEach(() => vi.clearAllMocks());

it("preserves the server's in-progress account status for a safe same-key retry", async () => {
  fake.invoke.mockResolvedValue({
    data: null,
    error: new FunctionsHttpError(
      new Response(JSON.stringify({ status: "in_progress" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    ),
  });

  await expect(accountRequest("users", "POST", {})).rejects.toThrow(
    "creation_in_progress",
  );
});
