/**
 * Regressions for safe inbox destinations, confirmed read state and retained drafts after
 * version conflicts. UI/SDK fixtures do not replace native notification authorization.
 */
import {act, cleanup, fireEvent, render, screen, waitFor, within,} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import i18n from "../../lib/i18n";
import {NotificationsPage, SettingsPage} from "./notifications";
import {NotificationsMenu} from "./notifications-menu";
import {mergeNotificationPages, notificationInboxQuery, notificationPreviewQuery,} from "./api";

const state = vi.hoisted(() => ({
    rpc: vi.fn(),
    actor: "actor-a",
    online: true,
    roles: ["lecturer"] as string[],
    rejectMark: false,
    staleSave: false,
    attention: {
        enabled: false,
        start_time: "22:00",
        end_time: "07:00",
        time_zone: "UTC",
        version: 0,
    },
}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: state.rpc})}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: state.actor}}}),
}));
vi.mock("../../lib/queries", () => ({
    userRolesQuery: (actor: string) => ({
        queryKey: ["user-roles", actor],
        queryFn: async () => state.roles,
    }),
    permissionsQuery: (actor: string) => ({
        queryKey: ["permissions", actor],
        queryFn: async () => [],
    }),
    profileQuery: (actor: string) => ({
        queryKey: ["profile", actor],
        queryFn: async () => ({time_zone: "UTC"}),
    }),
}));
vi.mock("../../lib/online", () => ({
    useOnline: () => state.online,
    requireOnline: () => {
        if (!state.online) throw new Error("offline");
    },
}));
const clients: QueryClient[] = [];
const notice = {
    id: "fe82d6cc-91ef-4a98-8a59-c8c90ad7eaa4",
    kind: "claim_confirmed",
    title: "Fictional course <script>text</script>",
    href: "/jobs/job-a",
    read_at: null,
    created_at: "2026-11-15T10:00:00Z",
};
const initialPreferences = {
    chat: true,
    forum: true,
    job_updates: true,
    reminders: true,
    version: 1,
};
beforeEach(async () => {
    vi.stubGlobal("matchMedia", () => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    state.actor = "actor-a";
    state.roles = ["lecturer"];
    state.online = true;
    state.rejectMark = false;
    state.staleSave = false;
    state.attention = {
        enabled: false,
        start_time: "22:00",
        end_time: "07:00",
        time_zone: "UTC",
        version: 0,
    };
    await i18n.changeLanguage("de");
    state.rpc.mockImplementation(
        (name: string, payload?: Record<string, unknown>) => {
            let result: { data: unknown; error: unknown } = {
                data: null,
                error: null,
            };
            if (name === "notification_inbox")
                result.data = {
                    items: payload?.p_unread_only ? [] : [notice],
                    unread_count: 45,
                    as_of: "2026-11-15T11:00:00Z",
                };
            else if (name === "notification_preferences")
                result.data = {...initialPreferences};
            else if (name === "attention_preferences")
                result.data = {...state.attention};
            else if (name === "save_attention_preferences") {
                if (payload?.p_expected_version !== state.attention.version)
                    result = {data: null, error: {code: "40001", message: "stale"}};
                else {
                    state.attention = {
                        ...(payload?.p_payload as Omit<typeof state.attention, "version">),
                        version: state.attention.version + 1,
                    };
                    result.data = {...state.attention};
                }
            } else if (name === "save_notification_preferences")
                result = state.staleSave
                    ? {data: null, error: {code: "40001", message: "stale"}}
                    : {
                        data: {...(payload?.p_payload as object), version: 2},
                        error: null,
                    };
            else if (name === "mark_notifications")
                result = state.rejectMark
                    ? {data: null, error: {code: "42501", message: "denied"}}
                    : {data: 1, error: null};
            else if (name === "refresh_my_notifications") result.data = 0;
            const request = Promise.resolve(result);
            return Object.assign(request, {abortSignal: () => request});
        },
    );
});
afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    vi.clearAllMocks();
});

/** Render the subject with the local providers required by this test. */
function view(component: React.ReactNode) {
    const client = new QueryClient({
        defaultOptions: {
            queries: {retry: false, gcTime: 0},
            mutations: {retry: false},
        },
    });
    clients.push(client);
    client.setQueryData(["user-roles", state.actor], state.roles);
    return render(
        <QueryClientProvider client={client}>
            <MemoryRouter>{component}</MemoryRouter>
        </QueryClientProvider>,
    );
}

describe("connected notification inbox", () => {
    it.each([
        [],
        {items: [], unread_count: -1, as_of: "2026-11-15T11:00:00Z"},
        {
            items: [],
            unread_count: 20,
            quiet_active: true,
            as_of: "2026-11-15T11:00:00Z",
        },
        {
            items: [],
            unread_count: 20,
            quiet_active: false,
            attention_count: 3,
            as_of: "2026-11-15T11:00:00Z",
        },
        {
            items: [],
            unread_count: 20,
            quiet_active: true,
            attention_count: 21,
            as_of: "2026-11-15T11:00:00Z",
        },
        {
            items: [{...notice, href: "//foreign.example.invalid"}],
            unread_count: 1,
            as_of: "2026-11-15T11:00:00Z",
        },
        {
            items: [{...notice, href: "javascript:alert(1)"}],
            unread_count: 1,
            as_of: "2026-11-15T11:00:00Z",
        },
        {
            items: [{...notice, href: "/\\foreign.example.invalid"}],
            unread_count: 1,
            as_of: "2026-11-15T11:00:00Z",
        },
    ])(
        "rejects malformed or unsafe API data instead of rendering it: %j",
        async (data) => {
            const request = Promise.resolve({data, error: null});
            state.rpc.mockReturnValueOnce(
                Object.assign(request, {abortSignal: () => request}),
            );
            const client = new QueryClient({
                defaultOptions: {queries: {retry: false}},
            });
            clients.push(client);
            await expect(
                client.fetchQuery(notificationPreviewQuery("actor-a")),
            ).rejects.toThrow();
        },
    );
    it("renders current safe links as text and uses the global unread count beyond the page", async () => {
        view(<NotificationsPage/>);
        expect(await screen.findByText("45 ungelesen")).toBeVisible();
        expect(screen.getByText(notice.title)).toBeVisible();
        expect(screen.getByRole("link", {name: "Öffnen"})).toHaveAttribute(
            "href",
            "/jobs/job-a",
        );
        expect(document.querySelector("script")).toBeNull();
        await userEvent.click(
            screen.getByRole("button", {
                name: "Alle bisher eingegangenen Meldungen lesen",
            }),
        );
        await waitFor(() =>
            expect(state.rpc).toHaveBeenCalledWith("mark_notifications", {
                p_ids: null,
                p_all_before: "2026-11-15T11:00:00Z",
                p_read: true,
            }),
        );
    });
    it("a failed server acknowledgement keeps the notification unread and offers an honest error", async () => {
        state.rejectMark = true;
        view(<NotificationsPage/>);
        await userEvent.click(
            await screen.findByRole("button", {name: "Als gelesen markieren"}),
        );
        expect(
            await screen.findByText(
                "Das hat nicht geklappt. Deine Änderung wurde nicht bestätigt.",
            ),
        ).toBeVisible();
        expect(
            screen.getByRole("button", {name: "Als gelesen markieren"}),
        ).toBeVisible();
        expect(state.rpc).toHaveBeenCalledWith("mark_notifications", {
            p_ids: [notice.id],
            p_all_before: null,
            p_read: true,
        });
    });
    it("duplicate menu observers share one actor-scoped metadata request", async () => {
        view(
            <>
                <NotificationsMenu id="actor-a" zone="UTC"/>
                <NotificationsMenu id="actor-a" zone="UTC"/>
            </>,
        );
        await waitFor(() => expect(screen.getAllByText("45")).toHaveLength(2));
        expect(
            state.rpc.mock.calls.filter(([name]) => name === "notification_inbox"),
        ).toHaveLength(1);
        expect(notificationPreviewQuery("actor-a").queryKey).not.toEqual(
            notificationPreviewQuery("actor-b").queryKey,
        );
        expect(
            notificationInboxQuery("actor-a", false).refetchInterval,
        ).toBeUndefined();
    });
    it("filters unread items without unmounting the filter and disables offline writes", async () => {
        state.online = false;
        view(<NotificationsPage/>);
        await screen.findByText(notice.title);
        const filter = screen.getByRole("combobox");
        expect(
            screen.getByRole("button", {name: "Als gelesen markieren"}),
        ).toBeDisabled();
        await userEvent.selectOptions(filter, "unread");
        expect(
            await screen.findByText("Hier gibt es gerade keine Meldungen."),
        ).toBeVisible();
        expect(screen.getByRole("combobox")).toBe(filter);
        expect(
            state.rpc.mock.calls.filter(([name]) => name === "mark_notifications"),
        ).toHaveLength(0);
    });
});
describe("versioned notification preferences", () => {
    it("keeps unsaved choices across language changes and saves only current-account fields", async () => {
        view(<SettingsPage/>);
        const chat = await screen.findByRole("checkbox", {
            name: "Neue Chatnachrichten",
        });
        await userEvent.click(chat);
        await act(() => i18n.changeLanguage("en"));
        expect(screen.getByRole("checkbox", {name: "New chat messages"})).toBe(
            chat,
        );
        expect(chat).not.toBeChecked();
        await userEvent.click(screen.getByRole("button", {name: "Save"}));
        expect(await screen.findByText("Preferences saved.")).toBeVisible();
        expect(state.rpc).toHaveBeenCalledWith("save_notification_preferences", {
            p_payload: {
                chat: false,
                forum: true,
                job_updates: true,
                reminders: true,
            },
            p_expected_version: 1,
        });
    });
    it("stale writes preserve the draft until the user explicitly reloads", async () => {
        state.staleSave = true;
        view(<SettingsPage/>);
        const chat = await screen.findByRole("checkbox", {
            name: "Neue Chatnachrichten",
        });
        await userEvent.click(chat);
        await userEvent.click(screen.getByRole("button", {name: "Speichern"}));
        expect(
            await screen.findByText(
                /Deine Einstellungen wurden zwischenzeitlich geändert/,
            ),
        ).toBeVisible();
        expect(chat).not.toBeChecked();
        await userEvent.click(
            screen.getByRole("button", {name: "Aktuellen Stand laden"}),
        );
        await waitFor(() => expect(chat).toBeChecked());
        expect(
            within(
                screen.getByRole("group", {name: "Benachrichtigungen"}),
            ).getAllByRole("checkbox"),
        ).toHaveLength(4);
    });
});

it("the newest fetched copy wins if notification cursor pages overlap", () => {
    const current = {
        ...notice,
        href: null,
        title: "",
        read_at: "2026-11-15T11:00:00Z",
    };
    const rows = mergeNotificationPages([
        {items: [current], unread_count: 0, as_of: current.read_at},
        {items: [notice], unread_count: 1, as_of: notice.created_at},
    ]);
    expect(rows).toEqual([current]);
});

it("opening the inbox closes the native notification popover", async () => {
    view(<NotificationsMenu id="actor-a" zone="UTC"/>);
    const summary = await screen.findByLabelText(
        "Benachrichtigungen: 45 ungelesen",
    );
    expect(summary).toHaveAccessibleName("Benachrichtigungen: 45 ungelesen");
    await userEvent.click(summary);
    const menu = summary.closest("details")!;
    expect(menu).toHaveAttribute("open");
    await userEvent.click(
        await screen.findByRole("link", {name: "Alle Benachrichtigungen"}),
    );
    await waitFor(() => expect(menu).not.toHaveAttribute("open"));
});

describe("effective quiet-hour settings", () => {
    it("retains an unsaved time/checkbox across language changes and saves its independent version", async () => {
        view(<SettingsPage/>);
        await userEvent.click(screen.getByText("Ruhezeiten & Zustellung"));
        const enabled = await screen.findByRole("checkbox", {
            name: "Tägliche Ruhezeit aktivieren",
        });
        const start = screen.getByLabelText("Beginn der Ruhezeit");
        await userEvent.click(enabled);
        fireEvent.change(start, {target: {value: "21:30"}});
        await act(() => i18n.changeLanguage("en"));
        expect(screen.getByLabelText("Quiet hours start")).toBe(start);
        expect(start).toHaveValue("21:30");
        expect(
            screen.getByRole("checkbox", {name: "Enable daily quiet hours"}),
        ).toBeChecked();
        await userEvent.click(
            screen.getByRole("button", {name: "Save quiet hours"}),
        );
        expect(await screen.findByText("Quiet hours saved.")).toBeVisible();
        expect(state.rpc).toHaveBeenCalledWith("save_attention_preferences", {
            p_payload: {
                enabled: true,
                start_time: "21:30",
                end_time: "07:00",
                time_zone: "UTC",
            },
            p_expected_version: 0,
        });
        expect(
            state.rpc.mock.calls.filter(
                ([name]) => name === "save_notification_preferences",
            ),
        ).toHaveLength(0);
    });
    it("a stale server version keeps the quiet draft until explicit reload", async () => {
        view(<SettingsPage/>);
        await userEvent.click(screen.getByText("Ruhezeiten & Zustellung"));
        const enabled = await screen.findByRole("checkbox", {
            name: "Tägliche Ruhezeit aktivieren",
        });
        await userEvent.click(enabled);
        state.attention = {
            enabled: false,
            start_time: "23:00",
            end_time: "06:00",
            time_zone: "Europe/Berlin",
            version: 2,
        };
        await userEvent.click(
            screen.getByRole("button", {name: "Ruhezeiten speichern"}),
        );
        expect(
            await screen.findByText(
                /Die Ruhezeiten wurden zwischenzeitlich geändert/,
            ),
        ).toBeVisible();
        expect(enabled).toBeChecked();
        await userEvent.click(
            screen.getByRole("button", {name: "Aktuelle Ruhezeiten laden"}),
        );
        await waitFor(() => expect(enabled).not.toBeChecked());
        expect(screen.getByLabelText("Beginn der Ruhezeit")).toHaveValue("23:00");
        expect(screen.getByLabelText("Zeitzone der Ruhezeit")).toHaveValue(
            "Europe/Berlin",
        );
    });
    it("offline edits remain a local draft and cannot issue a preference mutation", async () => {
        state.online = false;
        view(<SettingsPage/>);
        await userEvent.click(screen.getByText("Ruhezeiten & Zustellung"));
        await userEvent.click(
            await screen.findByRole("checkbox", {
                name: "Tägliche Ruhezeit aktivieren",
            }),
        );
        const save = screen.getByRole("button", {name: "Ruhezeiten speichern"});
        expect(save).toBeDisabled();
        await userEvent.click(save);
        expect(
            state.rpc.mock.calls.filter(
                ([name]) => name === "save_attention_preferences",
            ),
        ).toHaveLength(0);
    });
    it("invalid editable zones show a useful error instead of sending or confirming them", async () => {
        view(<SettingsPage/>);
        await userEvent.click(screen.getByText("Ruhezeiten & Zustellung"));
        await screen.findByRole("checkbox", {
            name: "Tägliche Ruhezeit aktivieren",
        });
        const zone = screen.getByLabelText("Zeitzone der Ruhezeit");
        await userEvent.clear(zone);
        await userEvent.type(zone, "Not/AZone");
        await userEvent.click(
            screen.getByRole("button", {name: "Ruhezeiten speichern"}),
        );
        expect(
            await screen.findByText(
                "Prüfe Uhrzeiten und Zeitzone, zum Beispiel Europe/Berlin.",
            ),
        ).toBeVisible();
        expect(
            state.rpc.mock.calls.filter(
                ([name]) => name === "save_attention_preferences",
            ),
        ).toHaveLength(0);
    });
    it("the quiet bell preserves the full inbox counter and exposes only critical attention without acknowledging anything", async () => {
        const request = Promise.resolve({
            data: {
                items: [],
                unread_count: 20,
                quiet_active: true,
                attention_count: 3,
                as_of: "2026-11-15T11:00:00Z",
            },
            error: null,
        });
        state.rpc.mockReturnValueOnce(
            Object.assign(request, {abortSignal: () => request}),
        );
        view(<NotificationsMenu id="actor-a" zone="UTC"/>);
        expect(await screen.findByText("3")).toBeVisible();
        expect(
            screen.getByLabelText(
                "Benachrichtigungen: 3 wichtige ungelesene Meldungen; Ruhezeit aktiv; 20 insgesamt ungelesen",
            ),
        ).toBeVisible();
        expect(
            clients
                .at(-1)!
                .getQueryData(notificationPreviewQuery("actor-a").queryKey),
        ).toMatchObject({unread_count: 20, attention_count: 3});
        expect(
            state.rpc.mock.calls.filter(([name]) => name === "mark_notifications"),
        ).toHaveLength(0);
    });
});

it("guest settings load only appearance and own-profile links without notification RPCs", async () => {
    state.roles = ["guest"];
    view(<SettingsPage/>);
    expect(
        await screen.findByRole("link", {name: "Profil bearbeiten"}),
    ).toBeVisible();
    expect(screen.queryByText("Ruhezeiten & Zustellung")).not.toBeInTheDocument();
    expect(
        screen.queryByText("Benachrichtigungen einstellen"),
    ).not.toBeInTheDocument();
    expect(
        state.rpc.mock.calls.some(([name]) =>
            [
                "notification_preferences",
                "attention_preferences",
                "notification_delivery_preferences",
            ].includes(name),
        ),
    ).toBe(false);
});
it("filters only loaded preview categories and retains invoice and message rows under All", async () => {
    const invoice = {
        ...notice,
        id: "65e9754a-5475-41fc-85d7-f33a263f08a2",
        kind: "invoice_paid",
        title: "Fictional paid invoice",
        href: "/finance",
    };
    state.rpc.mockImplementation((name: string) => {
        const request = Promise.resolve({
            data:
                name === "notification_inbox"
                    ? {
                        items: [notice, invoice],
                        unread_count: 45,
                        as_of: "2026-11-15T11:00:00Z",
                    }
                    : null,
            error: null,
        });
        return Object.assign(request, {abortSignal: () => request});
    });
    view(<NotificationsMenu id="actor-a" zone="UTC"/>);
    fireEvent.click(document.querySelector(".notification-menu>summary")!);
    await screen.findByText(invoice.title);
    await userEvent.click(screen.getByRole("button", {name: "Finanzen"}));
    expect(screen.getByText(invoice.title)).toBeVisible();
    expect(screen.queryByText(notice.title)).not.toBeInTheDocument();
    expect(
        screen.getByText(
            "Filtert die zuletzt geladenen Meldungen dieser Vorschau.",
        ),
    ).toBeVisible();
    await userEvent.click(screen.getByRole("button", {name: "Alle"}));
    expect(screen.getByText(notice.title)).toBeVisible();
    expect(screen.getByText(invoice.title)).toBeVisible();
});
it("shows a participant's course inbox without offering operational preferences or reminder refresh", async () => {
    state.roles = ["participant"];
    const courseNotice = {
        ...notice,
        kind: "course_resource_shared",
        title: "Fictional learning material",
        href: "/courses/course-a/workspace",
    };
    state.rpc.mockImplementation((name: string) => {
        if (name !== "notification_inbox") throw new Error("unexpected participant RPC");
        const request = Promise.resolve({
            data: {items: [courseNotice], unread_count: 1, as_of: "2026-11-15T11:00:00Z"},
            error: null,
        });
        return Object.assign(request, {abortSignal: () => request});
    });
    view(<NotificationsPage/>);
    expect(await screen.findByText("Fictional learning material")).toBeVisible();
    expect(screen.getByRole("link", {name: "Öffnen"})).toHaveAttribute(
        "href", "/courses/course-a/workspace",
    );
    expect(screen.queryByRole("link", {name: /Einstellungen|Preferences/})).toBeNull();
    expect(state.rpc.mock.calls.map(([name]) => name)).toEqual(["notification_inbox"]);
});
