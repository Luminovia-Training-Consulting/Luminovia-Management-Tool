/** Replies preserve retry identity and never render markup from message text. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import i18n from "../../lib/i18n";
import {MessageBubble} from "./message";
import {MessageComposer} from "./composer";
import type {ChatMessage} from "./types";

const fake = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: fake.rpc})}));
const parent: ChatMessage = {
    id: "parent",
    room_id: "room",
    sender_id: "sender",
    sender_name: "Fictional",
    body: "<img> private parent",
    created_at: "2035-01-01T00:00:00Z",
    edited_at: null,
    deleted_at: null,
    document_id: null,
    reactions: [],
};
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function setup(node: React.ReactNode) {
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    const wrap = (value: React.ReactNode) => (
        <QueryClientProvider client={client}>
            <MemoryRouter>{value}</MemoryRouter>
        </QueryClientProvider>
    );
    const page = render(wrap(node));
    return {
        ...page,
        update: (value: React.ReactNode) => page.rerender(wrap(value)),
        client,
    };
}

it("shows a safe current preview and removes it when the server reports it unavailable", async () => {
    await i18n.changeLanguage("de");
    const bubble = (reply: ChatMessage["reply"]) => (
        <MessageBubble
            actor="viewer"
            message={{...parent, id: "reply", body: "A reply", reply}}
            now={0}
            zone="UTC"
        />
    );
    const page = setup(
        bubble({
            id: "parent",
            sender_name: "Fictional",
            body: "<img> private parent",
        }),
    );
    expect(screen.getByText("<img> private parent")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    page.update(bubble(null));
    expect(
        screen.getByText("Die ursprüngliche Nachricht ist nicht verfügbar."),
    ).toBeVisible();
    expect(screen.queryByText("<img> private parent")).not.toBeInTheDocument();
    page.client.clear();
});
it("binds the target to stable failed retries and blocks sending when the original disappears", async () => {
    await i18n.changeLanguage("de");
    fake.rpc.mockResolvedValue({data: null, error: {code: "network"}});
    const composer = (target?: ChatMessage) => (
        <MessageComposer
            actor="viewer"
            room="room"
            replyId="parent"
            replyTarget={target}
            onCancelReply={() => {
            }}
        />
    );
    const page = setup(composer(parent));
    const user = userEvent.setup();
    expect(screen.getByText("Antwort an Fictional")).toBeVisible();
    await user.type(
        screen.getByLabelText("Deine Nachricht"),
        "Fictional response",
    );
    for (let i = 0; i < 2; i++) {
        await user.click(screen.getByRole("button", {name: "Nachricht senden"}));
        await screen.findByRole("alert");
    }
    expect(fake.rpc.mock.calls).toHaveLength(2);
    expect(fake.rpc.mock.calls[0]).toEqual([
        "send_chat_reply",
        expect.objectContaining({
            p_reply_to_id: "parent",
            p_body: "Fictional response",
        }),
    ]);
    expect(fake.rpc.mock.calls[0][1]).toEqual(fake.rpc.mock.calls[1][1]);
    page.update(composer(undefined));
    expect(
        screen.getByText("Die ursprüngliche Nachricht ist nicht verfügbar."),
    ).toBeVisible();
    expect(screen.queryByText("<img> private parent")).not.toBeInTheDocument();
    expect(
        screen.getByRole("button", {name: "Nachricht senden"}),
    ).toBeDisabled();
    expect(screen.getByLabelText("Deine Nachricht")).toHaveValue(
        "Fictional response",
    );
    page.client.clear();
});

it("fails the whole history page if membership is revoked before the reply projection", async () => {
    const {chatMessagesQuery} = await import("./api");
    fake.rpc.mockImplementation(async (name: string) => {
        if (name === "chat_messages_with_mentions")
            return {data: [parent], error: null};
        if (name === "chat_reply_previews")
            return {data: null, error: {code: "42501"}};
        throw new Error(`Unexpected RPC ${name}`);
    });
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}},
    });
    await expect(
        client.fetchInfiniteQuery(chatMessagesQuery("viewer", "room", "")),
    ).rejects.toMatchObject({code: "42501"});
    expect(fake.rpc).toHaveBeenCalledWith("chat_reply_previews", {
        p_room_id: "room",
        p_message_ids: ["parent"],
        p_versions: [1],
    });
    expect(
        client.getQueryData(["chat-messages", "viewer", "room", ""]),
    ).toBeUndefined();
    client.clear();
});