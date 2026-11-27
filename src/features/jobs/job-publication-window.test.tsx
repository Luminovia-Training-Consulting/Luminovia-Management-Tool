/** Confirm that reviewed timing and invitation inputs reach the native lifecycle RPC only after confirmation. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { JobPublicationWindow } from "./job-publication-window";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.rpc.mockReset();
});

it("reviews an eligible recipient and the exact Brisbane priority times before saving", async () => {
  const person = {
    id: "c1000000-0000-4000-8000-000000000022",
    name: "Fictional lecturer",
  };
  const initial = {
    version: 7,
    time_zone: "Australia/Brisbane",
    can_schedule: true,
    state: null,
    audience: null,
    opens_at: null,
    selection_ends_at: null,
    invitees: [],
  };
  state.rpc.mockImplementation(
    (name: string, input?: { p_payload: object }) => {
      if (name === "job_publication_plan")
        return { abortSignal: async () => ({ data: initial, error: null }) };
      if (name === "job_publication_candidates")
        return { abortSignal: async () => ({ data: [person], error: null }) };
      return Promise.resolve({
        data: {
          ...initial,
          ...input?.p_payload,
          version: 8,
          state: "scheduled",
          invitees: [{ ...person, status: "scheduled" }],
        },
        error: null,
      });
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <JobPublicationWindow actor="manager" job="job" />
    </QueryClientProvider>,
  );
  await user.click(screen.getByText("Veröffentlichung und Einladungen planen"));
  await user.selectOptions(
    await screen.findByLabelText("Sichtbarkeit"),
    "priority",
  );
  await user.click(screen.getByLabelText("Zeitpunkt planen"));
  fireEvent.change(screen.getByLabelText("Beginn der Veröffentlichung"), {
    target: { value: "2040-01-01T09:30" },
  });
  fireEvent.change(screen.getByLabelText("Öffentlich verfügbar ab"), {
    target: { value: "2040-01-01T14:30" },
  });
  await user.selectOptions(
    await screen.findByLabelText("Dozent:in auswählen"),
    person.id,
  );
  await user.click(screen.getByRole("button", { name: "Hinzufügen" }));
  await user.click(
    screen.getByRole("button", { name: "Veröffentlichung prüfen" }),
  );
  expect(state.rpc).not.toHaveBeenCalledWith(
    "job_publication_action",
    expect.anything(),
  );
  await user.click(
    screen.getByRole("button", { name: "Veröffentlichung bestätigen" }),
  );
  await screen.findByText("Veröffentlichungsplanung gespeichert.");
  expect(state.rpc).toHaveBeenCalledWith("job_publication_action", {
    p_job_id: "job",
    p_action: "schedule",
    p_expected_version: 7,
    p_request_id: expect.any(String),
    p_payload: {
      audience: "priority",
      opens_at: "2039-12-31T23:30:00.000Z",
      selection_ends_at: "2040-01-01T04:30:00.000Z",
      lecturer_ids: [person.id],
    },
  });
  client.clear();
});
