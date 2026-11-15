import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { TaxonomyPage } from "./taxonomy";
import type { TaxonomyTopic } from "./api";
const { rpc, auth } = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { session: { user: { id: "taxonomy-actor" } } },
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({ useAuth: () => auth }));
const original: TaxonomyTopic = {
  id: "00000000-0000-0000-0000-000000000001",
  label_de: "Fiktives Thema",
  label_en: "Fictional topic",
  kind: "topic",
  parent_id: null,
  aliases: ["Alternative"],
  description_de: "Fiktive Beschreibung",
  description_en: "Fictional description",
  archived_at: null,
  version: 1,
  related_courses: [{ id: "course-id", title: "Zugänglicher Kurs" }],
};
let manage = false,
  rows: TaxonomyTopic[] = [];
function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <TaxonomyPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  manage = false;
  rows = [original];
  rpc.mockReset();
  rpc.mockImplementation((name, args) => {
    if (name === "get_my_permissions")
      return response(manage ? ["taxonomy.manage"] : []);
    if (name === "taxonomy_catalogue")
      return response(
        rows.filter(
          (row) =>
            !args.p_search ||
            JSON.stringify(row)
              .toLowerCase()
              .includes(args.p_search.toLowerCase()),
        ),
      );
    throw new Error("Unexpected request");
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("connected taxonomy screen", () => {
  it("provides a shared read-only catalogue with authorized course deep links", async () => {
    mount();
    expect(
      await screen.findByRole("heading", { name: "Fiktives Thema" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Zugänglicher Kurs" }),
    ).toHaveAttribute("href", "/courses?template=course-id");
    expect(
      screen.queryByRole("button", { name: "Eintrag erstellen" }),
    ).not.toBeInTheDocument();
    expect(
      rpc.mock.calls.filter(([name]) => name === "taxonomy_catalogue"),
    ).toHaveLength(1);
  });
  it("keeps filter drafts through language changes and debounces real query requests", async () => {
    mount();
    await screen.findByRole("heading", { name: "Fiktives Thema" });
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Katalog durchsuchen"),
      "Alternative",
    );
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("taxonomy_catalogue", {
        p_search: "Alternative",
        p_kind: "",
        p_include_archived: false,
      }),
    );
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByLabelText("Search catalogue")).toHaveValue(
      "Alternative",
    );
    expect(
      screen.getByRole("heading", { name: "Fictional topic" }),
    ).toBeInTheDocument();
    expect(
      rpc.mock.calls.filter(([name]) => name === "taxonomy_catalogue").length,
    ).toBeLessThanOrEqual(3);
  });
  it("keeps the focused search input mounted during a real pending filter request", async () => {
    mount();
    await screen.findByRole("heading", { name: "Fiktives Thema" });
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const prior = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "taxonomy_catalogue" && args.p_search
        ? Object.assign(pending, {
            abortSignal() {
              return this;
            },
          })
        : prior(name, args),
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText("Katalog durchsuchen");
    await user.type(input, "No match");
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("taxonomy_catalogue", {
        p_search: "No match",
        p_kind: "",
        p_include_archived: false,
      }),
    );
    expect(input).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input).toHaveValue("No match");
    await act(() => finish({ data: [], error: null }));
    expect(
      await screen.findByText("Keine passenden Katalogeinträge."),
    ).toBeInTheDocument();
  });
  it("waits for server confirmation before publishing a new entry", async () => {
    manage = true;
    const user = userEvent.setup();
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Eintrag erstellen" }),
    );
    await user.type(
      screen.getByLabelText("Bezeichnung (Deutsch)"),
      "Neues Thema",
    );
    await user.type(
      screen.getByLabelText("Bezeichnung (Englisch)"),
      "New topic",
    );
    await user.type(
      screen.getByLabelText("Aliasse (mit Komma trennen)"),
      "Key,key",
    );
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const previous = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "save_taxonomy_topic" ? pending : previous(name, args),
    );
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByRole("button", { name: "Wird gespeichert …" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "Neues Thema" }),
    ).not.toBeInTheDocument();
    rows.push({
      ...original,
      id: "new-topic",
      label_de: "Neues Thema",
      label_en: "New topic",
    });
    await act(() => finish({ data: "new-topic", error: null }));
    expect(
      await screen.findByRole("heading", { name: "Neues Thema" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("save_taxonomy_topic", {
      p_id: null,
      p_payload: {
        label_de: "Neues Thema",
        label_en: "New topic",
        kind: "topic",
        parent_id: null,
        aliases: ["key"],
        description_de: "",
        description_en: "",
      },
      p_version: 0,
    });
  });
  it("keeps an unsaved edit visible after a real stale-version error", async () => {
    manage = true;
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole("button", { name: "Bearbeiten" }));
    const previous = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === "save_taxonomy_topic"
        ? response(null, { code: "40001" })
        : previous(name, args),
    );
    await user.clear(screen.getByLabelText("Bezeichnung (Deutsch)"));
    await user.type(
      screen.getByLabelText("Bezeichnung (Deutsch)"),
      "Mein Entwurf",
    );
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(/zwischenzeitlich geändert/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Bezeichnung (Deutsch)")).toHaveValue(
      "Mein Entwurf",
    );
    expect(screen.queryByText("Änderung gespeichert.")).not.toBeInTheDocument();
  });
});
