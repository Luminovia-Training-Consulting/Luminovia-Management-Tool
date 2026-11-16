/** UI transport fixtures prove confirmation/retry boundaries, not actual Auth/Storage deletion. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import {
  CompanyJobDeletions,
  DeletionsPage,
  PermanentDeleteAction,
  PermanentDeletionProvider,
} from "./deletions";
import { deletionAccessQuery, deletionReceiptsQuery } from "./api";

const state = vi.hoisted(() => ({ actor: "actor-a", request: vi.fn() }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../accounts/api", () => ({ accountRequest: state.request }));
const preview = {
  plan_id: "plan-a",
  kind: "job",
  id: "job-a",
  label: "Fictional workshop",
  counts: { jobs: 1, job_sessions: 2 },
  blockers: [],
  can_confirm: true,
  expires_at: "2099-01-01T00:00:00Z",
};
const operation = {
  operation_id: "op-a",
  kind: "job",
  id: "job-a",
  status: "pending",
};
let access = { can_admin: true, kinds: ["job", "account", "document"] };
beforeEach(async () => {
  onlineManager.setOnline(true);
  state.actor = "actor-a";
  access = { can_admin: true, kinds: ["job", "account", "document"] };
  Object.defineProperty(navigator, "onLine", {
    value: true,
    configurable: true,
  });
  await i18n.changeLanguage("de");
  state.request.mockReset().mockImplementation(async (path: string) => {
    if (path === "deletions/access") return access;
    if (path === "deletions/operations") return { items: [] };
    if (path === "deletions/preview") return preview;
    if (path === "deletions/confirm") return operation;
    if (path.startsWith("deletions/operations/"))
      return { ...operation, status: "completed" };
    if (path.startsWith("deletions/resources?"))
      return {
        items: [
          { ...preview, owner_label: "Fictional company", can_delete: true },
        ],
        next_cursor: null,
      };
    throw new Error("unexpected_request");
  });
});
afterEach(() => cleanup());
function setup(
  element = (
    <PermanentDeleteAction kind="job" id="job-a" label="Fictional workshop" />
  ),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const tree = () => (
    <QueryClientProvider client={client}>
      <PermanentDeletionProvider>{element}</PermanentDeletionProvider>
    </QueryClientProvider>
  );
  const view = render(tree());
  return { client, ...view, rerenderActor: () => view.rerender(tree()) };
}
async function open() {
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Endgültig löschen: Fictional workshop",
    }),
  );
  await screen.findByText("Umfang der Löschung");
}
async function acknowledge() {
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Zur Bestätigung DELETE eingeben" }),
    "DELETE",
  );
}
describe("permanent deletion confirmation", () => {
  it("requires reviewed impact, acknowledgement and exact confirmation before starting; pending is not success", async () => {
    setup();
    await open();
    const button = screen.getByRole("button", {
      name: "Jetzt unwiderruflich löschen",
    });
    expect(button).toBeDisabled();
    expect(screen.getByText("Auftragstermine")).toBeVisible();
    await acknowledge();
    await userEvent.click(button);
    expect(
      await screen.findByText(
        "Löschung läuft noch. Die Bereinigung ist noch nicht vollständig bestätigt.",
        { selector: ".deletion-pending" },
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(
        "Die endgültige Löschung wurde vollständig bestätigt.",
      ),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Vorgang erneut prüfen / fortsetzen",
      }),
    );
    expect(
      await screen.findByText(
        "Die endgültige Löschung wurde vollständig bestätigt.",
      ),
    ).toBeVisible();
    expect(state.request).toHaveBeenCalledWith(
      "deletions/operations/op-a",
      "POST",
      {},
    );
  });
  it("retains the exact request identity after a lost confirmation response", async () => {
    let confirmations = 0;
    const initial = state.request.getMockImplementation()!;
    state.request.mockImplementation(async (...args) => {
      if (args[0] === "deletions/confirm" && ++confirmations === 1)
        throw new Error("network_lost");
      return initial(...args);
    });
    setup();
    await open();
    await acknowledge();
    await userEvent.click(
      screen.getByRole("button", { name: "Jetzt unwiderruflich löschen" }),
    );
    await screen.findByText(/Die Anfrage konnte nicht bestätigt werden/);
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Vorgang erneut prüfen / fortsetzen",
      }),
    );
    await waitFor(() => expect(confirmations).toBe(2));
    const calls = state.request.mock.calls.filter(
      ([path]) => path === "deletions/confirm",
    );
    expect(calls[0][2]).toEqual(calls[1][2]);
    expect(calls[0][2]).toMatchObject({
      plan_id: "plan-a",
      confirmation: "DELETE",
    });
  });
  it("shows blockers and never offers confirmation for a protected dependency", async () => {
    const initial = state.request.getMockImplementation()!;
    state.request.mockImplementation((...args) =>
      args[0] === "deletions/preview"
        ? Promise.resolve({
            ...preview,
            can_confirm: false,
            blockers: [
              { code: "referenced", kind: "public.invoices", count: 1 },
            ],
          })
        : initial(...args),
    );
    setup();
    await open();
    expect(screen.getByText("Rechnungen: 1")).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      state.request.mock.calls.some(([path]) => path === "deletions/confirm"),
    ).toBe(false);
  });
  it("requires a fresh explicit review after a changed-scope rejection", async () => {
    const initial = state.request.getMockImplementation()!;
    state.request.mockImplementation((...args) =>
      args[0] === "deletions/confirm"
        ? Promise.reject(new Error("deletion_conflict"))
        : initial(...args),
    );
    setup();
    await open();
    await acknowledge();
    await userEvent.click(
      screen.getByRole("button", { name: "Jetzt unwiderruflich löschen" }),
    );
    await screen.findByText(/Die Anfrage konnte nicht bestätigt werden/);
    expect(
      screen.getByRole("button", { name: "Jetzt unwiderruflich löschen" }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole("button", { name: "Neue Vorschau laden" }),
    );
    await screen.findByText("Umfang der Löschung");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(
      state.request.mock.calls.filter(([path]) => path === "deletions/confirm"),
    ).toHaveLength(1);
  });
  it("does not lose an uncertain confirmation retry when its dialog is closed", async () => {
    const initial = state.request.getMockImplementation()!;
    state.request.mockImplementation((...args) =>
      args[0] === "deletions/confirm"
        ? Promise.reject(new Error("connection_lost"))
        : initial(...args),
    );
    setup();
    await open();
    await acknowledge();
    await userEvent.click(
      screen.getByRole("button", { name: "Jetzt unwiderruflich löschen" }),
    );
    await screen.findByText(/Die Anfrage konnte nicht bestätigt werden/);
    await userEvent.click(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: "Schließen",
      })[1],
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Vorgang erneut prüfen / fortsetzen",
      }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Vorgang erneut prüfen / fortsetzen",
      }),
    );
    await waitFor(() =>
      expect(
        state.request.mock.calls.filter(
          ([path]) => path === "deletions/confirm",
        ),
      ).toHaveLength(2),
    );
    const confirmations = state.request.mock.calls.filter(
      ([path]) => path === "deletions/confirm",
    );
    expect(confirmations[0][2]).toEqual(confirmations[1][2]);
  });
  it("closes and discards a reviewed draft immediately after capability loss", async () => {
    const { client } = setup();
    await open();
    await acknowledge();
    access = { can_admin: false, kinds: [] };
    await act(async () => {
      await client.cancelQueries({
        queryKey: deletionAccessQuery("actor-a").queryKey,
      });
      client.setQueryData(deletionAccessQuery("actor-a").queryKey, {
        can_admin: false,
        kinds: [],
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /Endgültig löschen:/ }),
    ).not.toBeInTheDocument();
  });
  it("does not carry a confirmation into another actor", async () => {
    const view = setup();
    await open();
    await acknowledge();
    state.actor = "actor-b";
    view.rerenderActor();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      state.request.mock.calls.some(([path]) => path === "deletions/confirm"),
    ).toBe(false);
  });
  it("closes the dialog when current operation-list authority is revoked", async () => {
    const { client } = setup();
    await open();
    const initial = state.request.getMockImplementation()!;
    state.request.mockImplementation((...args) =>
      args[0] === "deletions/operations"
        ? Promise.reject(new Error("permission_or_mfa_required"))
        : initial(...args),
    );
    await act(async () => {
      await client.refetchQueries({
        queryKey: deletionReceiptsQuery("actor-a").queryKey,
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("keeps pending cleanup reachable after closing its dialog", async () => {
    setup();
    await open();
    await acknowledge();
    await userEvent.click(
      screen.getByRole("button", { name: "Jetzt unwiderruflich löschen" }),
    );
    await screen.findByText("Vorgang: op-a", { selector: ".muted" });
    await userEvent.click(
      within(screen.getByRole("dialog")).getAllByRole("button", {
        name: "Schließen",
      })[1],
    );
    await userEvent.click(
      screen.getByRole("button", {
        name: "Vorgang erneut prüfen / fortsetzen",
      }),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).queryByRole("textbox"),
    ).not.toBeInTheDocument();
  });
  it("recovers a pending server operation after a fresh browser session", async () => {
    const initial = state.request.getMockImplementation()!;
    state.request.mockImplementation((...args) =>
      args[0] === "deletions/operations"
        ? Promise.resolve({ items: [operation] })
        : initial(...args),
    );
    setup(<p>Fresh session</p>);
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Vorgang erneut prüfen / fortsetzen",
      }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Vorgang: op-a")).toBeVisible();
    expect(
      state.request.mock.calls.some(([path]) => path === "deletions/preview"),
    ).toBe(false);
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: "Vorgang erneut prüfen / fortsetzen",
      }),
    );
    expect(
      await screen.findByText(
        "Die endgültige Löschung wurde vollständig bestätigt.",
      ),
    ).toBeVisible();
  });
  it("rejects expired previews without sending confirmation and requires a fresh review", async () => {
    const initial = state.request.getMockImplementation()!;
    state.request.mockImplementation((...args) =>
      args[0] === "deletions/preview"
        ? Promise.resolve({ ...preview, expires_at: "2020-01-01T00:00:00Z" })
        : initial(...args),
    );
    setup();
    await open();
    await acknowledge();
    await userEvent.click(
      screen.getByRole("button", { name: "Jetzt unwiderruflich löschen" }),
    );
    expect(
      await screen.findByText(/Die Vorschau ist abgelaufen/),
    ).toBeVisible();
    expect(
      state.request.mock.calls.some(([path]) => path === "deletions/confirm"),
    ).toBe(false);
  });
  it("disables irreversible actions when offline", async () => {
    setup();
    await open();
    await acknowledge();
    await act(async () => {
      Object.defineProperty(navigator, "onLine", {
        value: false,
        configurable: true,
      });
      window.dispatchEvent(new Event("offline"));
    });
    expect(
      screen.getByRole("button", { name: "Jetzt unwiderruflich löschen" }),
    ).toBeDisabled();
  });
  it("uses the server company job projection without enabling administrative targets", async () => {
    access = { can_admin: false, kinds: ["job"] };
    setup(
      <>
        <DeletionsPage />
        <CompanyJobDeletions />
      </>,
    );
    expect(
      await screen.findByText("Eigene Aufträge endgültig löschen"),
    ).toBeVisible();
    await screen.findByText("Fictional workshop");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    const calls = state.request.mock.calls.filter(([path]) =>
      path.startsWith("deletions/resources?"),
    );
    expect(calls).toHaveLength(1);
    expect(new URLSearchParams(calls[0][0].split("?")[1]).get("kind")).toBe(
      "job",
    );
  });
  it("renders English confirmation and errors through the same contract", async () => {
    await i18n.changeLanguage("en");
    setup();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Delete permanently: Fictional workshop",
      }),
    );
    expect(await screen.findByText("Deletion impact")).toBeVisible();
    expect(
      screen.getByText(
        "This deletion is irreversible. There is no trash or restore.",
      ),
    ).toBeVisible();
  });
});
