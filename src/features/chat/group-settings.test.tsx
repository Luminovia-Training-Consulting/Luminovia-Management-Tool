import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { GroupSettings } from "./group-settings";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("de");
  rpc.mockReset().mockImplementation(async (name: string) =>
    name === "chat_group_settings"
      ? {
          data: { title: "Kurs", description: "Beschreibung", version: 1 },
          error: null,
        }
      : { data: 2, error: null },
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

function view(canManage = true, onOpenChange = vi.fn()) {
  return render(
    <QueryClientProvider client={client}>
      <GroupSettings
        actor="actor"
        room="room"
        canManage={canManage}
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
}

it("allows a manager to update the reviewed version and awaits confirmation", async () => {
  const user = userEvent.setup();
  view();
  await user.click(
    await screen.findByRole("button", {
      name: "Gruppeninformationen bearbeiten",
    }),
  );
  await user.clear(screen.getByLabelText("Gruppenname"));
  await user.type(screen.getByLabelText("Gruppenname"), "Neuer Kurs");
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  expect(rpc).toHaveBeenCalledWith("update_chat_group_settings", {
    p_room_id: "room",
    p_title: "Neuer Kurs",
    p_description: "Beschreibung",
    p_expected_version: 1,
  });
});
it("keeps a draft and its original revision after another edit", async () => {
  const user = userEvent.setup();
  rpc.mockImplementation(async (name: string) =>
    name === "chat_group_settings"
      ? {
          data: { title: "Kurs", description: "Beschreibung", version: 1 },
          error: null,
        }
      : { data: null, error: { code: "40001" } },
  );
  view();
  await user.click(
    await screen.findByRole("button", {
      name: "Gruppeninformationen bearbeiten",
    }),
  );
  await user.type(screen.getByLabelText("Beschreibung"), " mein Entwurf");
  client.setQueryData(["chat-group-settings", "actor", "room"], {
    title: "Anderer Kurs",
    description: "Neu",
    version: 2,
  });
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "inzwischen geändert",
  );
  expect(screen.getByLabelText("Beschreibung")).toHaveValue(
    "Beschreibung mein Entwurf",
  );
  expect(rpc).toHaveBeenCalledWith(
    "update_chat_group_settings",
    expect.objectContaining({ p_expected_version: 1 }),
  );
});
it("shows members information without edit access and confirms closing an edit", async () => {
  const user = userEvent.setup();
  const onOpenChange = vi.fn();
  const page = view(false, onOpenChange);
  expect(await screen.findByText("Beschreibung")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Gruppeninformationen bearbeiten" }),
  ).not.toBeInTheDocument();
  page.rerender(
    <QueryClientProvider client={client}>
      <GroupSettings
        actor="actor"
        room="room"
        canManage
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );
  await user.click(
    screen.getByRole("button", { name: "Gruppeninformationen bearbeiten" }),
  );
  vi.spyOn(window, "confirm").mockReturnValue(false);
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Schließen",
    }),
  );
  expect(onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Beschreibung")).toHaveValue("Beschreibung");
});
