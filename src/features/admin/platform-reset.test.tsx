import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  vi.unstubAllEnvs();
});

function renderReset() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<PlatformResetPage />} />
          <Route path="/reset-status" element={<p>Reset result page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("keeps the explicit confirmation outside the password form and rejects an autofilled username", async () => {
  await i18n.changeLanguage("de");
  const fetch = vi.fn(async () => Response.json({ project: "fixture" }));
  vi.stubGlobal("fetch", fetch);
  renderReset();
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

it("posts the hosted confirmation only when both passwords are ready and waits for server completion", async () => {
  vi.stubEnv("DEV", false);
  await i18n.changeLanguage("en");
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ instance: "https://cms.luminovia.org" }),
    )
    .mockResolvedValueOnce(
      Response.json({ status: "backup_required" }, { status: 412 }),
    )
    .mockResolvedValueOnce(Response.json({ status: "complete" }));
  vi.stubGlobal("fetch", fetch);
  renderReset();

  const confirmation = await screen.findByLabelText(
    "Type RESET CONFIRM to confirm",
  );
  const password = screen.getByLabelText("Current password");
  const replacement = screen.getByLabelText(
    "New owner password (at least 16 characters)",
  );
  const repeated = screen.getByLabelText("Repeat the new password");
  const submit = screen.getByRole("button", {
    name: "Delete all data in this installation",
  });
  const fillPasswords = () => {
    fireEvent.change(password, { target: { value: "fictional-current" } });
    fireEvent.change(replacement, {
      target: { value: "fictional-replacement" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(repeated, { target: { value: "fictional-replacement" } });
  };

  fireEvent.change(confirmation, { target: { value: "DELETE" } });
  fillPasswords();
  expect(submit).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(1);
  fireEvent.change(confirmation, { target: { value: "RESET CONFIRM" } });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "encrypted backup",
  );
  expect(replacement).toHaveValue("");
  expect(screen.queryByText("Reset result page")).toBeNull();
  expect(fetch).toHaveBeenLastCalledWith("/__portal/hosted-reset", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fixture",
    },
    body: JSON.stringify({
      confirmation: "RESET CONFIRM",
      password: "fictional-current",
      newPassword: "fictional-replacement",
    }),
  });

  fillPasswords();
  fireEvent.click(submit);
  expect(await screen.findByText("Reset result page")).toBeInTheDocument();
});
