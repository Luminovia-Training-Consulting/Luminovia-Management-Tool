/**
 * Regressions proving missing organization capability does not query private contacts/notes.
 * Controlled UI data do not establish native business-contact access.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { ClientsPage } from "./clients";

vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
const { from, rpc } = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ from, rpc }) }));
vi.mock("../deletions/deletions", () => ({
  PermanentDeleteAction: ({
    kind,
    id,
    label,
  }: {
    kind: string;
    id: string;
    label: string;
  }) => (
    <button data-kind={kind} data-id={id}>
      Delete {label}
    </button>
  ),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("private client directory capability boundary", () => {
  it("does not request organisation/contact/note data without the verified management permission", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["permissions", "actor"], []);
    client.setQueryData(["user-roles", "actor"], []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Für diesen Bereich fehlt dir die Berechtigung.",
    );
    expect(from).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Organisation anlegen" }),
    ).not.toBeInTheDocument();
  });
  it("targets each contact from its own card and the organisation from its edit dialog", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["permissions", "actor"], ["organisations.manage"]);
    client.setQueryData(["user-roles", "actor"], ["management"]);
    client.setQueryData(["operations", "company-premium", "actor"], []);
    client.setQueryData(
      ["operations", "organisations", "actor"],
      [
        {
          id: "organisation-a",
          name: "Fictional organisation",
          country: "Germany",
          time_zone: "Europe/Berlin",
          industry: "Training",
          city: "Hamburg",
          tags: [],
          archived_at: null,
        },
      ],
    );
    client.setQueryData(
      ["operations", "contacts", "actor", "organisation-a"],
      ["Fictional first contact", "Fictional second contact"].map(
        (name, index) => ({
          id: `contact-${index + 1}`,
          organisation_id: "organisation-a",
          name,
          email: "",
          phone: "",
          position: "",
          notes: "",
          archived_at: index === 0 ? null : "2026-11-01T10:00:00Z",
        }),
      ),
    );
    client.setQueryData(["operations", "notes", "actor", "organisation-a"], "");
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    for (const [name, id] of [
      ["Fictional first contact", "contact-1"],
      ["Fictional second contact", "contact-2"],
    ]) {
      const action = screen.getByRole("button", { name: `Delete ${name}` });
      expect(action).toHaveAttribute("data-kind", "organisation_contact");
      expect(action).toHaveAttribute("data-id", id);
    }
    expect(
      screen.queryByRole("button", { name: "Unternehmensverträge" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete Fictional organisation" }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Organisation bearbeiten",
      }),
    );
    const action = screen.getByRole("button", {
      name: "Delete Fictional organisation",
    });
    expect(action).toHaveAttribute("data-kind", "organisation");
    expect(action).toHaveAttribute("data-id", "organisation-a");
    client.clear();
  });

  it("replaces organisation panels and requests notes only for the selected company", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const first = "5a2edf79-bd91-4746-a887-dbcfe7ba1e62";
    const second = "047d63fe-7870-4e7a-af65-f775298598e8";
    const organisations = [
      { id: first, name: "Fictional first organisation" },
      { id: second, name: "Fictional second organisation" },
    ].map((company) => ({
      ...company,
      country: null,
      time_zone: "Europe/Berlin",
      industry: "",
      city: "",
      tags: [],
      archived_at: null,
    }));
    client.setQueryData(["permissions", "actor"], ["organisations.manage"]);
    client.setQueryData(["user-roles", "actor"], ["admin"]);
    client.setQueryData(
      ["operations", "organisations", "actor"],
      organisations,
    );
    for (const id of [first, second])
      client.setQueryData(["operations", "contacts", "actor", id], []);
    const requestNotes = vi.fn(async (id: string) =>
      id === first
        ? { data: { private_notes: "Private first-company note" }, error: null }
        : { data: null, error: { code: "42501" } },
    );
    const select = vi.fn(() => ({
      eq: (column: string, id: string) => {
        expect(column).toBe("organisation_id");
        return {
          abortSignal: () => ({ maybeSingle: () => requestNotes(id) }),
        };
      },
    }));
    from.mockImplementation((table) => {
      expect(table).toBe("organisation_private_details");
      return { select };
    });
    client.setQueryData(
      ["operations", "company-premium", "actor"],
      [
        { organisation_id: first, enabled: true, version: 1, updated_at: null },
        {
          organisation_id: second,
          enabled: false,
          version: 0,
          updated_at: null,
        },
      ],
    );
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    expect(await screen.findByText("Private first-company note")).toBeVisible();
    expect(select).toHaveBeenCalledWith("private_notes");
    expect(requestNotes.mock.calls).toEqual([[first]]);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await user.click(
      screen.getByRole("button", { name: organisations[1].name }),
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(requestNotes.mock.calls).toEqual([[first], [second]]);
    expect(
      screen.queryByText("Private first-company note"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Organisation bearbeiten" }),
    );
    const editor = screen.getByRole("dialog", {
      name: "Organisation bearbeiten",
    });
    expect(editor.querySelector("textarea")).toBeNull();
    expect(editor.querySelector('[role="alert"]')).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(
      screen.getAllByRole("button", { name: "Beibehaltene Kursdaten ansehen" }),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: organisations[0].name }),
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Private first-company note")).toBeVisible();
    const search = screen.getByRole("searchbox", { name: "Suchen" });
    await user.type(search, "second");
    expect(
      screen.getByRole("heading", { name: organisations[1].name }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: organisations[0].name }),
    ).not.toBeInTheDocument();
    client.clear();
  });
});
