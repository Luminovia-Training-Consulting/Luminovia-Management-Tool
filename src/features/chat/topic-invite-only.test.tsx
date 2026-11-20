import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import i18n from "../../lib/i18n";
import {CreateGroup, MembersPanel} from "./manage";
import type {ChatRoom} from "./types";

const fake = vi.hoisted(() => ({rpc: vi.fn(), mode: true}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: fake.rpc})}));
const clients: QueryClient[] = [];

function view(node: React.ReactNode) {
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    clients.push(client);
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter>{node}</MemoryRouter>
        </QueryClientProvider>,
    );
    return client;
}

beforeEach(async () => {
    await i18n.changeLanguage("de");
    fake.mode = true;
    fake.rpc
        .mockReset()
        .mockImplementation(async (name: string, args: Record<string, unknown>) => {
            if (name === "chat_contacts")
                return {
                    data: [
                        {id: "peer", display_name: "Fictional Peer", roles: ["lecturer"]},
                    ],
                    error: null,
                };
            if (name === "chat_room_members")
                return {
                    data: [
                        {
                            user_id: "owner",
                            display_name: "Owner",
                            joined_at: "2026-01-01",
                        },
                    ],
                    error: null,
                };
            if (name === "topic_invitation_only")
                return {data: fake.mode, error: null};
            if (name === "topic_invitation_sent") return {data: [], error: null};
            if (name === "set_topic_invitation_only") {
                fake.mode = Boolean(args.p_enabled);
                return {data: fake.mode, error: null};
            }
            return {data: "confirmed-room", error: null};
        });
});
afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    vi.restoreAllMocks();
});
it("creates strict topic groups with pending invitees via one confirmed RPC", async () => {
    const user = userEvent.setup(),
        onRoom = vi.fn();
    view(
        <CreateGroup
            actor="owner"
            canManageCourses={false}
            open
            onOpenChange={() => undefined}
            onRoom={onRoom}
        />,
    );
    await user.type(screen.getByLabelText("Gruppenname"), "Fictional strict");
    await user.click(
        screen.getByRole("checkbox", {name: "Nur mit angenommener Einladung"}),
    );
    expect(screen.getByText(/erst nach Annahme Mitglied/)).toBeVisible();
    await user.click(
        await screen.findByRole("checkbox", {name: "Fictional Peer"}),
    );
    await user.click(screen.getByRole("button", {name: "Gruppe erstellen"}));
    await waitFor(() => expect(onRoom).toHaveBeenCalledWith("confirmed-room"));
    expect(fake.rpc).toHaveBeenCalledWith("create_invitation_only_topic", {
        p_title: "Fictional strict",
        p_invitee_ids: ["peer"],
    });
    expect(fake.rpc).not.toHaveBeenCalledWith(
        "create_chat_group",
        expect.anything(),
    );
});
it("hides direct addition in strict mode, keeps invitations and enables direct form only after confirmation", async () => {
    const user = userEvent.setup();
    const room: ChatRoom = {
        id: "room",
        kind: "topic",
        title: "Fictional",
        job_id: null,
        owner_id: "owner",
        unread_count: 0,
        last_message_at: null,
        muted: false,
    };
    view(
        <MembersPanel
            actor="owner"
            room={room}
            onLeft={() => undefined}
            canManage
            open
            onOpenChange={() => undefined}
        />,
    );
    expect(
        await screen.findByText("Nur nach angenommener Einladung"),
    ).toBeVisible();
    expect(screen.queryByLabelText("Person hinzufügen")).not.toBeInTheDocument();
    expect(
        screen.getByRole("button", {name: "Einladung senden"}),
    ).toBeVisible();
    await user.click(
        screen.getByRole("button", {name: "Direkte Aufnahme erlauben"}),
    );
    await screen.findByLabelText("Person hinzufügen");
    expect(fake.rpc).toHaveBeenCalledWith("set_topic_invitation_only", {
        p_room_id: "room",
        p_expected: true,
        p_enabled: false,
    });
});
it("never exposes direct addition while the group mode is unknown", async () => {
    const room: ChatRoom = {
        id: "room",
        kind: "topic",
        title: "Fictional",
        job_id: null,
        owner_id: "owner",
        unread_count: 0,
        last_message_at: null,
        muted: false,
    };
    fake.rpc.mockImplementation(async (name: string) =>
        name === "topic_invitation_only"
            ? {data: null, error: {code: "42501"}}
            : name === "chat_room_members"
                ? {data: [], error: null}
                : name === "chat_contacts"
                    ? {data: [], error: null}
                    : {data: [], error: null},
    );
    view(
        <MembersPanel
            actor="owner"
            room={room}
            onLeft={() => undefined}
            canManage
            open
            onOpenChange={() => undefined}
        />,
    );
    await screen.findByRole("alert");
    expect(screen.queryByLabelText("Person hinzufügen")).not.toBeInTheDocument();
});