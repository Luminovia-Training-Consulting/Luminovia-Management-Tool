import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { PlatformResetPage } from "./platform-reset";

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "fictional-admin" }, access_token: "fixture" },
  }),
}));
vi.mock("../../lib/queries", () => ({
  profileQuery: () => ({
    queryKey: ["fixture-profile"],
    queryFn: async () => ({ active: true }),
  }),
  userRolesQuery: () => ({
    queryKey: ["fixture-roles"],
    queryFn: async () => ["admin"],
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("keeps the explicit confirmation outside the password form and rejects an autofilled username", async () => {
  await i18n.changeLanguage("de");
  const fetch = vi.fn(async () => Response.json({ project: "fixture" }));
  vi.stubGlobal("fetch", fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PlatformResetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const confirmation = (await screen.findByLabelText(
    "Zur Bestätigung DELETE eingeben",
  )) as HTMLInputElement;
  const password = screen.getByLabelText(
    "Aktuelles Passwort",
  ) as HTMLInputElement;
  const submit = screen.getByRole("button", {
    name: "Alle Daten dieser Installation löschen",
  });

  expect(confirmation.form).toBeNull();
  expect(confirmation).toHaveAttribute("autocomplete", "off");
  expect(password.form).toContainElement(submit);

  fireEvent.change(password, { target: { value: "fixture-password" } });
  fireEvent.change(confirmation, {
    target: { value: "admin@example.invalid" },
  });
  expect(submit).toBeDisabled();
  fireEvent.submit(password.form!);
  expect(fetch).toHaveBeenCalledTimes(1);

  fireEvent.change(confirmation, { target: { value: "DELETE" } });
  expect(submit).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});
