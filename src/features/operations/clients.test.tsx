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
  it("offers exact organisation deletion from that organisation's actual edit dialog", async () => {
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
    client.setQueryData(["operations", "contacts", "actor"], []);
    client.setQueryData(["operations", "notes", "actor"], []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
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

  it("replaces the Premium and integrations panels when an admin switches organisations", async () => {
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
    client.setQueryData(["operations", "contacts", "actor"], []);
    client.setQueryData(["operations", "notes", "actor"], []);
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
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await user.click(
      screen.getByRole("button", { name: organisations[1].name }),
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getAllByRole("button", { name: "Beibehaltene Kursdaten ansehen" }),
    ).toHaveLength(1);
    await user.click(
      screen.getByRole("button", { name: organisations[0].name }),
    );
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    client.clear();
  });
});
