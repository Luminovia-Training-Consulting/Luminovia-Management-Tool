/** Exercise the company-only read projection and its server-issued page cursors. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  CompanyLecturerDirectory,
  CompanyLecturerFeedback,
} from "./company-lecturer-feedback";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

const lecturer = {
  id: "d1feba48-7592-456a-97f5-b238dc19b436",
  display_name: "Fictional lecturer",
};
const cursor = "dbe9dd2f-71a0-4438-a441-a75826906bdd";
const nextId = "079a620f-36a1-4746-b219-7b3e44f46217";

function renderView(view: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{view}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  rpc.mockReset();
  await i18n.changeLanguage("en");
});

it("submits a named search and links to the reduced lecturer profile", async () => {
  rpc.mockImplementation((_name, args: { p_search: string }) => ({
    abortSignal: async () => ({
      data: { lecturers: args.p_search ? [lecturer] : [], next: null },
      error: null,
    }),
  }));
  renderView(<CompanyLecturerDirectory actor="company" />);
  const user = userEvent.setup();
  await user.type(screen.getByRole("searchbox"), "Fictional");
  await user.click(screen.getByRole("button", { name: "Search people" }));
  const result = await screen.findByRole("link", {
    name: lecturer.display_name,
  });
  expect(result).toHaveAttribute(
    "href",
    `/people/${lecturer.id}?lecturers=feedback`,
  );
  expect(rpc).toHaveBeenLastCalledWith("company_lecturer_feedback", {
    p_user_id: null,
    p_search: "Fictional",
    p_after: null,
  });
});

it("renders verified qualifications and scores and follows the next-page cursor", async () => {
  rpc.mockImplementation((_name, args: { p_after: string | null }) => ({
    abortSignal: async () => ({
      data: {
        lecturer: { ...lecturer, teaching_minutes: 90 },
        qualifications: [{ id: nextId, label_en: "Unix", label_de: "Unix" }],
        reviews: args.p_after
          ? [{ id: nextId, rater_role: "company", score: 3 }]
          : [{ id: cursor, rater_role: "learner", score: 5 }],
        next: args.p_after ? null : cursor,
      },
      error: null,
    }),
  }));
  renderView(
    <CompanyLecturerFeedback actor="company" lecturer={lecturer.id} />,
  );
  expect(
    await screen.findByText("1.5 confirmed teaching hours at Luminovia"),
  ).toBeVisible();
  expect(screen.getByText("Unix")).toBeVisible();
  expect(screen.getByText("5 out of 5 · Course participant")).toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByText("3 out of 5 · Company")).toBeVisible();
  expect(rpc).toHaveBeenLastCalledWith("company_lecturer_feedback", {
    p_user_id: lecturer.id,
    p_search: "",
    p_after: cursor,
  });
});
