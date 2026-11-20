/** File details use the exact authorized current-version lookup and localized labels. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import {DocumentDetails} from "./files";
import type {PortalDocument} from "./api";

const state = vi.hoisted(() => ({query: vi.fn()}));
vi.mock("../../lib/supabase", () => ({db: () => ({from: state.query})}));
const file: PortalDocument = {
    id: "file",
    owner_id: "actor",
    uploaded_by: "actor",
    scope: "personal",
    kind: "material",
    room_id: null,
    job_id: null,
    original_name: "Example.pdf",
    mime_type: "application/pdf",
    size_bytes: 1234,
    status: "clean",
    current_version_id: "v2",
    created_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
};
afterEach(async () => {
    cleanup();
    vi.clearAllMocks();
    await i18n.changeLanguage("de");
});
it.each([
    ["de", "Dateityp", "Aktuelle Version", "Geprüft"],
    ["en", "File type", "Current version", "Scanned"],
])("shows fresh details in %s", async (language, type, version, scan) => {
    await i18n.changeLanguage(language);
    const maybeSingle = vi
        .fn()
        .mockResolvedValue({data: {version: 2}, error: null});
    const abortSignal = vi.fn().mockReturnValue({maybeSingle});
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnValue({eq, abortSignal});
    state.query.mockReturnValue({select});
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <DocumentDetails file={file} actor="actor"/>
        </QueryClientProvider>,
    );
    expect(screen.getByText("Example.pdf")).toBeTruthy();
    expect(screen.getByText(type)).toBeTruthy();
    expect(screen.getByText("application/pdf")).toBeTruthy();
    expect(screen.getByText(scan)).toBeTruthy();
    expect(screen.getByText(version)).toBeTruthy();
    expect(await screen.findByText("2")).toBeTruthy();
    expect(eq).toHaveBeenCalledWith("document_id", "file");
    expect(eq).toHaveBeenCalledWith("id", "v2");
    client.clear();
});
it("does not reuse another version when the authorized lookup fails", async () => {
    const eq = vi.fn().mockReturnThis();
    state.query.mockReturnValue({
        select: () => ({
            eq,
            abortSignal: () => ({
                maybeSingle: async () => ({data: null, error: {code: "42501"}}),
            }),
        }),
    });
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <DocumentDetails file={file} actor="actor"/>
        </QueryClientProvider>,
    );
    expect(await screen.findByText("Nicht verfügbar")).toBeTruthy();
    client.clear();
});