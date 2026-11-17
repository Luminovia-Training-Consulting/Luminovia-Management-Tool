/** Editing another account uses a scoped RPC and retains drafts on a stale-write rejection. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { ManagedProfileEditor } from "./managed-profile-editor";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
let cache: QueryClient;
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.clearAllMocks();
});
it("sends the original snapshot, keeps draft on conflict, then closes only after success", async () => {
  await i18n.changeLanguage("de");
  const old = {
    display_name: "Fictional lecturer",
    locale: "de",
    time_zone: "Europe/Berlin",
  };
  let fail = true;
  fake.rpc.mockImplementation(async (name: string) =>
    name === "managed_profile"
      ? { data: old, error: null }
      : { data: null, error: fail ? { code: "40001" } : null },
  );
  const close = vi.fn();
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <ManagedProfileEditor actor="admin" id="lecturer" close={close} />
    </QueryClientProvider>,
  );
  const input = await screen.findByLabelText("Anzeigename");
  await userEvent.clear(input);
  await userEvent.type(input, "Updated lecturer");
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("save_managed_profile", {
      p_user_id: "lecturer",
      p_payload: { ...old, display_name: "Updated lecturer" },
      p_expected: old,
    }),
  );
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(input).toHaveValue("Updated lecturer");
  expect(close).not.toHaveBeenCalled();
  fail = false;
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
