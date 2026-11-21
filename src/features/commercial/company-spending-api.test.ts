import { expect, it, vi } from "vitest";
import { companyMonthlySpendingQuery, commissionKeys } from "./commission-api";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

it("requests only the company-scoped gross projection with an actor-bound cache key", async () => {
  rpc.mockResolvedValueOnce({
    data: [{ organisation_id: "own", gross_amount: 100 }],
    error: null,
  });
  const query = companyMonthlySpendingQuery("actor", "own");
  expect(query.queryKey).toEqual(
    commissionKeys.monthlySpending("actor", "own"),
  );
  expect(await query.queryFn!({} as never)).toEqual([
    { organisation_id: "own", gross_amount: 100 },
  ]);
  expect(rpc).toHaveBeenCalledWith("company_monthly_accepted_spending", {
    p_organisation_id: "own",
  });
});
