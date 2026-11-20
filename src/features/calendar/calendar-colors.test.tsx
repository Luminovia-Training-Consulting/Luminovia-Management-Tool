/** Test actor-owned color updates and fixed light palette without loading shared calendar records. */
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import {CalendarColorPreferences} from "./calendar-colors";

const fake = vi.hoisted(() => ({
    settings: {} as Record<string, any>,
    rpc: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: fake.rpc})}));
vi.mock("../../lib/online", () => ({
    requireOnline: () => undefined,
    useOnline: () => true,
}));

let client: QueryClient;
afterEach(() => {
    cleanup();
    client?.clear();
    vi.clearAllMocks();
});
beforeEach(async () => {
    await i18n.changeLanguage("de");
    client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    fake.settings = {
        personal_event_color: "#E1EDDA",
        assignment_event_color: "#DCE9F8",
        customer_event_color: "#FFF0C5",
        version: 0,
    };
    fake.rpc.mockImplementation(async (name: string, args?: Record<string, any>) => {
        if (name === "get_my_calendar_color_preferences")
            return {data: structuredClone(fake.settings), error: null};
        if (name === "save_my_calendar_color_preferences") {
            fake.settings = {
                personal_event_color: args?.p_personal_event_color,
                assignment_event_color: args?.p_assignment_event_color,
                customer_event_color: args?.p_customer_event_color,
                version: (fake.settings.version as number) + 1,
            };
            return {data: structuredClone(fake.settings), error: null};
        }
        return {data: null, error: {code: "unexpected_rpc"}};
    });
});

it("saves only this actor's versioned palette and displays confirmation", async () => {
    render(
        <QueryClientProvider client={client}>
            <CalendarColorPreferences actor="fictional-calendar-owner"/>
        </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByText("Kalenderfarben"));
    await user.selectOptions(
        screen.getByLabelText("Eigene private Termine"),
        "#E6E0F0",
    );
    await user.selectOptions(
        screen.getByLabelText("Kundenerstellte Kurse und Aufträge"),
        "#F5DDE7",
    );
    await user.click(screen.getByRole("button", {name: "Kalenderfarben speichern"}));
    expect(await screen.findByText("Deine Kalenderfarben wurden gespeichert.")).toBeVisible();
    expect(fake.rpc).toHaveBeenCalledWith(
        "save_my_calendar_color_preferences",
        {
            p_expected_version: 0,
            p_personal_event_color: "#E6E0F0",
            p_assignment_event_color: "#DCE9F8",
            p_customer_event_color: "#F5DDE7",
        },
    );
    expect(fake.settings.version).toBe(1);
});

it("keeps the saved choices private to its actor and reloads the same swatches", async () => {
    render(
        <QueryClientProvider client={client}>
            <CalendarColorPreferences actor="fictional-calendar-owner"/>
        </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByText("Kalenderfarben"));
    const selected = screen.getByLabelText("Eigene private Termine");
    expect(selected).toHaveValue("#E1EDDA");
    await user.selectOptions(
        screen.getByLabelText("Bestätigte Aufträge ohne Auftraggeber"),
        "#DFE6EA",
    );
    await user.click(screen.getByRole("button", {name: "Kalenderfarben speichern"}));
    await screen.findByText("Deine Kalenderfarben wurden gespeichert.");
    expect(fake.settings.assignment_event_color).toBe("#DFE6EA");
    expect(selected).toHaveValue("#E1EDDA");
    expect(
        screen.getByLabelText("Kundenerstellte Kurse und Aufträge"),
    ).toHaveValue("#FFF0C5");
});