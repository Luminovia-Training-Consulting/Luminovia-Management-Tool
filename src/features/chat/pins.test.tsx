/** Server-confirmed pin state and failure behavior in the room directory. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import i18n from "../../lib/i18n";
import {ChatPage} from "./chat";

const fake = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: "actor"}}}),
}));
vi.mock("../../lib/supabase", () => ({
    db: () => ({
        rpc: fake.rpc,
        from: () => ({
            select: () => ({eq: async () => ({data: [], error: null})}),
        }),
    }),
}));
vi.mock("./thread", () => ({ChatThread: () => null}));
const rooms = [
    {
        id: "room-a",
        kind: "topic",
        title: "Alpha",
        muted: false,
        unread_count: 0,
    },
    {id: "room-b", kind: "topic", title: "Beta", muted: false, unread_count: 0},
];
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

it("pins only after server confirmation, persists across re-fetch and preserves other room order", async () => {
    await i18n.changeLanguage("de");
    let pinned: string[] = [];
    let confirm!: (result: unknown) => void;
    fake.rpc.mockImplementation(async (name: string) => {
        if (name === "chat_rooms_with_manual_unread")
            return {data: rooms, error: null};
        if (name === "chat_pinned_rooms") return {data: pinned, error: null};
        if (name === "set_chat_pin")
            return new Promise((resolve) => {
                confirm = resolve;
            });
        return {data: [], error: null};
    });
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <ChatPage/>
            </MemoryRouter>
        </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(
        await screen.findByRole("button", {name: "Beta anheften"}),
    );
    expect(fake.rpc).toHaveBeenCalledWith("set_chat_pin", {
        p_room_id: "room-b",
        p_pinned: true,
    });
    expect(screen.getByRole("button", {name: "Beta anheften"})).toHaveAttribute(
        "aria-pressed",
        "false",
    );
    pinned = ["room-b"];
    confirm({data: null, error: null});
    expect(
        await screen.findByRole("button", {name: "Beta lösen"}),
    ).toHaveAttribute("aria-pressed", "true");
    const list = screen
        .getByRole("button", {name: "Beta lösen"})
        .closest("ul")!;
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Beta");
    client.clear();
});

it("reports failure without presenting an unconfirmed pin", async () => {
    await i18n.changeLanguage("en");
    fake.rpc.mockImplementation(async (name: string) => ({
        data: name === "chat_rooms_with_manual_unread" ? rooms : [],
        error: name === "set_chat_pin" ? {code: "42501"} : null,
    }));
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <ChatPage/>
            </MemoryRouter>
        </QueryClientProvider>,
    );
    await userEvent.click(
        await screen.findByRole("button", {name: "Pin Beta"}),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
        "could not be confirmed",
    );
    expect(screen.getByRole("button", {name: "Pin Beta"})).toHaveAttribute(
        "aria-pressed",
        "false",
    );
    client.clear();
    await i18n.changeLanguage("de");
});

it("reorders only after confirmation and binds the reviewed order", async () => {
    await i18n.changeLanguage("de");
    let pinned = ["room-a", "room-b"];
    let finish!: (result: unknown) => void;
    fake.rpc.mockImplementation(async (name: string) => {
        if (name === "chat_rooms_with_manual_unread")
            return {data: rooms, error: null};
        if (name === "chat_pinned_rooms") return {data: pinned, error: null};
        if (name === "move_chat_pin")
            return new Promise((resolve) => {
                finish = resolve;
            });
        return {data: [], error: null};
    });
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>
                <ChatPage/>
            </MemoryRouter>
        </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const move = await screen.findByRole("button", {
        name: "Beta nach oben verschieben",
    });
    await user.click(move);
    expect(fake.rpc).toHaveBeenCalledWith("move_chat_pin", {
        p_room_id: "room-b",
        p_direction: "up",
        p_expected_order: ["room-a", "room-b"],
    });
    const list = move.closest("ul")!;
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Alpha");
    pinned = ["room-b", "room-a"];
    finish({error: null});
    await screen.findByRole("button", {name: "Alpha nach oben verschieben"});
    await vi.waitFor(() =>
        expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("Beta"),
    );
    expect(
        screen.getByRole("button", {name: "Beta nach oben verschieben"}),
    ).toBeDisabled();
    client.clear();
});