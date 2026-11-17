import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { EnrolmentManager } from "./enrolments";

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/queries", () => ({
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => ["courses.manage"],
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => {},
}));
vi.mock("./api", () => ({
  peopleRpc: async (name: string) => {
    if (name === "enrolment_candidates")
      return [{ id: "person", display_name: "Fictional Person" }];
    if (name === "course_enrolments") return [];
    throw { code: "PZ002" };
  },
}));
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("de");
});
it("explains an unresolved course chat membership without claiming an enrolment was removed", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <EnrolmentManager courseRunId="course" />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Person auswählen"),
    "person",
  );
  await user.selectOptions(screen.getByLabelText("Teilnahmestatus"), "removed");
  await user.click(screen.getByRole("button", { name: "Zuordnung speichern" }));
  expect(
    await screen.findByText(/Die Zuordnung bleibt bestehen/),
  ).toHaveTextContent("Zugangsgrund klären");
  client.clear();
});
