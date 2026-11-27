/** Protect server-confirmed preference and requirement persistence through their native forms. */
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  AssignmentMatchingRequirements,
  TeachingMatchingPreferences,
} from "./matching-preferences";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
const topic = {
  id: "c1000000-0000-4000-8000-000000000012",
  label_de: "Didaktik",
  label_en: "Didactics",
};
vi.mock("../../lib/queries", () => ({
  topicsQuery: { queryKey: ["topics"], queryFn: async () => [topic] },
}));
afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.rpc.mockReset();
});

it("saves local teaching hours and languages until the server returns the next version", async () => {
  const initial = {
    version: 0,
    delivery_formats: [],
    teaching_languages: [],
    teaching_days: [],
    teaching_start: null,
    teaching_end: null,
    urgent_cover: false,
  };
  state.rpc.mockImplementation((name: string, input?: { p_payload: object }) =>
    name === "own_lecturer_matching_preferences"
      ? { abortSignal: async () => ({ data: initial, error: null }) }
      : Promise.resolve({
          data: { ...input?.p_payload, version: 1 },
          error: null,
        }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <TeachingMatchingPreferences actor="teacher" />
    </QueryClientProvider>,
  );
  expect(state.rpc).not.toHaveBeenCalled();
  await user.click(screen.getByText("Unterricht und Einsatzzeiten"));
  await user.type(await screen.findByLabelText("Unterrichtssprachen"), "DE en");
  await user.click(screen.getByLabelText("Hybrid"));
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await screen.findByText("Gespeichert.");
  expect(state.rpc).toHaveBeenCalledWith("save_lecturer_matching_preferences", {
    p_expected_version: 0,
    p_payload: expect.objectContaining({
      teaching_languages: ["de", "en"],
      delivery_formats: ["hybrid"],
    }),
  });
  client.clear();
});

it("configures a verified qualification on the reviewed assignment revision", async () => {
  const initial = {
    version: 7,
    can_edit: true,
    qualification_topics: [],
    document_evidence_required: false,
    teaching_languages: [],
  };
  state.rpc.mockImplementation((name: string, input?: { p_payload: object }) =>
    name === "job_matching_requirements"
      ? { abortSignal: async () => ({ data: initial, error: null }) }
      : Promise.resolve({
          data: { ...input?.p_payload, version: 8, can_edit: true },
          error: null,
        }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <AssignmentMatchingRequirements actor="manager" job="job" />
    </QueryClientProvider>,
  );
  await user.click(screen.getByText("Verbindliche Zuweisungsvoraussetzungen"));
  await user.type(
    await screen.findByLabelText("Qualifikationen suchen"),
    "didak",
  );
  const req = within(
    screen.getByRole("group", { name: "Verifizierte Qualifikationen" }),
  );
  await user.click(await req.findByLabelText("Didaktik"));
  await user.click(
    screen.getByLabelText("Geprüften Zertifikatsnachweis verlangen"),
  );
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith("save_job_matching_requirements", {
      p_job_id: "job",
      p_expected_version: 7,
      p_payload: {
        qualification_topics: [topic.id],
        teaching_languages: [],
        document_evidence_required: true,
      },
    }),
  );
  client.clear();
});
