/**
 * Regressions for denied resource access, separate drafts and exact retries after uncertain
 * comment mutations. Controlled responses do not establish real resource permissions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ResourceComments } from "./comments";
import i18n from "../../lib/i18n";
import * as cursorRows from "../../lib/cursor-rows";
import * as dates from "../../lib/dates";

const mock = vi.hoisted(() => ({
  actor: "teacher-a",
  rpc: vi.fn(),
  readSignal: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: mock.actor } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: (name: string, parameters: Record<string, unknown>) => {
      const response = mock.rpc(name, parameters);
      return Object.assign(response, {
        abortSignal(signal: AbortSignal) {
          mock.readSignal(name, parameters, signal);
          return response;
        },
      });
    },
  }),
}));

const clients: QueryClient[] = [];

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(id = "job-a") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  const app = (resource: string) => (
    <QueryClientProvider client={client}>
      <ResourceComments kind="job" resourceId={resource} />
    </QueryClientProvider>
  );
  return { ...render(app(id)), app };
}

function savedComments(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    author_id: "teacher-b",
    author_name: "Lecturer",
    body: "Saved comment " + index,
    version: 1,
    hidden: false,
    withdrawn: false,
    moderation_reason: "",
    created_at: "2026-10-04T09:00:00Z",
    updated_at: "2026-10-04T09:00:00Z",
    mine: false,
  }));
}

beforeEach(async () => {
  mock.actor = "teacher-a";
  mock.readSignal.mockClear();
  mock.rpc.mockReset().mockImplementation(async (name: string) => ({
    data:
      name === "comment_context" ? { can_post: true, can_moderate: false } : [],
    error: null,
  }));
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  for (const client of clients.splice(0)) client.clear();
});

describe("resource comment boundaries", () => {
  it("does not fetch or render private discussion rows when its context is denied", async () => {
    mock.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "denied" },
    });
    setup();
    await screen.findByText(
      "Diese Diskussion ist dem berechtigten Lehrteam vorbehalten.",
    );
    expect(
      mock.rpc.mock.calls.every(([name]) => name === "comment_context"),
    ).toBe(true);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("does not carry an unsent draft into another job or authenticated actor", async () => {
    const user = userEvent.setup(),
      view = setup();
    await user.type(
      await screen.findByLabelText("Dein Kommentar"),
      "Private draft A",
    );
    view.rerender(view.app("job-b"));
    expect(await screen.findByLabelText("Dein Kommentar")).toHaveValue("");
    await user.type(screen.getByLabelText("Dein Kommentar"), "Private draft B");
    mock.actor = "teacher-b";
    view.rerender(view.app("job-b"));
    expect(await screen.findByLabelText("Dein Kommentar")).toHaveValue("");
  });

  it("reuses the loaded comment list while editing the draft", async () => {
    const order = vi.spyOn(cursorRows, "orderedCursorRows");
    const formatDate = vi.spyOn(dates, "dateTime");
    const rows = savedComments(30);
    mock.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "comment_context"
          ? { can_post: true, can_moderate: false }
          : rows,
      error: null,
    }));
    const user = userEvent.setup();
    setup();
    await screen.findByText("Saved comment 0");
    const input = screen.getByLabelText("Dein Kommentar");
    expect(screen.getAllByRole("listitem")).toHaveLength(rows.length);
    expect(formatDate).toHaveBeenCalled();
    order.mockClear();
    formatDate.mockClear();

    await user.type(input, "A new draft");

    expect(input).toHaveValue("A new draft");
    expect(order).not.toHaveBeenCalled();
    expect(formatDate).not.toHaveBeenCalled();
  });

  it("keeps the first page visible and retries only the failed continuation", async () => {
    const rows = savedComments(40);
    const older = { ...rows[0], id: "older", body: "Older saved comment" };
    let available = false;
    mock.rpc.mockImplementation(
      async (name: string, params: { p_before_id?: string }) => {
        if (name === "comment_context")
          return {
            data: { can_post: true, can_moderate: false },
            error: null,
            status: 200,
          };
        if (!params.p_before_id)
          return { data: rows, error: null, status: 200 };
        return available
          ? { data: [older], error: null, status: 200 }
          : {
              data: null,
              error: { code: "503", message: "temporary" },
              status: 503,
            };
      },
    );

    const user = userEvent.setup();
    setup();
    await user.click(
      await screen.findByRole("button", { name: "Ältere Kommentare laden" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Weitere Ergebnisse konnten gerade nicht geladen werden.",
    );
    expect(screen.getByText("Saved comment 0")).toBeVisible();

    available = true;
    await user.click(
      screen.getByRole("button", { name: "Weitere Ergebnisse erneut laden" }),
    );
    await screen.findByText(older.body);
    expect(screen.getByText("Saved comment 0")).toBeVisible();
    expect(
      mock.rpc.mock.calls
        .filter(([name]) => name === "resource_comments")
        .map(([, params]) => params.p_before_id),
    ).toEqual([null, "39", "39", "39", "39"]);
  });

  it("hides cached comments when the continuation is denied", async () => {
    mock.rpc.mockImplementation(
      async (name: string, params: { p_before_id?: string }) => {
        if (name === "comment_context")
          return {
            data: { can_post: true, can_moderate: false },
            error: null,
            status: 200,
          };
        return params.p_before_id
          ? {
              data: null,
              error: { code: "42501", message: "denied" },
              status: 403,
            }
          : { data: savedComments(40), error: null, status: 200 };
      },
    );

    const user = userEvent.setup();
    setup();
    await user.click(
      await screen.findByRole("button", { name: "Ältere Kommentare laden" }),
    );
    await screen.findByText(
      "Diese Diskussion ist dem berechtigten Lehrteam vorbehalten.",
    );
    expect(screen.queryByText("Saved comment 0")).not.toBeInTheDocument();
  });

  it("cancels the pending history request when navigating to another resource", async () => {
    mock.rpc.mockImplementation(
      async (name: string, params: { p_id: string }) => {
        if (name === "comment_context")
          return {
            data: { can_post: true, can_moderate: false },
            error: null,
            status: 200,
          };
        if (params.p_id === "job-a") return new Promise(() => undefined);
        return { data: [], error: null, status: 200 };
      },
    );

    const view = setup();
    await waitFor(() =>
      expect(mock.rpc).toHaveBeenCalledWith(
        "resource_comments",
        expect.objectContaining({ p_id: "job-a" }),
      ),
    );
    view.rerender(view.app("job-b"));

    const signal = mock.readSignal.mock.calls.find(
      ([name, params]) =>
        name === "resource_comments" && params.p_id === "job-a",
    )?.[2];
    expect(signal?.aborted).toBe(true);
    await screen.findByLabelText("Dein Kommentar");
  });

  it("preserves a rejected draft and retries the exact request identity; success waits for acknowledgement", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    let posts = 0;
    mock.rpc.mockImplementation(async (name: string) => {
      if (name === "comment_context")
        return { data: { can_post: true, can_moderate: false }, error: null };
      if (name === "add_resource_comment") {
        posts++;
        if (posts === 1)
          return await new Promise((resolve) => {
            finish = resolve;
          });
        return { data: "886d741d-5fa4-4ce5-8b3e-87e2d2836b5a", error: null };
      }
      return { data: [], error: null };
    });
    setup();
    const input = await screen.findByLabelText("Dein Kommentar");
    await user.type(input, "A note that must survive network failure");
    await user.click(
      screen.getByRole("button", { name: "Kommentar veröffentlichen" }),
    );
    await waitFor(() => expect(input).toBeDisabled());
    expect(
      screen.queryByText("Dein Kommentar wurde gespeichert."),
    ).not.toBeInTheDocument();
    finish({ data: null, error: { code: "503", message: "temporary" } });
    await screen.findByRole("alert");
    expect(input).toHaveValue("A note that must survive network failure");
    await user.click(
      screen.getByRole("button", { name: "Kommentar veröffentlichen" }),
    );
    await screen.findByText("Dein Kommentar wurde gespeichert.");
    expect(input).toHaveValue("");
    const calls = mock.rpc.mock.calls.filter(
      ([name]) => name === "add_resource_comment",
    );
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toEqual(calls[1][1]);
  });
});
