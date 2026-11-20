import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor,} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {PushSettings} from "./push-settings";
import "../../lib/i18n";

const mocks = vi.hoisted(() => ({
    status: {
        enabled: true,
        public_key: "B".repeat(87),
        devices: [] as { id: string; label: string; device_token: string }[],
    },
    register: vi.fn(),
    remove: vi.fn(),
    subscribe: vi.fn(),
    bind: vi.fn(),
    clear: vi.fn(),
    online: true,
    supported: true,
    capability: "ready",
    token: null as string | null,
}));
vi.mock("./push-api", () => ({
    pushKey: (actor: string) => ["push-devices", actor],
    pushDevicesQuery: (actor: string) => ({
        queryKey: ["push-devices", actor],
        queryFn: async () => mocks.status,
    }),
    registerPushDevice: (...args: unknown[]) => mocks.register(...args),
    removePushDevice: (...args: unknown[]) => mocks.remove(...args),
}));
vi.mock("./push-browser", () => ({
    pushSupported: () => mocks.supported,
    pushCapability: () => (mocks.supported ? mocks.capability : "unsupported"),
    currentPushToken: async () => mocks.token,
    browserSubscription: (...args: unknown[]) => mocks.subscribe(...args),
    bindPushDevice: (...args: unknown[]) => mocks.bind(...args),
    clearPushDevice: () => mocks.clear(),
}));
vi.mock("../../lib/online", () => ({
    useOnline: () => mocks.online,
    requireOnline: () => {
        if (!mocks.online) throw new Error("offline");
    },
}));

function show() {
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
            <PushSettings actor="11111111-1111-4111-8111-111111111111"/>
        </QueryClientProvider>,
    );
}

beforeEach(() => {
    mocks.online = true;
    mocks.supported = true;
    mocks.capability = "ready";
    mocks.token = null;
    mocks.status = {enabled: true, public_key: "B".repeat(87), devices: []};
    mocks.register.mockResolvedValue("id");
    mocks.bind.mockResolvedValue(undefined);
    mocks.subscribe.mockResolvedValue({
        toJSON: () => ({endpoint: "https://fcm.googleapis.com/token", keys: {}}),
        unsubscribe: vi.fn(),
    });
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});
it("does not request browser permission merely by rendering", async () => {
    show();
    await screen.findByRole("button", {
        name: "Push auf diesem Gerät aktivieren",
    });
    expect(mocks.subscribe).not.toHaveBeenCalled();
});
it("only binds a device after server registration succeeds", async () => {
    let complete: (value: string) => void = () => {
    };
    mocks.register.mockImplementation(
        () =>
            new Promise<string>((resolve) => {
                complete = resolve;
            }),
    );
    show();
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Push auf diesem Gerät aktivieren",
        }),
    );
    await waitFor(() => expect(mocks.register).toHaveBeenCalledOnce());
    expect(mocks.bind).not.toHaveBeenCalled();
    complete("id");
    await waitFor(() => expect(mocks.bind).toHaveBeenCalledOnce());
    expect(await screen.findByText("Push-Einstellung bestätigt.")).toBeVisible();
});
it("unsubscribes browser registration when server denies registration", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    mocks.subscribe.mockResolvedValue({toJSON: () => ({}), unsubscribe});
    mocks.register.mockRejectedValue(new Error("denied"));
    show();
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Push auf diesem Gerät aktivieren",
        }),
    );
    expect(
        await screen.findByText(/Push konnte nicht geändert werden/),
    ).toBeVisible();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.bind).not.toHaveBeenCalled();
});
it("keeps unsupported platforms and disabled server explicit", async () => {
    mocks.supported = false;
    show();
    expect(
        screen.getByText(/Dieser Browser unterstützt Push hier nicht/),
    ).toBeVisible();
    expect(mocks.subscribe).not.toHaveBeenCalled();
});
it("blocks subscription while offline", async () => {
    mocks.online = false;
    show();
    expect(
        await screen.findByRole("button", {
            name: "Push auf diesem Gerät aktivieren",
        }),
    ).toBeDisabled();
    expect(mocks.subscribe).not.toHaveBeenCalled();
});
it("allows renewed consent when server device remains but native subscription was lost", async () => {
    mocks.status.devices = [
        {id: "stale-native", label: "Old browser", device_token: "old-token"},
    ];
    show();
    expect(
        await screen.findByRole("button", {
            name: "Push auf diesem Gerät aktivieren",
        }),
    ).toBeEnabled();
    fireEvent.click(
        screen.getByRole("button", {name: "Push auf diesem Gerät aktivieren"}),
    );
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
});
it("explains denied permissions and iPhone installation without requesting consent", async () => {
    mocks.capability = "blocked";
    const view = show();
    expect(
        screen.getByText(/Benachrichtigungen sind im Browser gesperrt/),
    ).toBeVisible();
    expect(mocks.subscribe).not.toHaveBeenCalled();
    view.unmount();
    mocks.capability = "install";
    show();
    expect(screen.getByText(/Teilen → Zum Home-Bildschirm/)).toBeVisible();
    expect(
        screen.queryByRole("button", {name: "Push auf diesem Gerät aktivieren"}),
    ).not.toBeInTheDocument();
});
it("only removes an own device after server confirmation", async () => {
    mocks.status.devices = [
        {id: "own", label: "Fictional", device_token: "token"},
    ];
    mocks.remove.mockResolvedValue(false);
    show();
    fireEvent.click(
        await screen.findByRole("button", {name: "Gerät entfernen"}),
    );
    expect(
        await screen.findByText(/Push konnte nicht geändert werden/),
    ).toBeVisible();
    expect(mocks.clear).not.toHaveBeenCalled();
});
it("does not clear another login when current-device removal finishes after unmount", async () => {
    mocks.token = "token";
    mocks.status.devices = [
        {id: "own", label: "Fictional", device_token: "token"},
    ];
    let complete: (value: boolean) => void = () => {
    };
    mocks.remove.mockImplementation(
        () =>
            new Promise<boolean>((resolve) => {
                complete = resolve;
            }),
    );
    const view = show();
    await screen.findByText(/Dieses Gerät ist verbunden/);
    fireEvent.click(screen.getByRole("button", {name: "Gerät entfernen"}));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    view.unmount();
    complete(true);
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce());
    expect(mocks.clear).not.toHaveBeenCalled();
});