import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CompanyParticipantDetails } from "./company-participant-detail";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

const participant = {
  user_id: "56000000-0000-4000-8000-000000000003",
  luminovia_user_id: "LUM-DEMO-019",
  display_name: "Mika Hoffmann",
  joined_at: "2026-09-01T08:00:00Z",
  company_reference: "TRN-1042",
  version: 1,
};
const course = {
  run_id: "56000000-0000-4000-8000-000000000004",
  title: "Monitoring",
  starts_at: "2026-12-03T01:00:00Z",
  ends_at: "2026-12-03T07:00:00Z",
  time_zone: "Australia/Brisbane",
};
const second = {
  ...course,
  run_id: "56000000-0000-4000-8000-000000000005",
  title: "Linux",
  time_zone: "Europe/Berlin",
};

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

async function open(
  language: "de" | "en",
  save: () => Promise<{ data: unknown; error: { code: string } | null }>,
) {
  await i18n.changeLanguage(language);
  rpc.mockImplementation((name, params) => {
    if (name === "assign_company_participant_courses") return save();
    return {
      abortSignal: async () => ({
        data:
          name === "company_participant_overview"
            ? { items: [], has_more: false }
            : {
                items: params.p_search ? [second] : [course],
                has_more: false,
              },
        error: null,
      }),
    };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompanyParticipantDetails
          actor="fictional-actor"
          organisationId="fictional-company"
          participant={participant}
          onClose={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: language === "de" ? "Kurse zuweisen" : "Assign courses",
    }),
  );
  return client;
}

it("keeps the German selection across searches and refreshes attendance after a confirmed batch", async () => {
  const client = await open("de", async () => ({
    data: { enrolled: [course.run_id, second.run_id], unchanged: [] },
    error: null,
  }));
  const invalidate = vi.spyOn(client, "invalidateQueries");
  expect(
    screen.getByRole("searchbox", { name: "Kurse nach Titel suchen" }),
  ).toHaveFocus();
  expect(
    screen.getByRole("button", { name: "Auswahl einschreiben" }),
  ).toBeDisabled();
  fireEvent.click(
    await screen.findByRole("checkbox", {
      name: /Monitoring.*Australia\/Brisbane/,
    }),
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "Linux" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Suchen" }));
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /Linux.*Europe\/Berlin/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "In 2 Kurse einschreiben" }),
  );
  expect(await screen.findByText("2 neue Kurse zugewiesen.")).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("assign_company_participant_courses", {
    p_organisation_id: "fictional-company",
    p_user_id: participant.user_id,
    p_run_ids: [course.run_id, second.run_id],
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["course-enrolments", "fictional-actor", course.run_id],
  });
  expect(screen.getByRole("button", { name: "Kurse zuweisen" })).toHaveFocus();
});

it("preserves the selected English course when the database rejects stale availability", async () => {
  await open("en", async () => ({ data: null, error: { code: "PT409" } }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /Monitoring/ }));
  fireEvent.click(screen.getByRole("button", { name: "Enrol in 1 course" }));
  expect(await screen.findByText(/No new enrolments were added/)).toBeVisible();
  expect(
    await screen.findByRole("checkbox", { name: /Monitoring/ }),
  ).toBeChecked();
  expect(screen.queryByText(/new course assigned/)).not.toBeInTheDocument();
});

it("requires a matching receipt before taking the learner back to attendance", async () => {
  await open("en", async () => ({
    data: { enrolled: [second.run_id], unchanged: [] },
    error: null,
  }));
  fireEvent.click(await screen.findByRole("checkbox", { name: /Monitoring/ }));
  fireEvent.click(screen.getByRole("button", { name: "Enrol in 1 course" }));
  expect(
    await screen.findByText(/Enrolment could not be confirmed/),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Back to attendance" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Assign courses" }),
    ).toHaveFocus(),
  );
});
