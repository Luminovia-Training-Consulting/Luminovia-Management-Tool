import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { DeliverySettings } from "./delivery-settings";
import { deliveryPreferencesSchema } from "./delivery-api";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  online: true,
  conflict: false,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const initial = {
  email_enabled: false,
  quiet_start: null,
  quiet_end: null,
  time_zone: "Europe/Berlin",
  version: 1,
};
const clients: QueryClient[] = [];
beforeEach(async () => {
  state.online = true;
  state.conflict = false;
  await i18n.changeLanguage("de");
  state.rpc.mockImplementation((name, args) => {
    const request = Promise.resolve(
      name === "delivery_preferences"
        ? { data: { ...initial }, error: null }
        : state.conflict
          ? { data: null, error: { code: "40001" } }
          : { data: { ...args.p_payload, version: 2 }, error: null },
    );
    return Object.assign(request, { abortSignal: () => request });
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});
function view(actor = "actor-a") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <DeliverySettings actor={actor} />
    </QueryClientProvider>,
  );
}

it("retains the opt-in draft over language changes and submits only the authenticated account preferences", async () => {
  view();
  const enabled = await screen.findByRole("checkbox", {
    name: "Zusätzliche Hinweise per E-Mail erhalten",
  });
  expect(enabled).not.toBeChecked();
  await userEvent.click(enabled);
  await userEvent.click(screen.getByRole("checkbox", { name: /Ruhezeiten/ }));
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByRole("checkbox", { name: /Receive additional/ })).toBe(
    enabled,
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Save email preferences" }),
  );
  expect(await screen.findByText("Email preferences saved.")).toBeVisible();
  expect(state.rpc).toHaveBeenCalledWith("save_delivery_preferences", {
    p_payload: {
      email_enabled: true,
      quiet_start: "22:00",
      quiet_end: "07:00",
      time_zone: "Europe/Berlin",
    },
    p_expected_version: 1,
  });
});

it("does not confirm a stale server write and preserves choices until explicit reload", async () => {
  state.conflict = true;
  view();
  const enabled = await screen.findByRole("checkbox", { name: /Zusätzliche/ });
  await userEvent.click(enabled);
  await userEvent.click(
    screen.getByRole("button", { name: "E-Mail-Einstellungen speichern" }),
  );
  expect(await screen.findByText(/an anderer Stelle geändert/)).toBeVisible();
  expect(enabled).toBeChecked();
  expect(
    screen.queryByText("E-Mail-Einstellungen gespeichert."),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: /Aktuelle E-Mail-Einstellungen/ }),
  );
  await waitFor(() => expect(enabled).not.toBeChecked());
});

it("rejects an invalid zone without submitting and disables writes offline", async () => {
  view();
  const zone = await screen.findByRole("textbox", {
    name: "Zeitzone der Ruhezeiten",
  });
  await userEvent.clear(zone);
  await userEvent.type(zone, "Invalid/Zone");
  await userEvent.click(
    screen.getByRole("button", { name: "E-Mail-Einstellungen speichern" }),
  );
  expect(await screen.findByText(/Wähle zwei unterschiedliche/)).toBeVisible();
  expect(
    state.rpc.mock.calls.filter(
      ([name]) => name === "save_delivery_preferences",
    ),
  ).toHaveLength(0);
  cleanup();
  state.online = false;
  view("actor-b");
  await userEvent.click(
    await screen.findByRole("checkbox", { name: /Zusätzliche/ }),
  );
  expect(
    screen.getByRole("button", { name: "E-Mail-Einstellungen speichern" }),
  ).toBeDisabled();
});

it.each([
  { quiet_start: "25:00", quiet_end: "07:00" },
  { quiet_start: "22:00", quiet_end: null },
  { quiet_start: "22:00", quiet_end: "22:00" },
  { time_zone: "Invalid/Zone" },
])(
  "rejects malformed channel settings returned by the server: %j",
  (invalid) => {
    expect(
      deliveryPreferencesSchema.safeParse({ ...initial, ...invalid }).success,
    ).toBe(false);
  },
);
