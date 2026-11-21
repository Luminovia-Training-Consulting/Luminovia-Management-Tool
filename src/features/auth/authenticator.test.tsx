import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AuthenticatorGate, AuthenticatorSettings } from "./authenticator";
import { PasswordRecovery } from "./password";

const api = vi.hoisted(() => ({
  rpc: vi.fn(),
  signOut: vi.fn(),
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
}));
vi.mock("./auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-privileged-user" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ rpc: api.rpc, auth: { mfa: api, signOut: api.signOut } }),
}));
vi.mock("../../components/preferences", () => ({ Preferences: () => null }));

function renderAuthenticator(page: React.ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{page}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const actor = "fictional-privileged-user";
const verified = {
  id: "verified-device",
  factor_type: "totp",
  status: "verified",
  friendly_name: "Fictional device",
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("connects a factor from the server-authorized settings and discards a prior unfinished pairing", async () => {
  const stale = {
    id: "unfinished-device",
    factor_type: "totp",
    status: "unverified",
    friendly_name: "Portal authenticator",
  };
  api.rpc.mockResolvedValue({ data: true, error: null });
  api.listFactors.mockResolvedValueOnce({
    data: { all: [stale], totp: [] },
    error: null,
  });
  api.listFactors.mockResolvedValue({
    data: { all: [verified], totp: [verified] },
    error: null,
  });
  api.unenroll.mockResolvedValue({ error: null });
  api.enroll.mockResolvedValue({
    data: {
      id: verified.id,
      totp: {
        secret: "FICTIONALFIXTURE",
        qr_code: "data:image/svg+xml;utf-8,%3Csvg%3E",
      },
    },
    error: null,
  });
  api.challengeAndVerify.mockResolvedValue({ error: null });
  const user = userEvent.setup();
  renderAuthenticator(<AuthenticatorSettings actor={actor} />);
  await user.click(
    await screen.findByRole("button", { name: "Connect authenticator app" }),
  );
  expect(api.rpc).toHaveBeenCalledWith("authenticator_settings_available");
  expect(api.unenroll).toHaveBeenCalledWith({ factorId: stale.id });
  expect(api.enroll).toHaveBeenCalledWith(
    expect.objectContaining({ factorType: "totp" }),
  );
  await user.type(await screen.findByLabelText("6-digit code"), "012345");
  await user.click(screen.getByRole("button", { name: "Verify" }));
  expect(api.challengeAndVerify).toHaveBeenCalledWith({
    factorId: verified.id,
    code: "012345",
  });
  expect(
    await screen.findByText("Your authenticator app is connected."),
  ).toBeVisible();
  expect(screen.queryByText("FICTIONALFIXTURE")).not.toBeInTheDocument();
});

it("keeps the German challenge closed after a rejected code and rechecks access after successful verification", async () => {
  await i18n.changeLanguage("de");
  api.listFactors.mockResolvedValue({
    data: { all: [verified], totp: [verified] },
    error: null,
  });
  api.challengeAndVerify.mockResolvedValueOnce({
    error: new Error("wrong code"),
  });
  api.challengeAndVerify.mockResolvedValue({ error: null });
  const onVerified = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderAuthenticator(
    <AuthenticatorGate actor={actor} onVerified={onVerified} />,
  );
  expect(
    await screen.findByRole("heading", { name: "Anmeldung bestätigen" }),
  ).toBeVisible();
  const code = screen.getByLabelText("6-stelliger Code");
  await user.type(code, "981234");
  const button = screen.getByRole("button", { name: "Bestätigen" });
  await user.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Der Code konnte nicht bestätigt werden.",
  );
  expect(onVerified).not.toHaveBeenCalled();
  await user.clear(code);
  await user.type(code, "456780");
  await user.click(button);
  expect(onVerified).toHaveBeenCalledOnce();
});

it("does not query or offer factors when the current account has no settings grant", async () => {
  api.rpc.mockResolvedValue({ data: false, error: null });
  renderAuthenticator(<AuthenticatorSettings actor={actor} />);
  expect(screen.queryByText("Authenticator app")).not.toBeInTheDocument();
  expect(api.listFactors).not.toHaveBeenCalled();
});

it("keeps the password reset form behind the native authenticator requirement", async () => {
  api.getAuthenticatorAssuranceLevel
    .mockResolvedValueOnce({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    })
    .mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
      error: null,
    });
  api.listFactors.mockResolvedValue({
    data: { all: [verified], totp: [verified] },
    error: null,
  });
  api.challengeAndVerify.mockResolvedValue({ error: null });
  const user = userEvent.setup();
  renderAuthenticator(<PasswordRecovery />);
  await user.type(await screen.findByLabelText("6-digit code"), "012345");
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Verify" }));
  expect(await screen.findByLabelText("New password")).toBeVisible();
});
