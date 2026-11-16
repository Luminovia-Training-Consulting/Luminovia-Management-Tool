import { afterEach, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useAuthorizationRefresh } from "./authorization-refresh";
afterEach(cleanup);
function Observer({
  roles,
  permissions,
}: {
  roles: string[];
  permissions: string[];
}) {
  useAuthorizationRefresh("same-actor", roles, permissions);
  return null;
}
it("clears dormant confidential reports and old role-specific offers on a server role change", async () => {
  const client = new QueryClient();
  client.setQueryData(["commission-report", "same-actor"], { gross: 1000 });
  client.setQueryData(["jobs"], [{ amount: 730 }]);
  const page = (roles: string[]) => (
    <QueryClientProvider client={client}>
      <Observer roles={roles} permissions={["jobs.claim"]} />
    </QueryClientProvider>
  );
  const view = render(page(["senior_lecturer"]));
  expect(client.getQueryData(["jobs"])).toEqual([{ amount: 730 }]);
  view.rerender(page(["lecturer"]));
  await waitFor(() => expect(client.getQueryData(["jobs"])).toBeUndefined());
  expect(
    client.getQueryData(["commission-report", "same-actor"]),
  ).toBeUndefined();
  client.setQueryData(["jobs"], [{ amount: 310 }]);
  view.rerender(page(["lecturer"]));
  expect(client.getQueryData(["jobs"])).toEqual([{ amount: 310 }]);
  client.clear();
});
