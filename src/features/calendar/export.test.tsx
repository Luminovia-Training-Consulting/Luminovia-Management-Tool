import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { CalendarExport } from "./export";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
let client: QueryClient;
const createUrl = vi.fn();
beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  fake.rpc.mockReset();
  createUrl.mockReset().mockReturnValue("blob:calendar-fixture");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createUrl;
      static revokeObjectURL = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function view(actor: string) {
  return (
    <QueryClientProvider client={client}>
      <CalendarExport actor={actor} zone="Europe/Berlin" />
    </QueryClientProvider>
  );
}

it("downloads a fresh authorized snapshot while its account remains mounted", async () => {
  const user = userEvent.setup();
  fake.rpc.mockReturnValue({
    abortSignal: () => Promise.resolve({ error: null, data: [] }),
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  render(view("actor-a"));
  await user.click(
    screen.getByText("Kalenderdatei exportieren", { exact: true }),
  );
  await user.click(
    screen.getByRole("button", { name: "ICS-Datei herunterladen" }),
  );
  expect(
    await screen.findByText(
      "Die Kalenderdatei wurde zum Download bereitgestellt.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(createUrl).toHaveBeenCalledOnce();
  expect(createUrl.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect((createUrl.mock.calls[0][0] as Blob).type).toBe(
    "text/calendar;charset=utf-8",
  );
  expect(click).toHaveBeenCalledOnce();
});

it.each(["unmount", "actor transition"] as const)(
  "aborts a delayed private export on %s and suppresses even a late successful response",
  async (transition) => {
    let resolve!: (result: unknown) => void;
    const response = new Promise((done) => {
      resolve = done;
    });
    let signal: AbortSignal | undefined;
    fake.rpc.mockImplementation(() => ({
      abortSignal: (value: AbortSignal) => {
        signal = value;
        return response;
      },
    }));
    const user = userEvent.setup();
    const mounted = render(view("actor-a"));
    await user.click(
      screen.getByText("Kalenderdatei exportieren", { exact: true }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Eigene private Kalendereinträge einschließen",
      }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "ICS-Datei herunterladen",
      }),
    );
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith(
        "export_my_calendar",
        expect.objectContaining({ p_include_private: true }),
      ),
    );
    expect(signal?.aborted).toBe(false);
    if (transition === "unmount") mounted.unmount();
    else mounted.rerender(view("actor-b"));
    expect(signal?.aborted).toBe(true);
    await act(async () =>
      resolve({
        error: null,
        data: [
          {
            id: "1911b233-f4ce-419f-9f3b-88773417ed8f",
            kind: "private",
            title: "Previous account's private appointment",
            starts_at: "2026-11-16T08:00:00Z",
            ends_at: "2026-11-16T09:00:00Z",
            time_zone: "Europe/Berlin",
          },
        ],
      }),
    );
    expect(createUrl).not.toHaveBeenCalled();
    expect(
      screen.queryByText(
        "Die Kalenderdatei wurde zum Download bereitgestellt.",
        { exact: true },
      ),
    ).not.toBeInTheDocument();
  },
);
