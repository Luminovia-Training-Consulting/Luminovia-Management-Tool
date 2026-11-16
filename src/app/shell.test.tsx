/**
 * Vitest-Regressionen für Navigation, Suche und bestätigtes beziehungsweise fehlgeschlagenes Abmelden. SDK-/DOM-Fixtures isolieren den Browservertrag; echte RLS-, Auth-, Storage- und Browserabnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InboxPage } from "../features/notifications/api";
import { Shell } from "./shell";
import "../lib/i18n";
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "actor", email: "fictional@example.invalid" } },
  }),
}));
vi.mock("../features/profile/avatar", () => ({ Avatar: () => <span>A</span> }));
vi.mock("../lib/supabase", () => ({ db: () => ({ auth: { signOut } }) }));
vi.mock("@tanstack/react-query", async (original) => {
  const actual = await original<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (options: { queryKey: string[] }) => ({
      data:
        options.queryKey[0] === "profile"
          ? {
              active: true,
              display_name: "Fictional User",
              time_zone: "Europe/Berlin",
            }
          : options.queryKey[0] === "notifications" &&
              options.queryKey[2] === "preview"
            ? ({
                items: [],
                unread_count: 0,
                as_of: "2026-11-15T12:00:00Z",
              } satisfies InboxPage)
            : [],
      isPending: false,
      isError: false,
    }),
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
/** Rendert die zu prüfende Oberfläche mit lokalen Provider-/Routerfixtures und einem isolierten QueryClient. */
function setup() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  const client = new QueryClient();
  client.setQueryData(["private", "actor"], "Owned private data");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<p>Private workspace</p>} />
          </Route>
          <Route path="/login" element={<p>Login screen</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}
describe("server-confirmed logout", () => {
  it.each(["returned", "rejected"])(
    "keeps the workspace/cache on a %s sign-out failure and permits retry",
    async (mode) => {
      if (mode === "returned")
        signOut.mockResolvedValueOnce({
          error: new Error("Server unavailable"),
        });
      else signOut.mockRejectedValueOnce(new Error("Network unavailable"));
      const { client, user } = setup();
      await user.click(screen.getByRole("button", { name: "Abmelden" }));
      expect(await screen.findByRole("alert")).toBeVisible();
      expect(screen.getByText("Private workspace")).toBeVisible();
      expect(client.getQueryData(["private", "actor"])).toBe(
        "Owned private data",
      );
      signOut.mockResolvedValueOnce({ error: null });
      await user.click(screen.getByRole("button", { name: "Abmelden" }));
      expect(await screen.findByText("Login screen")).toBeVisible();
      expect(client.getQueryData(["private", "actor"])).toBeUndefined();
    },
  );
  it("does not clear private data or submit twice before server acknowledgement", async () => {
    let complete!: (value: { error: null }) => void;
    signOut.mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      }),
    );
    const { client, user } = setup();
    await user.click(screen.getByRole("button", { name: "Abmelden" }));
    expect(screen.getByRole("button", { name: "Abmelden" })).toBeDisabled();
    expect(client.getQueryData(["private", "actor"])).toBe(
      "Owned private data",
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    complete({ error: null });
    await waitFor(() => expect(screen.getByText("Login screen")).toBeVisible());
  });
});
