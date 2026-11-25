/**
 * Regressions for private search terms, typing drafts and no requests for short terms. UI
 * fixtures do not replace permission-filtered server search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalSearch, type SearchSession } from "./search";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "search-actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
beforeEach(async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockReset().mockImplementation(() => {
    const request = Promise.resolve({
      data: { items: [], has_more: false, next_cursor: null },
      error: null,
    });
    return Object.assign(request, { abortSignal: () => request });
  });
  fake.from.mockReset().mockImplementation(() => {
    const query = {
      select: () => query,
      ilike: () => query,
      is: () => query,
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    return query;
  });
});
afterEach(cleanup);

/** Render the real page in its router/query context for the interaction checks below. */
function page(path = "/search", q = "Alpha") {
  function FixtureShell() {
    const search: SearchSession = useState({ q, kind: "" });
    return <Outlet context={search} />;
  }
  const router = createMemoryRouter(
    [
      {
        element: <FixtureShell />,
        children: [
          { path: "/search", element: <PortalSearch /> },
          { path: "/files", element: <p>Files fixture</p> },
        ],
      },
    ],
    {
      initialEntries: [path],
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe("In-memory portal search", () => {
  it("submits the term without putting it in the URL or navigation state", async () => {
    const router = page("/search", "");
    const input = screen.getByRole("searchbox", { name: "Suchbegriff" });
    await userEvent.type(input, "Fictional private term{Enter}");
    await waitFor(() =>
      expect(fake.rpc).toHaveBeenCalledWith(
        "unified_search",
        expect.objectContaining({ p_query: "Fictional private term" }),
      ),
    );
    expect(router.state.location).toMatchObject({
      pathname: "/search",
      search: "",
      state: null,
    });
  });

  it("retains the last submitted term on in-app return, not the unsaved draft", async () => {
    const router = page();
    const input = screen.getByRole("searchbox", { name: "Suchbegriff" });
    expect(input).toHaveValue("Alpha");
    await userEvent.clear(input);
    await userEvent.type(input, "unfinished draft");
    expect(input).toHaveValue("unfinished draft");
    await act(() => router.navigate("/files"));
    await act(() => router.navigate(-1));
    expect(screen.getByRole("searchbox", { name: "Suchbegriff" })).toHaveValue(
      "Alpha",
    );
  });
  it("scrubs an old query URL without automatically submitting its text", async () => {
    const router = page("/search?q=Fictional%20legacy%20term&kind=wiki", "");
    await waitFor(() => expect(router.state.location.search).toBe(""));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(screen.getByRole("searchbox", { name: "Suchbegriff" })).toHaveValue(
      "",
    );
    expect(fake.rpc).not.toHaveBeenCalled();
  });
  it("does not request any data for a short query", async () => {
    page();
    await waitFor(() => expect(fake.rpc).toHaveBeenCalled());
    fake.rpc.mockClear();
    fake.from.mockClear();
    const input = screen.getByRole("searchbox", { name: "Suchbegriff" });
    await userEvent.clear(input);
    await userEvent.type(input, "x{Enter}");
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });
});

it("links an authorised chat search result to its exact message", async () => {
  const id = "9c05dfad-a359-49be-b391-7837bb03de53";
  const response = Promise.resolve({
    data: {
      items: [
        {
          id,
          title: "Fictional match",
          detail: "",
          kind: "chats",
          url: "/chats?room=room-a",
        },
      ],
      has_more: false,
      next_cursor: null,
    },
    error: null,
  });
  fake.rpc.mockReturnValueOnce(
    Object.assign(response, { abortSignal: () => response }),
  );
  page();
  expect(
    await screen.findByRole("link", { name: /Fictional match/ }),
  ).toHaveAttribute("href", `/chats?room=room-a&message=${id}`);
});
