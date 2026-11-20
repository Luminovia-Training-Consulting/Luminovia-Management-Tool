/** Personal archive renders only confirmed changes and never changes another actor's view. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
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
afterEach(() => {
    cleanup();
    fake.rpc.mockReset();
});
const rooms = [
    {
        id: "topic",
        kind: "topic",
        title: "Fictional group",
        muted: false,
        unread_count: 0,
    },
    {
        id: "course",
        kind: "lecturer_course",
        title: "Fictional course",
        muted: false,
        unread_count: 0,
    },
];
it("archives and restores only after server confirmation, retaining course rooms", async () => {
    await i18n.changeLanguage("de");
    let archived: string[] = [];
    let finish!: (result: unknown) => void;
    fake.rpc.mockImplementation(async (name: string) => {
        if (name === "chat_rooms_with_manual_unread")
            return {data: rooms, error: null};
        if (name === "chat_personal_archives")
            return {data: archived, error: null};
        if (name === "set_chat_personal_archive")
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
    await user.click(
        await screen.findByRole("button", {
            name: "Fictional group persönlich archivieren",
        }),
    );
    expect(fake.rpc).toHaveBeenCalledWith("set_chat_personal_archive", {
        p_room_id: "topic",
        p_archived: true,
    });
    expect(screen.getByText("Fictional group")).toBeVisible();
    expect(
        screen.queryByRole("button", {
            name: "Fictional course persönlich archivieren",
        }),
    ).not.toBeInTheDocument();
    archived = ["topic"];
    finish({error: null});
    await waitFor(() =>
        expect(screen.queryByText("Fictional group")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Fictional course")).toBeVisible();
    await user.click(screen.getByRole("button", {name: "Archiviert"}));
    await user.click(
        screen.getByRole("button", {
            name: "Fictional group persönlich wiederherstellen",
        }),
    );
    expect(fake.rpc).toHaveBeenLastCalledWith("set_chat_personal_archive", {
        p_room_id: "topic",
        p_archived: false,
    });
    archived = [];
    finish({error: null});
    await waitFor(() =>
        expect(screen.queryByText("Fictional group")).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", {name: "Aktiv"}));
    expect(await screen.findByText("Fictional group")).toBeVisible();
    client.clear();
});
it("retains the active conversation when an archive request fails", async () => {
    await i18n.changeLanguage("en");
    fake.rpc.mockImplementation(async (name: string) => ({
        data: name === "chat_rooms_with_manual_unread" ? rooms : [],
        error: name === "set_chat_personal_archive" ? {code: "42501"} : null,
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
        await screen.findByRole("button", {
            name: "Archive Fictional group for me",
        }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
        "could not be confirmed",
    );
    expect(screen.getByText("Fictional group")).toBeVisible();
    client.clear();
    await i18n.changeLanguage("de");
});