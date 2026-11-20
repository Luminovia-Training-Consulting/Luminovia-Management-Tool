import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {LecturerCompensation} from "./lecturer-compensation";
import "../../lib/i18n";

const state = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: state.rpc})}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: "admin"}}}),
}));
afterEach(cleanup);
beforeEach(() => state.rpc.mockReset());

function show(permissions = ["finance.gross.read"]) {
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false, staleTime: Infinity}},
    });
    client.setQueryData(["permissions", "admin"], permissions);
    render(
        <QueryClientProvider client={client}>
            <LecturerCompensation userId="lecturer-a"/>
        </QueryClientProvider>,
    );
    return client;
}

it("keeps rates hidden without current administrative pricing permission", () => {
    show([]);
    expect(screen.queryByText("Dozentenhonorar")).not.toBeInTheDocument();
    expect(state.rpc).not.toHaveBeenCalled();
});
it("defaults to50percent and EUR200daily, confirms save only after server response", async () => {
    const initial = {
        mode: "percent",
        percent: 50,
        daily_rate: 200,
        currency: "EUR",
        version: 1,
        is_customized: false,
    };
    let cfg = initial;
    let resolve!: (value: unknown) => void;
    const pending = new Promise((r) => (resolve = r));
    state.rpc.mockImplementation(async (name: string) =>
        name === "get_my_permissions"
            ? {data: ["finance.gross.read"], error: null}
            : name === "lecturer_compensation"
                ? {data: cfg, error: null}
                : pending,
    );
    const user = userEvent.setup();
    show();
    expect(await screen.findByLabelText("Honorarart")).toHaveValue("percent");
    expect(screen.getByText(/rollenabhängige Standard/)).toBeVisible();
    expect(screen.getByLabelText("Anteil am Kundenbudget (%)")).toHaveValue(50);
    await user.selectOptions(screen.getByLabelText("Honorarart"), "daily");
    expect(screen.getByLabelText("Honorar pro Unterrichtstag")).toHaveValue(200);
    await user.click(screen.getByRole("button", {name: "Honorar speichern"}));
    expect(screen.queryByText("Honorar gespeichert.")).not.toBeInTheDocument();
    expect(state.rpc).toHaveBeenCalledWith("save_lecturer_compensation", {
        p_user_id: "lecturer-a",
        p_mode: "daily",
        p_percent: 50,
        p_daily_rate: 200,
        p_currency: "EUR",
        p_expected_version: 1,
    });
    await act(async () => {
        cfg = {...initial, mode: "daily", version: 2, is_customized: true};
        resolve({data: cfg, error: null});
    });
    await waitFor(() =>
        expect(screen.getByText("Honorar gespeichert.")).toBeVisible(),
    );
});