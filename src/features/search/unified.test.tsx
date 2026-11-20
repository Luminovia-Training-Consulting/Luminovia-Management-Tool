/** Component/DTO regressions protect cursor fidelity, draft lifetime and safe links. */
import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import i18n from "../../lib/i18n";
import {PortalSearch} from "./search";
import {unifiedSearchPageSchema, unifiedSearchQuery} from "./unified-api";

const state = vi.hoisted(() => ({rpc: vi.fn(), actor: "actor-a"}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: state.rpc})}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: state.actor}}}),
}));
const clients: QueryClient[] = [];
const row = {
    id: "48a4e00a-5dbb-44f5-8bc0-5a52f77c771d",
    kind: "wiki",
    title: "Needle private draft",
    detail: "",
    url: "/wiki?page=48a4e00a-5dbb-44f5-8bc0-5a52f77c771d",
};
beforeEach(async () => {
    await i18n.changeLanguage("de");
    state.actor = "actor-a";
    state.rpc.mockImplementation((_name, args) => {
        const data = args.p_after_id
            ? {items: [], has_more: false, next_cursor: null}
            : {
                items: [row],
                has_more: true,
                next_cursor: {
                    kind: "wiki",
                    title: "i\u0307 server cursor",
                    id: row.id,
                },
            };
        const request = Promise.resolve({data, error: null});
        return Object.assign(request, {abortSignal: () => request});
    });
});
afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    vi.clearAllMocks();
});

function view() {
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false, gcTime: 0}},
    });
    clients.push(client);
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/search?q=Needle&kind=wiki"]}>
                <PortalSearch/>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

it("uses authenticated server search and exact server-provided stable cursor rather than locale-guessing or client-side truncation", async () => {
    view();
    expect(
        await screen.findByRole("link", {name: /Needle private draft/}),
    ).toHaveAttribute("href", row.url);
    await userEvent.click(
        screen.getByRole("button", {name: "Weitere Treffer laden"}),
    );
    await waitFor(() =>
        expect(state.rpc).toHaveBeenCalledWith("unified_search", {
            p_query: "Needle",
            p_kind: "wiki",
            p_after_kind: "wiki",
            p_after_title: "i\u0307 server cursor",
            p_after_id: row.id,
            p_limit: 40,
        }),
    );
    expect(state.rpc.mock.calls.every(([, args]) => !("p_user_id" in args))).toBe(
        true,
    );
    expect(unifiedSearchQuery("actor-a", "Needle", "").queryKey).not.toEqual(
        unifiedSearchQuery("actor-b", "Needle", "").queryKey,
    );
});
it("preserves an unsaved search across language changes", async () => {
    view();
    const field = await screen.findByRole("searchbox", {name: "Suchbegriff"});
    await userEvent.clear(field);
    await userEvent.type(field, "My draft");
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByRole("searchbox", {name: "Search term"})).toBe(field);
    expect(field).toHaveValue("My draft");
});
it.each([
    {
        items: [{...row, kind: "tasks", url: "/workbench?task=" + row.id}],
        has_more: false,
        next_cursor: null,
    },
    {
        items: [{...row, url: "javascript:alert(1)"}],
        has_more: false,
        next_cursor: null,
    },
    {
        items: [{...row, url: "/\\foreign.example.invalid"}],
        has_more: false,
        next_cursor: null,
    },
    {
        items: [{...row, url: "//foreign.example.invalid"}],
        has_more: false,
        next_cursor: null,
    },
    {
        items: [{...row, kind: "private-database"}],
        has_more: false,
        next_cursor: null,
    },
    {items: [row], has_more: true, next_cursor: null},
])(
    "rejects malformed or executable results before rendering: %j",
    (invalid) => {
        expect(unifiedSearchPageSchema.safeParse(invalid).success).toBe(false);
    },
);