import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { WelcomeGuideEntry, WelcomeGuidePage } from "./welcome";
import { welcomeKey, type WelcomeProgress } from "./api";
import { welcomeSteps } from "./steps";
const { rpc, authActor } = vi.hoisted(() => ({
  rpc: vi.fn(),
  authActor: { id: "guide-user" },
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: authActor } }),
}));
const initial: WelcomeProgress = {
  step: "welcome",
  status: "active",
  version: 0,
};
function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
function mount({
  state = initial,
  roles = ["lecturer"],
  permissions = [] as string[],
  compact = false,
  path = "/",
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  }),
} = {}) {
  client.setQueryData(["user-roles", authActor.id], roles);
  client.setQueryData(["permissions", authActor.id], permissions);
  client.setQueryData(welcomeKey(authActor.id), state);
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={client}>
        {compact ? <WelcomeGuideEntry /> : <WelcomeGuidePage />}
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, client, user: userEvent.setup() };
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  authActor.id = "guide-user";
  rpc.mockReset();
  rpc.mockImplementation((name, args) =>
    name === "get_welcome_progress"
      ? response(initial)
      : name === "save_welcome_progress"
        ? response({
            step: args.p_step,
            status: args.p_status,
            version: args.p_expected_version + 1,
          })
        : Promise.reject(new Error("Unexpected RPC")),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe("server-confirmed personal welcome guide", () => {
  it("introduces each area sequentially and waits for the actual save before advancing", async () => {
    let finish!: (value: unknown) => void;
    rpc.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { user } = mount();
    expect(
      screen.getByRole("heading", { name: "Dein persönlicher Start" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(
      screen.getByRole("button", { name: "Wird gespeichert …" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("heading", { name: "Dein persönlicher Start" }),
    ).toBeVisible();
    await act(() =>
      finish({
        data: { step: "profile", status: "active", version: 1 },
        error: null,
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Profil und Zeitzone" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Bereich öffnen" }),
    ).toHaveAttribute("href", "/profile");
    expect(rpc).toHaveBeenCalledWith("save_welcome_progress", {
      p_step: "profile",
      p_status: "active",
      p_expected_version: 0,
    });
    await user.click(screen.getByRole("button", { name: "Zurück" }));
    expect(
      await screen.findByRole("heading", { name: "Dein persönlicher Start" }),
    ).toBeVisible();
    expect(rpc).toHaveBeenLastCalledWith("save_welcome_progress", {
      p_step: "welcome",
      p_status: "active",
      p_expected_version: 1,
    });
  });
  it("retains the step on failure and reloads the current server version after a tab conflict", async () => {
    const { user, client } = mount({
      state: { step: "profile", status: "active", version: 3 },
    });
    rpc.mockReturnValueOnce(response(null, { code: "40001" }));
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nicht gespeichert",
    );
    expect(client.getQueryData(welcomeKey(authActor.id))).toEqual({
      step: "profile",
      status: "active",
      version: 3,
    });
    rpc.mockReturnValueOnce(
      response({ step: "files", status: "paused", version: 4 }),
    );
    await user.click(
      screen.getByRole("button", { name: "Aktuellen Stand laden" }),
    );
    expect(
      await screen.findByRole("button", { name: "Einführung fortsetzen" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Einführung fortsetzen" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Dateien sicher austauschen",
      }),
    ).toBeVisible();
    expect(rpc).toHaveBeenLastCalledWith("save_welcome_progress", {
      p_step: "files",
      p_status: "active",
      p_expected_version: 4,
    });
  });
  it("pauses, resumes, skips and restarts while preserving own progress across remounts", async () => {
    const { user, client, unmount } = mount({
      state: { step: "calendar", status: "active", version: 5 },
    });
    await user.click(screen.getByRole("button", { name: "Später fortsetzen" }));
    expect(await screen.findByText(/Einführung ist pausiert/)).toBeVisible();
    const saved = client.getQueryData<WelcomeProgress>(
      welcomeKey(authActor.id),
    )!;
    unmount();
    mount({ state: saved, client });
    await user.click(
      screen.getByRole("button", { name: "Einführung fortsetzen" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Termine an einem Ort" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Einführung überspringen" }),
    );
    expect(await screen.findByText(/Einführung übersprungen/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Einführung neu starten" }),
    );
    expect(
      await screen.findByRole("heading", { name: "Dein persönlicher Start" }),
    ).toBeVisible();
  });
  it("completes only at server confirmation and permits later review in English", async () => {
    const { user } = mount({
      state: { step: "finish", status: "active", version: 10 },
    });
    await act(() => i18n.changeLanguage("en"));
    expect(
      screen.getByRole("heading", { name: "Ready for your daily work" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Complete introduction" }),
    );
    expect(await screen.findByText(/You have completed/)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Restart introduction" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Your personal starting point",
      }),
    ).toBeVisible();
  });
  it("does not allow an offline advance or claim local save success", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    mount();
    expect(screen.getByText(/Du bist offline/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Weiter" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Einführung überspringen" }),
    ).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("shows automatic introduction only on the dashboard until completed or skipped", () => {
    const view = mount({ compact: true, path: "/profile" });
    expect(
      screen.queryByRole("heading", { name: "Willkommen bei Luminovia" }),
    ).not.toBeInTheDocument();
    view.unmount();
    const complete = mount({
      compact: true,
      state: { step: "finish", status: "completed", version: 2 },
    });
    expect(
      screen.queryByRole("heading", { name: "Willkommen bei Luminovia" }),
    ).not.toBeInTheDocument();
    complete.unmount();
    mount({ compact: true });
    expect(
      screen.getByRole("heading", { name: "Willkommen bei Luminovia" }),
    ).toBeVisible();
  });
  it("uses current roles and permissions and removes a revoked teaching step", async () => {
    const { client } = mount({
      state: { step: "jobs", status: "active", version: 2 },
    });
    expect(
      screen.getByRole("link", { name: "Bereich öffnen" }),
    ).toHaveAttribute("href", "/jobs");
    await act(() => {
      client.setQueryData(["user-roles", authActor.id], ["guest"]);
    });
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Dein persönlicher Start" }),
      ).toBeVisible(),
    );
    expect(
      screen.queryByRole("link", { name: "Bereich öffnen" }),
    ).not.toBeInTheDocument();
    expect(
      welcomeSteps(["guest"], []).some((step) =>
        ["jobs", "contracts", "administration", "client"].includes(step.id),
      ),
    ).toBe(false);
    expect(
      welcomeSteps(["client"], []).some((step) => step.id === "client"),
    ).toBe(true);
    expect(
      welcomeSteps(["management"], ["users.manage"]).some(
        (step) => step.id === "administration",
      ),
    ).toBe(true);
  });
});
