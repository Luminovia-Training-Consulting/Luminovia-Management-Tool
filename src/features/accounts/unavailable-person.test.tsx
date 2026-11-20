/** Blocked public profiles retain only server-authorized account controls. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {UnavailablePerson} from "./unavailable-person";

const fake = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: "manager"}}}),
}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: fake.rpc})}));
vi.mock("./person-actions", () => ({
    PersonManagementActions: ({id}: { id: string }) => (
        <output>Manage {id}</output>
    ),
}));
let cache: QueryClient;

function mount() {
    cache = new QueryClient({defaultOptions: {queries: {retry: false}}});
    render(
        <QueryClientProvider client={cache}>
            <MemoryRouter>
                <UnavailablePerson id="blocked-user" retry={() => {
                }}/>
            </MemoryRouter>
        </QueryClientProvider>,
    );
}

afterEach(() => {
    cleanup();
    cache?.clear();
    vi.clearAllMocks();
});
it("keeps management for the server-authorized blocked account", async () => {
    fake.rpc.mockResolvedValue({
        data: {display_name: "Fictional blocked lecturer"},
        error: null,
    });
    mount();
    expect(
        await screen.findByText("Fictional blocked lecturer"),
    ).toBeInTheDocument();
    expect(screen.getByText("Manage blocked-user")).toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledWith("managed_profile", {
        p_user_id: "blocked-user",
    });
});
it("shows no account controls when the server denies management", async () => {
    fake.rpc.mockResolvedValue({data: null, error: {code: "42501"}});
    mount();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("Manage blocked-user")).not.toBeInTheDocument();
});