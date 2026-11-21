/** Guest settings render only own profile/Auth controls and do not request operational data. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { ProfilePage } from "./profile";

const fake = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "guest-own", email: "guest@example.invalid" } },
  }),
}));
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
it("keeps a guest's own profile usable without loading expertise, permissions or qualification widgets", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockResolvedValue({
    data: { username: "fictional-guest", version: 1 },
    error: null,
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["profile", "guest-own"], {
    id: "guest-own",
    luminovia_user_id: "LV-0001-0002-0003-0004-0005",
    display_name: "Fictional Guest",
    phone: "",
    time_zone: "Europe/Berlin",
    bio_de: "",
    bio_en: "",
    active: true,
  });
  client.setQueryData(["user-roles", "guest-own"], ["guest"]);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByDisplayValue("Fictional Guest")).toBeVisible();
  expect(
    screen.getByText("LV-0001-0002-0003-0004-0005", { exact: true }),
  ).toBeVisible();
  expect(
    screen.getByText("guest@example.invalid", { exact: true }),
  ).toBeVisible();
  expect(screen.queryByText("Fachgebiete & Expertise")).not.toBeInTheDocument();
  expect(document.querySelector(".profile-privacy-grid")).toBeNull();
  expect(fake.from).not.toHaveBeenCalled();
  expect(await screen.findByDisplayValue("fictional-guest")).toBeVisible();
  expect(fake.rpc.mock.calls).toEqual([["account_username"]]);
  expect(client.getQueryState(["topics"])?.fetchStatus).toBe("idle");
  expect(client.getQueryState(["expertise", "guest-own"])?.fetchStatus).toBe(
    "idle",
  );
});
