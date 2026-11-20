import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {RequestBriefPanel} from "./request-brief";
import type {RequestBriefView} from "./request-brief-api";
import type {ClientRequest} from "./commission-api";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({
    rpc: vi.fn(),
    upload: vi.fn(),
    download: vi.fn(),
    view: {} as RequestBriefView,
    save: null as null | Promise<unknown>,
    error: null as unknown,
}));
vi.mock("../../lib/supabase", () => ({db: () => fake}));
vi.mock("../files/api", () => ({
    acceptedFiles: ".txt,.pdf",
    uploadDocument: fake.upload,
}));
vi.mock("../learning/api", () => ({downloadPortalDocument: fake.download}));
const clients: QueryClient[] = [];
const request = {
    id: "request-a",
    time_zone: "Europe/Berlin",
    status: "submitted",
    sessions: [
        {starts_at: "2027-01-01T09:00:00Z", ends_at: "2027-01-01T10:00:00Z"},
    ],
} as ClientRequest;

function setup() {
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    clients.push(client);
    return render(
        <QueryClientProvider client={client}>
            <RequestBriefPanel actor="client-a" request={request}/>
        </QueryClientProvider>,
    );
}

beforeEach(async () => {
    await i18n.changeLanguage("de");
    fake.view = {
        version: 1,
        editable: true,
        brief: {
            teaching_units: 1,
            unit_minutes: 45,
            instructions: "Original preparation",
            required_documents: ["Course outline"],
            documents: [],
        },
        documents: [],
    };
    fake.error = null;
    fake.save = null;
    fake.upload.mockReset();
    fake.download.mockReset();
    fake.rpc
        .mockReset()
        .mockImplementation((name: string, args: Record<string, unknown>) => {
            const response = {
                abortSignal: () => response,
                then: (resolve: (v: unknown) => unknown) => {
                    if (name === "client_request_brief")
                        return Promise.resolve({data: fake.view, error: fake.error}).then(
                            resolve,
                        );
                    if (name === "client_request_history")
                        return Promise.resolve({data: [], error: null}).then(resolve);
                    return Promise.resolve(fake.save ?? null).then(() => {
                        if (fake.error) return resolve({data: null, error: fake.error});
                        fake.view = {
                            ...fake.view,
                            version: fake.view.version + 1,
                            brief: args.p_brief as RequestBriefView["brief"],
                        };
                        return resolve({data: fake.view.version, error: null});
                    });
                },
            };
            return response;
        });
});
afterEach(() => {
    cleanup();
    clients.splice(0).forEach((c) => c.clear());
});

async function open() {
    await userEvent.click(
        screen.getByRole("button", {
            name: "Unterrichtsbedarf und Unterlagen",
        }),
    );
    await screen.findByText("Original preparation");
}

describe("Customer request brief", () => {
    it("retains an editable draft and old server version when a real CAS save is refused", async () => {
        setup();
        await open();
        await userEvent.click(
            screen.getByRole("button", {
                name: "Anforderungsprofil bearbeiten",
            }),
        );
        const field = screen.getByLabelText("Hinweise zur Kursvorbereitung", {});
        await userEvent.clear(field);
        await userEvent.type(field, "Review this preserved draft");
        fake.error = {code: "40001"};
        await userEvent.click(
            screen.getByRole("button", {
                name: "Anforderungen speichern",
            }),
        );
        await screen.findByText(/Speichern nicht bestätigt/);
        expect(field).toHaveValue("Review this preserved draft");
        expect(screen.getByText("Original preparation")).toBeVisible();
        expect(fake.rpc).toHaveBeenCalledWith(
            "save_client_request_brief",
            expect.objectContaining({
                p_request_id: "request-a",
                p_expected_version: 1,
                p_brief: expect.objectContaining({
                    instructions: "Review this preserved draft",
                }),
            }),
        );
    });
    it("waits for server confirmation and blocks double submission while preserving visible committed facts", async () => {
        let release!: () => void;
        fake.save = new Promise<void>((resolve) => {
            release = resolve;
        });
        setup();
        await open();
        await userEvent.click(
            screen.getByRole("button", {
                name: "Anforderungsprofil bearbeiten",
            }),
        );
        const field = screen.getByLabelText("Hinweise zur Kursvorbereitung", {});
        await userEvent.clear(field);
        await userEvent.type(field, "Confirmed new brief");
        const save = screen.getByRole("button", {
            name: "Anforderungen speichern",
        });
        await userEvent.click(save);
        expect(save).toBeDisabled();
        expect(screen.getByText("Original preparation")).toBeVisible();
        expect(
            fake.rpc.mock.calls.filter(
                ([name]) => name === "save_client_request_brief",
            ),
        ).toHaveLength(1);
        await act(async () => release());
        await screen.findByText("Confirmed new brief");
        expect(screen.queryByText("Original preparation")).not.toBeInTheDocument();
    });
    it("rejects teaching time longer than the sessions without sending a mutation", async () => {
        setup();
        await open();
        await userEvent.click(
            screen.getByRole("button", {
                name: "Anforderungsprofil bearbeiten",
            }),
        );
        const units = screen.getByLabelText("Benötigte Unterrichtseinheiten", {});
        await userEvent.clear(units);
        await userEvent.type(units, "2");
        await userEvent.click(
            screen.getByRole("button", {
                name: "Anforderungen speichern",
            }),
        );
        await screen.findByText(/Bitte prüfe ganze Unterrichtseinheiten/);
        expect(
            fake.rpc.mock.calls.some(
                ([name]) => name === "save_client_request_brief",
            ),
        ).toBe(false);
    });
    it("keeps published requests read-only while authorized document downloads target the exact request/version", async () => {
        fake.view.editable = false;
        fake.view.documents = [
            {
                version_id: "exact-old-version",
                name: "Agreed-material.pdf",
                category: "material",
                sha256: "a".repeat(64),
            },
        ];
        setup();
        await open();
        expect(
            screen.queryByRole("button", {
                name: "Anforderungsprofil bearbeiten",
            }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByLabelText("Datei für diese Anfrage", {exact: true}),
        ).not.toBeInTheDocument();
        await userEvent.click(
            screen.getByRole("button", {name: "Herunterladen"}),
        );
        await waitFor(() =>
            expect(fake.download).toHaveBeenCalledWith(
                {
                    kind: "request_resource",
                    request_id: "request-a",
                    id: "exact-old-version",
                },
                "Agreed-material.pdf",
            ),
        );
        await act(async () => {
            await i18n.changeLanguage("en");
        });
        expect(
            screen.getByText("Published or cancelled requests are read-only."),
        ).toBeVisible();
        expect(screen.getByRole("button", {name: "Download"})).toBeVisible();
    });
});