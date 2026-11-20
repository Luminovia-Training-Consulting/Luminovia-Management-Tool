/** Actor-owned archive UI uses confirmed server replies and keeps failures retryable. */
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {cleanup, render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import {ArchivedPersonalMaterials} from "./archived-personal";

const fake = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: fake.rpc})}));
const client = new QueryClient({
    defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
});
beforeEach(async () => {
    await i18n.changeLanguage("de");
    fake.rpc.mockReset();
    client.clear();
});
afterEach(() => {
    cleanup();
    client.clear();
});

function view() {
    return render(
        <QueryClientProvider client={client}>
            <ArchivedPersonalMaterials actor="fictional-actor"/>
        </QueryClientProvider>,
    );
}

it("shows only confirmed archive results and restores after explicit confirmation", async () => {
    const user = userEvent.setup();
    let resolveRestore!: (value: unknown) => void;
    fake.rpc.mockImplementation((name: string) =>
        name === "archived_personal_materials"
            ? Promise.resolve({
                data: [
                    {
                        id: "doc",
                        original_name: "Fictional.txt",
                        archived_at: "2035-01-01T00:00:00Z",
                    },
                ],
                error: null,
            })
            : new Promise((resolve) => {
                resolveRestore = resolve;
            }),
    );
    view();
    expect(fake.rpc).not.toHaveBeenCalled();
    await user.click(
        screen.getByRole("button", {name: "Archivierte eigene Materialien"}),
    );
    await user.click(
        await screen.findByRole("button", {
            name: "Fictional.txt wiederherstellen",
        }),
    );
    const confirm = screen.getByRole("dialog", {
        name: "Material wiederherstellen?",
    });
    await user.click(
        within(confirm).getByRole("button", {
            name: "Fictional.txt wiederherstellen",
        }),
    );
    expect(fake.rpc).toHaveBeenCalledWith("restore_personal_material", {
        p_id: "doc",
    });
    expect(
        within(confirm).getByRole("button", {
            name: "Fictional.txt wiederherstellen",
        }),
    ).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    resolveRestore({error: null});
    expect(await screen.findByRole("status")).toHaveTextContent(
        "Material wiederhergestellt.",
    );
});
it("preserves the confirmation and reports failure without claiming success", async () => {
    const user = userEvent.setup();
    fake.rpc.mockImplementation(async (name: string) =>
        name === "archived_personal_materials"
            ? {
                data: [
                    {
                        id: "doc",
                        original_name: "Fictional.txt",
                        archived_at: "2035-01-01T00:00:00Z",
                    },
                ],
                error: null,
            }
            : {data: null, error: {code: "42501"}},
    );
    view();
    await user.click(
        screen.getByRole("button", {name: "Archivierte eigene Materialien"}),
    );
    await user.click(
        await screen.findByRole("button", {
            name: "Fictional.txt wiederherstellen",
        }),
    );
    const confirm = screen.getByRole("dialog", {
        name: "Material wiederherstellen?",
    });
    await user.click(
        within(confirm).getByRole("button", {
            name: "Fictional.txt wiederherstellen",
        }),
    );
    expect(await within(confirm).findByRole("alert")).toHaveTextContent(
        "nicht bestätigt",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
});
it("provides English recovery labels", async () => {
    await i18n.changeLanguage("en");
    fake.rpc.mockResolvedValue({data: [], error: null});
    const user = userEvent.setup();
    view();
    await user.click(
        screen.getByRole("button", {name: "Archived personal materials"}),
    );
    expect(
        await screen.findByText("No restorable materials found."),
    ).toBeVisible();
});