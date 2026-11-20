/** Confirmed metadata updates and CAS conflict preserve the typed title. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import {ForumMetadataEditor} from "./forum-metadata";
import type {ForumThread} from "./types";

const fake = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: fake.rpc})}));
const thread: ForumThread = {
    id: "thread",
    title: "Fictional original",
    category_id: "cat-a",
    category_label_de: "A",
    category_label_en: "A",
    owner_id: "actor",
    owner_name: "Fictional author",
    locked: false,
    pinned: false,
    archived: false,
    accepted_post_id: null,
    post_count: 1,
    subscribed: false,
    created_at: "2035-01-01T00:00:00Z",
    updated_at: "2035-01-01T00:00:00Z",
    metadata_version: 2,
};
const categories = [
    {
        id: "cat-a",
        kind: "forum",
        label_de: "Allgemein",
        label_en: "General",
        archived: false,
    },
    {
        id: "cat-b",
        kind: "forum",
        label_de: "Fragen",
        label_en: "Questions",
        archived: false,
    },
];
afterEach(() => {
    cleanup();
    fake.rpc.mockReset();
});
it("keeps typed values and the opened version on a stale update", async () => {
    await i18n.changeLanguage("de");
    fake.rpc.mockImplementation(async (name: string) =>
        name === "knowledge_categories"
            ? {data: categories, error: null}
            : {data: null, error: {code: "40001"}},
    );
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    const wrap = (value: ForumThread) => (
        <QueryClientProvider client={client}>
            <ForumMetadataEditor actor="actor" thread={value}/>
        </QueryClientProvider>
    );
    const view = render(wrap(thread));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", {name: "Thema bearbeiten"}));
    const dialog = await screen.findByRole("dialog");
    await user.clear(await within(dialog).findByLabelText("Titel"));
    await user.type(within(dialog).getByLabelText("Titel"), "Fictional draft");
    await user.selectOptions(within(dialog).getByLabelText("Kategorie"), "cat-b");
    view.rerender(
        wrap({...thread, title: "Other update", metadata_version: 3}),
    );
    await user.click(within(dialog).getByRole("button", {name: "Speichern"}));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
        "inzwischen geändert",
    );
    expect(within(dialog).getByLabelText("Titel")).toHaveValue("Fictional draft");
    expect(fake.rpc).toHaveBeenCalledWith("edit_forum_thread_metadata", {
        p_thread_id: "thread",
        p_title: "Fictional draft",
        p_category_id: "cat-b",
        p_expected_version: 2,
    });
    client.clear();
});
it("submits a reviewed title and closes only after confirmation", async () => {
    await i18n.changeLanguage("en");
    let finish!: (value: unknown) => void;
    fake.rpc.mockImplementation((name: string) =>
        name === "knowledge_categories"
            ? Promise.resolve({data: categories, error: null})
            : new Promise((resolve) => {
                finish = resolve;
            }),
    );
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <ForumMetadataEditor actor="actor" thread={thread}/>
        </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", {name: "Edit thread"}));
    const dialog = await screen.findByRole("dialog");
    await user.clear(await within(dialog).findByLabelText("Title"));
    await user.type(within(dialog).getByLabelText("Title"), "New title");
    await user.click(within(dialog).getByRole("button", {name: "Save"}));
    expect(dialog).toBeVisible();
    finish({data: 3, error: null});
    await vi.waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    client.clear();
    await i18n.changeLanguage("de");
});