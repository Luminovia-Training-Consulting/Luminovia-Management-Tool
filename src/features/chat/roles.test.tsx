/**
 * Regressions for staff capabilities and separate participant controls. Mocked UI projections do
 * not establish database room access.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ChatPage } from "./chat";

const { state, rpc } = vi.hoisted(() => ({
  state: { role: "owner" },
  rpc: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor-a" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ role: state.role }], error: null }),
      }),
    }),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(role: string) {
  state.role = role;
  rpc.mockImplementation(async (name: string) => ({
    data: name === "ensure_general_chat" ? "general-room" : [],
    error: null,
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("chat functional role controls", () => {
  it.each(["owner", "admin"])(
    "%s can access lecturer lounge and group creation without a separate lecturer role",
    async (role) => {
      setup(role);
      const user = userEvent.setup();
      expect(
        await screen.findByRole("button", {
          name: "Gruppe erstellen",
        }),
      ).toBeEnabled();
      await user.click(
        await screen.findByRole("button", {
          name: /Dozierenden-Lounge öffnen/,
        }),
      );
      expect(rpc).toHaveBeenCalledWith("ensure_general_chat");
    },
  );
  it("participants do not receive staff-only chat controls", async () => {
    setup("participant");
    await screen.findByText("Hier beginnt der Austausch.", { exact: false });
    expect(
      screen.queryByRole("button", { name: "Gruppe erstellen" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Dozierenden-Lounge öffnen/ }),
    ).toBeNull();
  });
});
