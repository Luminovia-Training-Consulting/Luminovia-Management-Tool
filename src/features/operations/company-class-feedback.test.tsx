import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  CompanyClassFeedback,
  JobClassFeedback,
} from "./company-class-feedback";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));

const classId = "9cbff6ae-f026-4444-80c7-4538384de663";
const jobId = "c1e16dde-7f95-4542-ab6e-f5859bace1a2";
const receiptId = "93a82cee-422c-469a-ba92-f180ccf287b7";
const base = {
  count: 0,
  average: null,
  comments: { items: [], next: null },
  rating: null,
  can_rate: false,
  can_comment: false,
};
let query: QueryClient;

afterEach(() => {
  cleanup();
  query?.clear();
  mocks.rpc.mockReset();
});

async function open(children: React.ReactNode) {
  await i18n.changeLanguage("de");
  query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={query}>{children}</QueryClientProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByText("Klassenfeedback"));
  return user;
}

it("shows a waiting state until the assigned instructor can rate the class", async () => {
  mocks.rpc.mockReturnValue({
    abortSignal: async () => ({ data: base, error: null }),
  });
  await open(
    <JobClassFeedback actor="lecturer" classId={classId} jobId={jobId} />,
  );
  expect(await screen.findByText(/letzten bestätigten Termin/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Bewertung speichern" }),
  ).not.toBeInTheDocument();
  expect(mocks.rpc).toHaveBeenCalledWith("class_feedback", {
    p_class_id: classId,
    p_job_id: jobId,
    p_after: null,
  });
});

it("confirms the versioned teaching rating only through the assigned job", async () => {
  mocks.rpc.mockImplementation((name) =>
    name === "class_feedback"
      ? {
          abortSignal: async () => ({
            data: { ...base, can_rate: true },
            error: null,
          }),
        }
      : Promise.resolve({
          data: { score: 4, version: 1, comment: "Fiktives Feedback" },
          error: null,
        }),
  );
  const user = await open(
    <JobClassFeedback actor="lecturer" classId={classId} jobId={jobId} />,
  );
  await user.selectOptions(
    await screen.findByLabelText("Sterne vergeben"),
    "4",
  );
  await user.type(screen.getByLabelText("Kommentar"), "Fiktives Feedback");
  await user.click(screen.getByRole("button", { name: "Bewertung speichern" }));
  await waitFor(() =>
    expect(mocks.rpc).toHaveBeenCalledWith("save_job_class_rating", {
      p_job_id: jobId,
      p_class_id: classId,
      p_score: 4,
      p_comment: "Fiktives Feedback",
      p_expected_version: 0,
    }),
  );
});

it("shows teaching feedback to company users and lets them add class comments", async () => {
  mocks.rpc.mockImplementation((name) =>
    name === "class_feedback"
      ? {
          abortSignal: async () => ({
            data: {
              ...base,
              count: 1,
              average: 4,
              comments: {
                next: null,
                items: [
                  {
                    id: receiptId,
                    source: "lecturer",
                    score: 4,
                    comment: "Fiktiver Unterrichtskommentar",
                  },
                ],
              },
              can_comment: true,
            },
            error: null,
          }),
        }
      : Promise.resolve({ data: receiptId, error: null }),
  );
  const user = await open(
    <CompanyClassFeedback actor="client" classId={classId} />,
  );
  expect(
    await screen.findByText("Fiktiver Unterrichtskommentar"),
  ).toBeVisible();
  expect(
    screen.getByText("4/5 Sterne im Durchschnitt · 1 Bewertung"),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Bewertung speichern" }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Kommentar"),
    "Eigener Klassenkommentar",
  );
  await user.click(
    screen.getByRole("button", { name: "Kommentar hinzufügen" }),
  );
  expect(await screen.findByText("Feedback gespeichert.")).toBeVisible();
  expect(mocks.rpc).toHaveBeenCalledWith("add_company_class_note", {
    p_class_id: classId,
    p_comment: "Eigener Klassenkommentar",
    p_request_id: expect.any(String),
  });
});
