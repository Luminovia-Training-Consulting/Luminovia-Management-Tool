/** Server-confirmed forum quote behavior; fictional content and no real sessions. */
import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {MemoryRouter} from "react-router-dom";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import type {JSONContent} from "@tiptap/react";
import i18n from "../../lib/i18n";
import {documentText} from "./content";
import {ForumPage} from "./forum";

const fake = vi.hoisted(() => ({
    rpc: vi.fn(),
    current: "visible",
    initialDeleted: false,
}));
vi.mock("../../lib/supabase", () => ({db: () => ({rpc: fake.rpc})}));
vi.mock("../auth/auth-context", () => ({
    useAuth: () => ({session: {user: {id: "actor"}}}),
}));
vi.mock("../../lib/queries", () => ({
    profileQuery: () => ({
        queryKey: ["profile"],
        queryFn: async () => ({time_zone: "UTC"}),
    }),
}));
vi.mock("./editor", () => ({
    KnowledgeEditor: ({
                          value,
                          onChange,
                          label,
                          readOnly,
                      }: {
        value: JSONContent;
        onChange?: (value: JSONContent) => void;
        label: string;
        readOnly?: boolean;
    }) =>
        readOnly ? (
            <div role="article" aria-label={label}>
                {documentText(value)}
            </div>
        ) : (
            <textarea
                aria-label={label}
                value={documentText(value).trim()}
                onChange={(e) =>
                    onChange?.({
                        type: "doc",
                        content: [
                            {
                                type: "paragraph",
                                content: [{type: "text", text: e.target.value}],
                            },
                        ],
                    })
                }
            />
        ),
}));
const textDoc = (value: string): JSONContent => ({
    type: "doc",
    content: [{type: "paragraph", content: [{type: "text", text: value}]}],
});
const thread = {
    id: "thread",
    title: "Fictional discussion",
    category_id: "cat",
    category_label_de: "Thema",
    category_label_en: "Topic",
    owner_id: "other",
    owner_name: "Fictional",
    locked: false,
    pinned: false,
    archived: false,
    accepted_post_id: null,
    post_count: 1,
    subscribed: false,
    created_at: "2035-01-01T00:00:00Z",
    updated_at: "2035-01-01T00:00:00Z",
};
const post = {
    id: "post",
    thread_id: "thread",
    author_id: "other",
    author_name: "Fictional",
    content: textDoc("Visible original"),
    created_at: "2035-01-01T00:00:00Z",
    edited_at: null,
    deleted_at: null,
    version: 1,
};
beforeEach(async () => {
    await i18n.changeLanguage("de");
    fake.current = "visible";
    fake.initialDeleted = false;
    let reads = 0;
    fake.rpc.mockImplementation(async (name: string) => {
        switch (name) {
            case "knowledge_access":
                return {
                    data: {can_author: true, can_moderate_forum: false},
                    error: null,
                };
            case "knowledge_categories":
                return {data: [], error: null};
            case "forum_threads_list":
                return {data: [thread], error: null};
            case "forum_thread":
                return {data: thread, error: null};
            case "forum_posts":
                reads++;
                return {
                    data:
                        reads === 1
                            ? [
                                fake.initialDeleted
                                    ? {
                                        ...post,
                                        deleted_at: "2035-01-02T00:00:00Z",
                                        content: textDoc(""),
                                    }
                                    : post,
                            ]
                            : fake.current === "revoked"
                                ? null
                                : fake.current === "deleted"
                                    ? [
                                        {
                                            ...post,
                                            deleted_at: "2035-01-02T00:00:00Z",
                                            content: textDoc(""),
                                        },
                                    ]
                                    : [
                                        {
                                            ...post,
                                            content: textDoc(
                                                "Current literal <script>alert(1)</script> javascript:alert(2)",
                                            ),
                                        },
                                    ],
                    error:
                        fake.current === "revoked" && reads > 1 ? {code: "42501"} : null,
                };
            case "add_forum_post":
                return {data: "saved", error: null};
            default:
                throw new Error(`Unexpected RPC ${name}`);
        }
    });
});
afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function view() {
    const client = new QueryClient({
        defaultOptions: {queries: {retry: false}, mutations: {retry: false}},
    });
    render(
        <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/forum?thread=thread"]}>
                <ForumPage/>
            </MemoryRouter>
        </QueryClientProvider>,
    );
    return client;
}

it("copies only freshly authorized literal text as a blockquote and retains the existing draft", async () => {
    const client = view(),
        user = userEvent.setup();
    const editor = await screen.findByRole("textbox", {
        name: "Antwort schreiben",
    });
    fireEvent.change(editor, {target: {value: "Own draft survives"}});
    await user.click(screen.getByRole("button", {name: "Beitrag zitieren"}));
    const updated = await screen.findByRole("textbox", {
        name: "Antwort schreiben",
    });
    expect((updated as HTMLTextAreaElement).value).toContain(
        "Own draft survives",
    );
    expect((updated as HTMLTextAreaElement).value).toContain(
        "Current literal <script>",
    );
    expect(document.querySelector("script")).toBeNull();
    await user.click(
        screen.getByRole("button", {name: "Antwort veröffentlichen"}),
    );
    const call = fake.rpc.mock.calls.find(([name]) => name === "add_forum_post");
    expect(call?.[1].p_content).toMatchObject({
        type: "doc",
        content: [
            {
                type: "paragraph",
                content: [{type: "text", text: "Own draft survives"}],
            },
            {
                type: "blockquote",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Current literal <script>alert(1)</script> javascript:alert(2)",
                            },
                        ],
                    },
                ],
            },
            {type: "paragraph"},
        ],
    });
    client.clear();
});
it.each(["deleted", "revoked"])(
    "refuses a now-%s source and preserves the unsent draft",
    async (status) => {
        const client = view(),
            user = userEvent.setup();
        const editor = await screen.findByRole("textbox", {
            name: "Antwort schreiben",
        });
        fireEvent.change(editor, {target: {value: "Keep my draft"}});
        fake.current = status;
        await user.click(screen.getByRole("button", {name: "Beitrag zitieren"}));
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "nicht mehr verfügbar",
        );
        expect(
            screen.getByRole("textbox", {name: "Antwort schreiben"}),
        ).toHaveValue("Keep my draft");
        expect(
            fake.rpc.mock.calls.filter(([name]) => name === "add_forum_post"),
        ).toHaveLength(0);
        client.clear();
    },
);
it("does not offer quoting for a deleted post", async () => {
    fake.initialDeleted = true;
    const client = view();
    await screen.findByText("Dieser Beitrag wurde gelöscht.");
    expect(
        screen.queryByRole("button", {name: "Beitrag zitieren"}),
    ).not.toBeInTheDocument();
    client.clear();
});