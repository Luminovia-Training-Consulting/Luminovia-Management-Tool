import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { JSONContent } from "@tiptap/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { WikiPage } from "./wiki";
import { knowledgeKeys } from "./api";
import { documentText } from "./content";
import type {
  KnowledgeAccess,
  KnowledgeCategory,
  WikiPageRecord,
} from "./types";

const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "wiki-author" } } }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
// These tests exercise the parent editor workflow, real form validation and
// query invalidation. Tiptap formatting/sanitisation has separate coverage.
vi.mock("./editor", () => ({
  KnowledgeEditor: ({
    value,
    onChange,
    label,
    disabled,
    readOnly,
  }: {
    value: JSONContent;
    onChange?: (value: JSONContent) => void;
    label: string;
    disabled?: boolean;
    readOnly?: boolean;
  }) => {
    const text = value.content?.[0]?.content?.[0]?.text ?? "";
    return readOnly ? (
      <div role="region" aria-label={label}>
        {text}
      </div>
    ) : (
      <textarea
        aria-label={label}
        value={text}
        disabled={disabled}
        onChange={(event) =>
          onChange?.({
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: event.target.value
                  ? [{ type: "text", text: event.target.value }]
                  : [],
              },
            ],
          })
        }
      />
    );
  },
}));

const categories: KnowledgeCategory[] = [
  {
    id: "category-network",
    kind: "wiki",
    slug: "network",
    label_de: "Netzwerke",
    label_en: "Networks",
    archived: false,
  },
  {
    id: "category-linux",
    kind: "wiki",
    slug: "linux",
    label_de: "Linux",
    label_en: "Linux",
    archived: false,
  },
];
const doc = (text: string): JSONContent => ({
  type: "doc",
  content: [
    { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
  ],
});
function initialRecord(): WikiPageRecord {
  return {
    id: "wiki-routing",
    title: "Fictional routing notes",
    locale: "en",
    category_id: categories[0].id,
    category_label_de: "Netzwerke",
    category_label_en: "Networks",
    owner_id: "wiki-author",
    owner_name: "Fictional Author",
    status: "draft",
    version: 3,
    published_version: null,
    has_draft: true,
    updated_at: "2026-11-16T02:00:00Z",
    content: doc("Original draft explanation."),
  };
}
type RpcResult = { data: unknown; error: unknown };
let access: KnowledgeAccess;
let record: WikiPageRecord;
let availableCategories: KnowledgeCategory[];
let save: (payload: Record<string, unknown>) => Promise<RpcResult>;
const clients: QueryClient[] = [];
const saveCalls = () =>
  state.rpc.mock.calls.filter(([name]) => name === "save_wiki_page");
function confirmSave(payload: Record<string, unknown>): RpcResult {
  record = {
    ...record,
    title: payload.p_title as string,
    locale: payload.p_locale as string,
    category_id: payload.p_category_id as string,
    content: payload.p_content as JSONContent,
    status: payload.p_status as WikiPageRecord["status"],
    version: record.version + 1,
    published_version:
      payload.p_status === "published"
        ? record.version + 1
        : record.published_version,
    has_draft: payload.p_status !== "published",
  };
  return {
    data: {
      page_id: record.id,
      version: record.version,
      published_version: record.published_version,
    },
    error: null,
  };
}
beforeEach(async () => {
  state.online = true;
  record = initialRecord();
  availableCategories = [...categories];
  access = {
    can_author: true,
    can_publish_wiki: true,
    can_moderate_forum: false,
  };
  save = async (payload) => confirmSave(payload);
  await i18n.changeLanguage("en");
  state.rpc.mockImplementation(
    async (name: string, payload: Record<string, unknown> = {}) => {
      switch (name) {
        case "knowledge_access":
          return { data: { ...access }, error: null };
        case "knowledge_categories":
          return { data: [...availableCategories], error: null };
        case "wiki_pages_list":
          return { data: [record], error: null };
        case "wiki_page":
          return { data: { ...record }, error: null };
        case "save_wiki_page":
          return save(payload);
        default:
          throw new Error(`Unexpected fictional RPC: ${name}`);
      }
    },
  );
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});
function view(path = "/wiki?page=wiki-routing") {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <WikiPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
async function editArticle() {
  await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
  return {
    title: screen.getByRole("textbox", { name: "Title" }),
    content: screen.getByRole("textbox", { name: "Content" }),
  };
}
const saveFailure = /The change could not be saved\. Your draft is preserved/;

describe("Wiki editor confirmation and draft preservation", () => {
  it("preserves a stale-version draft and repeats the same page/version/payload on explicit retry", async () => {
    save = async () => ({
      data: null,
      error: { code: "40001", message: "stale_version" },
    });
    view();
    const fields = await editArticle();
    await userEvent.clear(fields.title);
    await userEvent.type(fields.title, "My unpublished correction");
    await userEvent.clear(fields.content);
    await userEvent.type(fields.content, "Keep my local reasoning.");
    await userEvent.selectOptions(
      screen.getByLabelText("Content language", { selector: "#wiki-language" }),
      "de",
    );
    await userEvent.selectOptions(
      screen.getByLabelText("Category", { selector: "#wiki-category" }),
      "category-linux",
    );
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(await screen.findByText(saveFailure)).toBeVisible();
    expect(fields.title).toHaveValue("My unpublished correction");
    expect(fields.content).toHaveValue("Keep my local reasoning.");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(2));
    expect(saveCalls()[0][1]).toEqual({
      p_id: record.id,
      p_title: "My unpublished correction",
      p_locale: "de",
      p_category_id: "category-linux",
      p_content: doc("Keep my local reasoning."),
      p_status: "published",
      p_expected_version: 3,
    });
    expect(saveCalls()[1][1]).toEqual(saveCalls()[0][1]);
    expect(fields.title).toBe(screen.getByRole("textbox", { name: "Title" }));
  });

  it.each(["network", "unconfirmed"])(
    "does not close or confirm a draft after an %s response",
    async (kind) => {
      save = async () => {
        if (kind === "network")
          throw new TypeError("Fictional connection failure");
        return { data: null, error: null };
      };
      view();
      const { title, content } = await editArticle();
      await userEvent.clear(title);
      await userEvent.type(title, "Unsaved title");
      await userEvent.clear(content);
      await userEvent.type(content, "Unsaved content");
      await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
      expect(await screen.findByText(saveFailure)).toBeVisible();
      expect(title).toHaveValue("Unsaved title");
      expect(content).toHaveValue("Unsaved content");
      expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
      expect(
        screen.queryByRole("heading", { name: "Unsaved title" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
      expect(record.version).toBe(3);
    },
  );

  it("keeps a publish pending until server confirmation and refreshes the actual article afterwards", async () => {
    let confirm!: (result: RpcResult) => void;
    let payload!: Record<string, unknown>;
    save = (values) => {
      payload = values;
      return new Promise((resolve) => {
        confirm = resolve;
      });
    };
    view();
    const { title, content } = await editArticle();
    await userEvent.clear(title);
    await userEvent.type(title, "Confirmed publication");
    await userEvent.clear(content);
    await userEvent.type(content, "Server-confirmed content.");
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving …" })).toBeDisabled();
    expect(title).toBeDisabled();
    expect(content).toBeDisabled();
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
    await act(async () => confirm(confirmSave(payload)));
    expect(
      await screen.findByRole("heading", { name: "Confirmed publication" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Confirmed publication" }),
    ).toHaveTextContent("Server-confirmed content.");
    expect(screen.getAllByText("Published")).toHaveLength(2);
    expect(screen.getByText(/Version 4/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Save draft" }),
    ).not.toBeInTheDocument();
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "wiki_page"),
    ).toHaveLength(2);
  });

  it("retains an unsaved form across language changes and never sends authored content through translation", async () => {
    save = async () => ({
      data: null,
      error: { code: "42501", message: "denied" },
    });
    view();
    const fields = await editArticle();
    await userEvent.clear(fields.title);
    await userEvent.type(fields.title, "Authored English note");
    await userEvent.clear(fields.content);
    await userEvent.type(fields.content, "Original authored wording.");
    await act(() => i18n.changeLanguage("de"));
    expect(screen.getByRole("textbox", { name: "Titel" })).toBe(fields.title);
    expect(screen.getByRole("textbox", { name: "Inhalt" })).toHaveValue(
      "Original authored wording.",
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Entwurf speichern" }),
    );
    expect(
      await screen.findByText(/Dein Entwurf bleibt erhalten/),
    ).toBeVisible();
    expect(saveCalls()[0][1]).toMatchObject({
      p_title: "Authored English note",
      p_locale: "en",
      p_content: doc("Original authored wording."),
    });
  });

  it("requires content before publishing but permits an explicitly empty saved draft", async () => {
    view();
    const { content } = await editArticle();
    await userEvent.clear(content);
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(
      await screen.findByText(/The content is empty or too long/),
    ).toBeVisible();
    expect(saveCalls()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    expect(saveCalls()[0][1]).toMatchObject({
      p_status: "draft",
      p_content: doc(""),
    });
    expect(documentText(record.content).trim()).toBe("");
    await screen.findByRole("button", { name: "Edit" });
  });

  it("never calls a save while offline and retains the typed draft", async () => {
    state.online = false;
    view();
    const { content } = await editArticle();
    await userEvent.type(content, " Local addition.");
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Publish" }));
    expect(saveCalls()).toHaveLength(0);
    expect(content).toHaveValue("Original draft explanation. Local addition.");
  });
});

describe("Wiki permissions and creation prerequisites", () => {
  it("removes publication and category administration after current capability loss, retaining only an own draft", async () => {
    const client = view();
    const { content } = await editArticle();
    await userEvent.type(content, " Unsaved own draft.");
    access.can_publish_wiki = false;
    await act(() =>
      client.invalidateQueries({
        queryKey: knowledgeKeys.access("wiki-author"),
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Publish" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Archive" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manage categories" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeVisible();
    expect(content).toHaveValue(
      "Original draft explanation. Unsaved own draft.",
    );
    expect(saveCalls()).toHaveLength(0);
  });

  it("removes the entire editor and write actions after author access is revoked", async () => {
    const client = view();
    await editArticle();
    access = { ...access, can_author: false, can_publish_wiki: false };
    await act(() =>
      client.invalidateQueries({
        queryKey: knowledgeKeys.access("wiki-author"),
      }),
    );
    expect(
      await screen.findByText(
        "You do not have permission to access this knowledge area.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Content" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save draft" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Write an article" }),
    ).not.toBeInTheDocument();
    expect(saveCalls()).toHaveLength(0);
  });

  it("creates a new draft only from the confirmed server result and sends no invented previous version", async () => {
    save = async (payload) => {
      record = { ...record, id: "wiki-created", version: 0 };
      return confirmSave(payload);
    };
    view("/wiki");
    await userEvent.click(
      await screen.findByRole("button", { name: "Write an article" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Title" }),
      "New fictional guide",
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: "Content" }),
      "Authored new draft.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      await screen.findByRole("heading", { name: "New fictional guide" }),
    ).toBeVisible();
    expect(saveCalls()).toHaveLength(1);
    expect(saveCalls()[0][1]).toEqual({
      p_id: null,
      p_title: "New fictional guide",
      p_locale: "de",
      p_category_id: "category-network",
      p_content: doc("Authored new draft."),
      p_status: "draft",
      p_expected_version: null,
    });
    expect(
      screen.getByRole("region", { name: "New fictional guide" }),
    ).toHaveTextContent("Authored new draft.");
    expect(screen.queryByText("Published")).not.toBeInTheDocument();
  });

  it("does not create an article without an available category", async () => {
    availableCategories = [];
    view("/wiki");
    await userEvent.click(
      await screen.findByRole("button", { name: "Write an article" }),
    );
    expect(
      await screen.findByText(/A category is needed before new contributions/),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Title" }),
    ).not.toBeInTheDocument();
    expect(saveCalls()).toHaveLength(0);
  });
});
