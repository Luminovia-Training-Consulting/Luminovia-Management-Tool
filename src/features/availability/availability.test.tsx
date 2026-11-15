import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AvailabilityPage } from "./availability";
import type { AvailabilityWindow } from "./api";
const { rpc, dbFrom } = vi.hoisted(() => ({ rpc: vi.fn(), dbFrom: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc, from: dbFrom }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "availability-actor" } } }),
}));
let manager = false,
  rows: AvailabilityWindow[] = [],
  shared: unknown[] = [];
const row: AvailabilityWindow = {
  id: "window-id",
  user_id: "availability-actor",
  kind: "unavailable",
  starts_at: "2026-11-18T08:00:00Z",
  ends_at: "2026-11-18T09:00:00Z",
  time_zone: "Europe/Berlin",
  notes: "PRIVATE own availability note",
  share_with_management: false,
  version: 1,
};
function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  manager = false;
  rows = [row];
  shared = [];
  rpc.mockReset();
  rpc.mockImplementation((name) =>
    name === "get_my_permissions"
      ? response(manager ? ["availability.read_shared"] : [])
      : name === "my_availability"
        ? response(rows)
        : name === "shared_availability"
          ? response(shared)
          : Promise.reject(new Error("UnexpectedRPC")),
  );
  dbFrom.mockImplementation((table) => {
    const data =
      table === "profiles"
        ? {
            id: "availability-actor",
            display_name: "Fictional",
            time_zone: "Europe/Berlin",
          }
        : [{ role: manager ? "admin" : "lecturer" }];
    const request = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      maybeSingle: () => response(data),
      then: (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ) => response(data).then(resolve, reject),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AvailabilityPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
describe("connected private availability controls", () => {
  it("renders own private notes without offering the management projection to ordinary lecturers", async () => {
    mount();
    expect(await screen.findByText(row.notes)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Freigegebene Zeitfenster" }),
    ).not.toBeInTheDocument();
    expect(
      rpc.mock.calls.some(([name]) => name === "shared_availability"),
    ).toBe(false);
  });
  it("management renders only explicit projection fields, even if an unexpected notes property arrives", async () => {
    manager = true;
    rows = [];
    shared = [
      {
        ...row,
        user_id: "peer",
        display_name: "Fictional shared colleague",
        notes: "PRIVATE PEER NOTE MUST NOT RENDER",
      },
    ];
    mount();
    expect(
      await screen.findByRole("heading", {
        name: "Fictional shared colleague",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("PRIVATE PEER NOTE MUST NOT RENDER"),
    ).not.toBeInTheDocument();
  });
  it("keeps a draft through language changes and waits for actual creation confirmation", async () => {
    rows = [];
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Zeitfenster hinzufügen" }),
    );
    await user.type(screen.getByLabelText("Beginn"), "2026-11-20T09:00");
    await user.type(screen.getByLabelText("Ende"), "2026-11-20T10:00");
    await user.type(
      screen.getByLabelText("Notiz (nur für dich)"),
      "Fictional draft",
    );
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByLabelText("Note (only you)")).toHaveValue(
      "Fictional draft",
    );
    expect(
      screen.getByLabelText(
        "Explicitly share interval and status with management",
      ),
    ).not.toBeChecked();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
        finish = resolve;
      }),
      prior = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "save_lecturer_availability" ? pending : prior(name, args),
    );
    await user.click(screen.getByRole("button", { name: "Save time window" }));
    expect(
      await screen.findByRole("button", { name: "Saving …" }),
    ).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(() => finish({ data: "saved-id", error: null }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(rpc).toHaveBeenCalledWith(
      "save_lecturer_availability",
      expect.objectContaining({
        p_version: 0,
        p_payload: expect.objectContaining({
          share_with_management: false,
          notes: "Fictional draft",
          starts_at: "2026-11-20T08:00:00.000Z",
        }),
      }),
    );
  });
  it("retains edits on an accepted-assignment conflict without reporting a save", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Zeitfenster bearbeiten" }),
    );
    const prior = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "save_lecturer_availability"
        ? response(null, { code: "23P01" })
        : prior(name, args),
    );
    await user.type(screen.getByLabelText("Notiz (nur für dich)"), " retained");
    await user.click(
      screen.getByRole("button", { name: "Zeitfenster speichern" }),
    );
    expect(
      await screen.findByText(/überschneidet einen bestätigten Auftrag/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Notiz (nur für dich)")).toHaveValue(
      row.notes + " retained",
    );
    expect(screen.queryByText("Änderung gespeichert.")).not.toBeInTheDocument();
  });
});
