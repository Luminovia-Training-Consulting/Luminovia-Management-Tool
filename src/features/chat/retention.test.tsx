import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { ChatRetention } from "./retention";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

let client: QueryClient;

beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  rpc.mockReset();
});

afterEach(() => {
  cleanup();
  client.clear();
});

function view(roomId?: string) {
  render(
    <QueryClientProvider client={client}>
      <ChatRetention actor="actor" roomId={roomId} />
    </QueryClientProvider>,
  );
}

it("shows the inherited duration and saves an override only after confirmation", async () => {
  const user = userEvent.setup();
  rpc.mockResolvedValueOnce({
    data: { hours: null, default_hours: 168, version: 2, can_edit: true },
  });
  rpc.mockResolvedValue({
    data: { hours: 8, default_hours: 168, version: 3, can_edit: true },
  });
  view("room");
  await user.click(
    screen.getByRole("button", { name: "Löschfrist für diesen Chat" }),
  );
  expect(await screen.findByText("Aktuell gilt Nach 7 Tagen.")).toBeVisible();
  await user.selectOptions(screen.getByRole("combobox"), "8");
  const save = screen.getByRole("button", { name: "Löschfrist speichern" });
  expect(save).toBeDisabled();
  await user.click(screen.getByRole("checkbox"));
  await user.click(save);
  expect(rpc).toHaveBeenCalledWith("set_chat_retention_policy", {
    p_room_id: "room",
    p_hours: 8,
    p_expected_version: 2,
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("shows read-only room policies and scopes global writes explicitly", async () => {
  const user = userEvent.setup();
  rpc.mockResolvedValueOnce({
    data: { hours: 336, default_hours: 0, version: 1, can_edit: false },
  });
  view("room");
  await user.click(
    screen.getByRole("button", { name: "Löschfrist für diesen Chat" }),
  );
  expect(await screen.findByText("Aktuell gilt Nach 14 Tagen.")).toBeVisible();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

  cleanup();
  rpc.mockResolvedValue({
    data: { hours: 0, default_hours: 0, version: 0, can_edit: true },
  });
  view();
  await user.click(
    screen.getByRole("button", { name: "Globale Löschfristen" }),
  );
  await user.selectOptions(await screen.findByRole("combobox"), "336");
  await user.click(screen.getByRole("checkbox"));
  await user.click(
    screen.getByRole("button", { name: "Löschfrist speichern" }),
  );
  expect(rpc).toHaveBeenCalledWith("set_chat_retention_policy", {
    p_room_id: null,
    p_hours: 336,
    p_expected_version: 0,
  });
});
