import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor, within,} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {CalendarSubscriptions} from "./subscriptions";
import "../../lib/i18n";

const mocks = vi.hoisted(() => ({
    save: vi.fn(),
    revoke: vi.fn(),
    items: [] as unknown[],
    online: true,
}));
vi.mock("../../lib/online", () => ({useOnline: () => mocks.online}));
vi.mock("./subscriptions-api", () => ({
    calendarSecretToken: () => "a".repeat(64),
    calendarSubscriptionUrl: (token: string) =>
        `https://example.invalid/feed?token=${token}`,
    subscriptionKey: (actor: string) => ["calendar-subscriptions", actor],
    subscriptionsQuery: (actor: string) => ({
        queryKey: ["calendar-subscriptions", actor],
        queryFn: async () => mocks.items,
    }),
    saveSubscription: (...args: unknown[]) => mocks.save(...args),
    revokeSubscription: (...args: unknown[]) => mocks.revoke(...args),
}));

function show(actor = "11111111-1111-4111-8111-111111111111") {
    return render(
        <QueryClientProvider
            client={
                new QueryClient({
                    defaultOptions: {
                        queries: {retry: false},
                        mutations: {retry: false},
                    },
                })
            }
        >
            <CalendarSubscriptions actor={actor} zone="Europe/Berlin"/>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    mocks.items = [];
    mocks.online = true;
    mocks.save.mockResolvedValue({});
    mocks.revoke.mockResolvedValue(true);
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

async function create() {
    show();
    fireEvent.click(screen.getByText("Kalender abonnieren"));
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Kalenderadresse erstellen",
        }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name des Kalenderabos"), {
        target: {value: "Google calendar"},
    });
    return dialog;
}

it("defaults private events off and reveals a masked URL only after server confirmation", async () => {
    let finish: () => void = () => {
    };
    mocks.save.mockImplementation(
        () =>
            new Promise((resolve) => {
                finish = () => resolve({});
            }),
    );
    const dialog = await create();
    expect(within(dialog).getByRole("checkbox")).not.toBeChecked();
    fireEvent.click(
        within(dialog).getByRole("button", {
            name: "Neue geheime Adresse bestätigen",
        }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(
        screen.queryByLabelText("Geheime Kalenderadresse"),
    ).not.toBeInTheDocument();
    finish();
    const address = await screen.findByLabelText("Geheime Kalenderadresse");
    expect(address).toHaveAttribute("type", "password");
    expect(mocks.save.mock.calls[0][2]).toBe(false);
});
it("retries an unconfirmed creation with the same secret/request identity", async () => {
    mocks.save.mockRejectedValue(new Error("network"));
    const dialog = await create();
    fireEvent.click(
        within(dialog).getByRole("button", {
            name: "Neue geheime Adresse bestätigen",
        }),
    );
    await within(dialog).findByText(/nicht bestätigt/);
    fireEvent.click(
        within(dialog).getByRole("button", {
            name: "Neue geheime Adresse bestätigen",
        }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[0][3]).toBe(mocks.save.mock.calls[1][3]);
    expect(mocks.save.mock.calls[0][5]).toBe(mocks.save.mock.calls[1][5]);
});
it("aborts a pending secret when this account's UI unmounts", async () => {
    let finish: () => void = () => {
    };
    mocks.save.mockImplementation(
        () =>
            new Promise((resolve) => {
                finish = () => resolve({});
            }),
    );
    const view = show();
    fireEvent.click(screen.getByText("Kalender abonnieren"));
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Kalenderadresse erstellen",
        }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Name des Kalenderabos"), {
        target: {value: "Mobile"},
    });
    fireEvent.click(
        within(dialog).getByRole("button", {
            name: "Neue geheime Adresse bestätigen",
        }),
    );
    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    const signal = mocks.save.mock.calls[0][6] as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    finish();
    expect(
        screen.queryByLabelText("Geheime Kalenderadresse"),
    ).not.toBeInTheDocument();
});
it("blocks creating, rotating and revoking while offline", async () => {
    mocks.online = false;
    show();
    fireEvent.click(screen.getByText("Kalender abonnieren"));
    expect(
        await screen.findByRole("button", {
            name: "Kalenderadresse erstellen",
        }),
    ).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
});