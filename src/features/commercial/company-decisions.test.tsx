import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import "./platform-i18n";
import {CompanyDecisions} from "./company-decisions";

const fake = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("../../lib/supabase", () => ({db: () => fake}));
afterEach(() => {
    cleanup();
    fake.rpc.mockReset();
});

it("shows the deadline and submits rejection only after explicit confirmation", async () => {
    await i18n.changeLanguage("de");
    fake.rpc.mockImplementation(async (name: string) =>
        name === "company_lecturer_decisions"
            ? {
                data: [
                    {
                        claim_id: "claim-a",
                        lecturer_name: "Alex Example",
                        status: "pending",
                        deadline: "2030-01-01T12:00:00Z",
                        can_reject: true,
                    },
                ],
                error: null,
            }
            : {data: null, error: null},
    );
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    const user = userEvent.setup();
    render(
        <QueryClientProvider client={client}>
            <CompanyDecisions actor="company" job="job" zone="Europe/Berlin"/>
        </QueryClientProvider>,
    );
    expect(await screen.findByText("Alex Example")).toBeInTheDocument();
    expect(
        screen.getByText(/Ohne Entscheidung automatisch bestätigt/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", {name: "Ablehnen"}));
    expect(fake.rpc).not.toHaveBeenCalledWith(
        "decide_company_lecturer",
        expect.anything(),
    );
    const dialog = screen.getByRole("dialog");
    await user.click(dialog.querySelector("button:last-child")!);
    await waitFor(() =>
        expect(fake.rpc).toHaveBeenCalledWith("decide_company_lecturer", {
            p_claim_id: "claim-a",
            p_decision: "rejected",
        }),
    );
    client.clear();
});

it("shows invoiced rejection as pending finance review without promising a release", async () => {
    await i18n.changeLanguage("de");
    fake.rpc.mockResolvedValue({
        data: [
            {
                claim_id: "claim-a",
                lecturer_name: "Alex Example",
                status: "review_required",
                deadline: "2030-01-01T12:00:00Z",
                can_reject: true,
            },
        ],
        error: null,
    });
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <CompanyDecisions actor="company" job="job" zone="Europe/Berlin"/>
        </QueryClientProvider>,
    );
    expect(await screen.findByText(/Ablehnung vorgemerkt/)).toHaveTextContent(
        "der Einsatz bleibt bestehen",
    );
    expect(
        screen.queryByRole("button", {name: "Ablehnen"}),
    ).not.toBeInTheDocument();
    client.clear();
});