/**
 * Vitest-Regressionen für MFA-Challenge-/Enrollmentfehler und wiederholbare Bedienzustände. SDK-/DOM-Fixtures isolieren den Browservertrag; echte RLS-, Auth-, Storage- und Browserabnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { Security } from "./security";

const fake = vi.hoisted(() => ({
  getAuthenticatorAssuranceLevel: vi.fn(),
  listFactors: vi.fn(),
  unenroll: vi.fn(),
  enroll: vi.fn(),
  challengeAndVerify: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("./auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "mfa-actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ auth: { mfa: fake }, rpc: fake.rpc }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
beforeEach(() => {
  Object.values(fake).forEach((method) => method.mockReset());
  fake.getAuthenticatorAssuranceLevel.mockResolvedValue({
    data: { currentLevel: "aal1" },
    error: null,
  });
  fake.listFactors.mockResolvedValue({
    data: { all: [], totp: [] },
    error: null,
  });
  fake.rpc.mockResolvedValue({ data: [], error: null });
  fake.unenroll.mockResolvedValue({ data: {}, error: null });
  fake.enroll.mockResolvedValue({
    data: {
      id: "new-factor",
      totp: { qr_code: "data:image/svg+xml;base64,AA==" },
    },
    error: null,
  });
  fake.challengeAndVerify.mockResolvedValue({ data: {}, error: null });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});
afterEach(cleanup);
/** Rendert die untersuchte Komponente mit den für diesen Test notwendigen lokalen Providern. */
function view() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Security />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
const existingFactor = { id: "verified-factor", status: "verified" };

describe("recoverable MFA state", () => {
  it("retains an already confirmed AAL2 session without an unnecessary factor lookup", async () => {
    fake.getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal2" },
      error: null,
    });
    fake.listFactors.mockRejectedValueOnce(
      new Error("Factor lookup unavailable"),
    );
    view();
    expect(await screen.findByText("mfaReady")).toBeVisible();
    expect(fake.listFactors).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("does not offer new enrolment before existing factors finish loading", async () => {
    let resolve!: (value: unknown) => void;
    fake.listFactors.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    view();
    expect(
      screen.queryByRole("button", { name: "mfaEnroll" }),
    ).not.toBeInTheDocument();
    await vi.waitFor(() => expect(fake.listFactors).toHaveBeenCalledOnce());
    resolve({
      data: { all: [existingFactor], totp: [existingFactor] },
      error: null,
    });
    expect(await screen.findByLabelText("mfaCode")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "mfaEnroll" }),
    ).not.toBeInTheDocument();
    expect(fake.enroll).not.toHaveBeenCalled();
  });
  it("reports a rejected initial request and permits an explicit enrolment retry", async () => {
    fake.getAuthenticatorAssuranceLevel.mockRejectedValueOnce(
      new Error("Transport unavailable"),
    );
    view();
    expect(await screen.findByRole("alert")).toHaveTextContent("error");
    const enroll = screen.getByRole("button", { name: "mfaEnroll" });
    expect(enroll).toBeEnabled();
    await userEvent.click(enroll);
    expect(await screen.findByLabelText("mfaCode")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("releases enrolment after a transport rejection", async () => {
    fake.enroll.mockRejectedValueOnce(new Error("Transport unavailable"));
    view();
    const enroll = await screen.findByRole("button", { name: "mfaEnroll" });
    await userEvent.click(enroll);
    expect(await screen.findByRole("alert")).toHaveTextContent("error");
    expect(enroll).toBeEnabled();
    expect(screen.queryByLabelText("mfaCode")).not.toBeInTheDocument();
  });
  it("does not create another factor if unfinished-factor cleanup fails", async () => {
    const unfinished = { id: "unfinished-factor", status: "unverified" };
    fake.listFactors.mockResolvedValue({
      data: { all: [unfinished], totp: [unfinished] },
      error: null,
    });
    fake.unenroll.mockRejectedValueOnce(new Error("Transport unavailable"));
    view();
    await userEvent.click(
      await screen.findByRole("button", { name: "mfaEnroll" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("error");
    expect(fake.enroll).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "mfaEnroll" })).toBeEnabled();
  });
  it("keeps a failed challenge retryable and confirms only a successful Auth reply", async () => {
    fake.listFactors.mockResolvedValue({
      data: { all: [existingFactor], totp: [existingFactor] },
      error: null,
    });
    fake.challengeAndVerify.mockRejectedValueOnce(
      new Error("Transport unavailable"),
    );
    view();
    await userEvent.type(await screen.findByLabelText("mfaCode"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "mfaVerify" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("error");
    expect(screen.queryByText("mfaReady")).not.toBeInTheDocument();
    const verify = screen.getByRole("button", { name: "mfaVerify" });
    expect(verify).toBeEnabled();
    await userEvent.click(verify);
    expect(await screen.findByRole("status")).toHaveTextContent("mfaReady");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
