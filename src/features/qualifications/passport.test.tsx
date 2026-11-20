/** Explicit own export must preserve offline and identity-abort boundaries.
 * Mocked download/role results do not stand in for SQL or native PDF tests. */
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, fireEvent, render, screen, waitFor,} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {OwnQualificationPassport} from "./passport";
import i18n from "../../lib/i18n";

const state = vi.hoisted(() => ({
    roles: ["lecturer"],
    online: true,
    download: vi.fn(),
}));
vi.mock("../../lib/queries", () => ({
    userRolesQuery: (actor: string) => ({
        queryKey: ["roles", actor],
        queryFn: async () => state.roles,
    }),
}));
vi.mock("../../lib/online", () => ({useOnline: () => state.online}));
vi.mock("./passport-api", () => ({
    downloadQualificationPassport: (...args: unknown[]) =>
        state.download(...args),
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
            <OwnQualificationPassport actor="11111111-1111-4111-8111-111111111111"/>
        </QueryClientProvider>,
    );
}

beforeEach(async () => {
    state.roles = ["lecturer"];
    state.online = true;
    state.download.mockReset().mockResolvedValue(undefined);
    await i18n.changeLanguage("de");
});
afterEach(cleanup);
it("downloads only after explicit action and sends locale without a subject ID", async () => {
    show();
    const button = await screen.findByRole("button", {
        name: "Qualifikationspass als PDF herunterladen",
    });
    expect(state.download).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(state.download).toHaveBeenCalledOnce());
    expect(state.download.mock.calls[0]).toEqual(["de", expect.any(AbortSignal)]);
});
it("blocks offline export and hides the lecturer export for participants", async () => {
    state.online = false;
    const view = show();
    expect(
        await screen.findByRole("button", {
            name: "Qualifikationspass als PDF herunterladen",
        }),
    ).toBeDisabled();
    view.unmount();
    state.roles = ["participant"];
    show();
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(state.download).not.toHaveBeenCalled();
});
it("aborts pending download when its identity boundary unmounts", async () => {
    state.download.mockImplementation(() => new Promise(() => {
    }));
    const view = show();
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Qualifikationspass als PDF herunterladen",
        }),
    );
    await waitFor(() => expect(state.download).toHaveBeenCalledOnce());
    const signal = state.download.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
});
it("offers English download and reports unsupported characters honestly", async () => {
    await i18n.changeLanguage("en");
    state.download.mockRejectedValue(new Error("unsupported_glyph"));
    show();
    fireEvent.click(
        await screen.findByRole("button", {
            name: "Download qualification passport as PDF",
        }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
        "not supported by the PDF font",
    );
    expect(state.download.mock.calls[0][0]).toBe("en");
});