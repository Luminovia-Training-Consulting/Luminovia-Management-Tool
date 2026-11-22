import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DateTime } from "luxon";
import i18n from "../../lib/i18n";
import { AnnouncementBanners } from "./announcement-banners";
import { AnnouncementsPage } from "./announcements";
import { AdminAnnouncementsPage } from "./admin";
import {
  type AdminAnnouncement,
  type Announcement,
  announcementPayload,
} from "./api";

const fake = vi.hoisted(() => ({
  actor: "67ae216a-88f4-4e60-84a9-077dff344fe0",
  permissions: ["announcements.manage"],
  rpc: vi.fn(),
  items: [] as Announcement[],
  record: null as AdminAnnouncement | null,
  listError: null as unknown,
  adminError: null as unknown,
  manageError: null as unknown,
  ackError: null as unknown,
  more: false,
  ackWait: null as Promise<unknown> | null,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: fake.actor } } }),
}));
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = (n = 1): Announcement => ({
  id: id(n),
  announcement_id: id(100 + n),
  revision: n,
  title_de: `Fiktiver Hinweis ${n}`,
  title_en: `Fictional notice ${n}`,
  body_de: "Fiktiver <img src=x> Inhalt als Text.",
  body_en: "Fictional <script> content as text.",
  important: true,
  starts_at: new Date(Date.now() - 60000).toISOString(),
  ends_at: new Date(Date.now() + 86400000).toISOString(),
  time_zone: "Europe/Berlin",
  published_at: new Date(Date.now() - 30000).toISOString(),
  acknowledged_at: null,
});
const clients: QueryClient[] = [];
beforeEach(async () => {
  await i18n.changeLanguage("de");
  fake.actor = "67ae216a-88f4-4e60-84a9-077dff344fe0";
  fake.permissions = ["announcements.manage"];
  fake.items = [base()];
  fake.record = {
    id: id(101),
    version: 3,
    updated_at: new Date().toISOString(),
    archived_at: null,
    draft: {
      ...base(),
      id: id(3),
      revision: 3,
      audience_roles: ["lecturer"],
      created_by: fake.actor,
      created_at: new Date().toISOString(),
    },
    published: {
      ...base(),
      audience_roles: ["lecturer"],
      created_by: fake.actor,
      created_at: new Date().toISOString(),
    },
  };
  fake.listError = null;
  fake.adminError = null;
  fake.manageError = null;
  fake.ackError = null;
  fake.more = false;
  fake.ackWait = null;
  fake.rpc
    .mockReset()
    .mockImplementation((name: string, args: Record<string, unknown> = {}) => {
      let data: unknown = null,
        error: unknown = null;
      if (name === "get_my_permissions") data = fake.permissions;
      else if (name === "announcements") {
        const items = args.p_unacknowledged
          ? fake.items.filter((item) => !item.acknowledged_at)
          : fake.items;
        data = {
          items,
          has_more: fake.more,
          next_cursor: fake.more
            ? { at: base().published_at, id: id(2) }
            : null,
          as_of: new Date().toISOString(),
        };
        error = fake.listError;
      } else if (name === "announcement") {
        data = fake.items.find((item) => item.id === args.p_revision_id);
        error = fake.listError;
      } else if (name === "admin_announcements") {
        data = {
          items: fake.record
            ? [
                {
                  id: fake.record.id,
                  version: fake.record.version,
                  title_de: fake.record.draft.title_de,
                  title_en: fake.record.draft.title_en,
                  has_draft: true,
                  state: fake.record.archived_at ? "archived" : "published",
                  archived_at: fake.record.archived_at,
                  updated_at: fake.record.updated_at,
                  draft_revision_id: fake.record.draft.id,
                  published_revision_id: fake.record.published?.id ?? null,
                },
              ]
            : [],
          has_more: fake.more,
          next_cursor: fake.more
            ? { at: new Date().toISOString(), id: id(2) }
            : null,
        };
        error = fake.adminError;
      } else if (name === "admin_announcement") {
        data = fake.record;
        error = fake.adminError;
      } else if (name === "manage_announcement") {
        data = fake.record;
        error = fake.manageError;
      } else if (name === "acknowledge_announcement") {
        if (fake.ackWait) return fake.ackWait;
        data = new Date().toISOString();
        error = fake.ackError;
        if (!error)
          fake.items = fake.items.map((item) =>
            item.id === args.p_revision_id
              ? { ...item, acknowledged_at: data as string }
              : item,
          );
      }
      const request = Promise.resolve({ data, error });
      return Object.assign(request, { abortSignal: () => request });
    });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
});

function view(element: React.ReactNode, path = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const wrap = (node: React.ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(wrap(element));
  return {
    ...result,
    client,
    update: (node: React.ReactNode) => result.rerender(wrap(node)),
  };
}

const calls = (name: string) =>
  fake.rpc.mock.calls.filter((call) => call[0] === name);
describe("connected announcement publications", () => {
  it("requests at most three unacknowledged banners and preserves authored markup as text", async () => {
    fake.items = [base(1), base(2), base(3), base(4)];
    view(<AnnouncementBanners actor={fake.actor} />);
    await screen.findByText("Fiktiver Hinweis 1");
    expect(screen.getAllByRole("article")).toHaveLength(3);
    expect(screen.queryByText("Fiktiver Hinweis 4")).not.toBeInTheDocument();
    expect(calls("announcements")[0][1]).toMatchObject({
      p_limit: 3,
      p_unacknowledged: true,
      p_before_id: null,
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Alle Ankündigungen öffnen" }),
    ).toHaveAttribute("href", "/announcements");
  });
  it("waits for server acknowledgement, then hides only the exact acknowledged revision", async () => {
    let complete!: (value: unknown) => void;
    fake.ackWait = new Promise((resolve) => {
      complete = resolve;
    });
    const user = userEvent.setup();
    view(<AnnouncementBanners actor={fake.actor} />);
    await user.click(
      await screen.findByRole("button", { name: "Gelesen, ausblenden" }),
    );
    expect(screen.getByText("Fiktiver Hinweis 1")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Gelesen, ausblenden" }),
    ).toBeDisabled();
    expect(calls("acknowledge_announcement")[0][1]).toEqual({
      p_revision_id: id(1),
    });
    fake.items = [];
    await act(async () =>
      complete({ data: new Date().toISOString(), error: null }),
    );
    await waitFor(() =>
      expect(screen.queryByText("Fiktiver Hinweis 1")).not.toBeInTheDocument(),
    );
  });
  it("an uncertain ACK keeps the notice and a retry action instead of false success", async () => {
    fake.ackError = { code: "network", message: "uncertain" };
    const user = userEvent.setup();
    view(<AnnouncementBanners actor={fake.actor} />);
    await user.click(
      await screen.findByRole("button", { name: "Gelesen, ausblenden" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "nicht gespeichert",
    );
    expect(screen.getByText("Fiktiver Hinweis 1")).toBeVisible();
  });
  it("permission errors hide cached banner content", async () => {
    const page = view(<AnnouncementBanners actor={fake.actor} />);
    await screen.findByText("Fiktiver Hinweis 1");
    fake.listError = { code: "42501" };
    await act(async () => {
      await page.client.invalidateQueries({
        queryKey: ["announcements", fake.actor],
      });
    });
    await waitFor(() =>
      expect(screen.queryByText("Fiktiver Hinweis 1")).not.toBeInTheDocument(),
    );
  });
  it("an ACK permission denial hides the private card while current authorization is rechecked", async () => {
    const user = userEvent.setup();
    view(<AnnouncementBanners actor={fake.actor} />);
    const button = await screen.findByRole("button", {
      name: "Gelesen, ausblenden",
    });
    fake.ackError = { code: "42501" };
    fake.listError = { code: "42501" };
    await user.click(button);
    await waitFor(() =>
      expect(screen.queryByText("Fiktiver Hinweis 1")).not.toBeInTheDocument(),
    );
  });
  it("language switches use cached bilingual content without another metadata request", async () => {
    view(<AnnouncementBanners actor={fake.actor} />);
    await screen.findByText("Fiktiver Hinweis 1");
    const count = calls("announcements").length;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(screen.getByText("Fictional notice 1")).toBeVisible();
    expect(calls("announcements")).toHaveLength(count);
    expect(document.querySelector("script")).toBeNull();
  });
  it("actor changes do not reuse another account private banner data", async () => {
    const page = view(<AnnouncementBanners actor={fake.actor} />);
    await screen.findByText("Fiktiver Hinweis 1");
    fake.actor = id(999);
    fake.items = [];
    page.update(<AnnouncementBanners actor={fake.actor} />);
    expect(screen.queryByText("Fiktiver Hinweis 1")).not.toBeInTheDocument();
    await waitFor(() => expect(calls("announcements")).toHaveLength(2));
  });
  it("display expiry removes a card with one local timer and no extra network request", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    fake.items = [
      { ...base(), ends_at: new Date(Date.now() + 2000).toISOString() },
    ];
    view(<AnnouncementBanners actor={fake.actor} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Fiktiver Hinweis 1")).toBeVisible();
    const count = calls("announcements").length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(screen.queryByText("Fiktiver Hinweis 1")).not.toBeInTheDocument();
    expect(calls("announcements")).toHaveLength(count);
  });
  it("the full announcement page suppresses an additional shell banner query and uses an exact revision API", async () => {
    view(
      <>
        <AnnouncementBanners actor={fake.actor} />
        <AnnouncementsPage />
      </>,
      `/announcements?revision=${id(1)}`,
    );
    await screen.findByText("Fiktiver Hinweis 1");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(calls("announcements")).toHaveLength(1);
    expect(calls("announcements")[0][1].p_limit).toBe(20);
    expect(calls("announcement")[0][1]).toEqual({ p_revision_id: id(1) });
  });
  it("ordinary discovery uses the server tuple cursor and applies literal searches without crawling pages", async () => {
    fake.more = true;
    const user = userEvent.setup();
    view(<AnnouncementsPage />, "/announcements");
    await screen.findByText("Fiktiver Hinweis 1");
    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await waitFor(() => expect(calls("announcements")).toHaveLength(2));
    expect(calls("announcements")[1][1].p_before_id).toBe(id(2));
    await user.type(screen.getByLabelText("Ankündigungen suchen"), "%_literal");
    await user.click(screen.getByRole("button", { name: "Suchen" }));
    await waitFor(() =>
      expect(calls("announcements").at(-1)![1]).toMatchObject({
        p_search: "%_literal",
        p_before_id: null,
        p_limit: 20,
      }),
    );
  });
});
describe("announcement management", () => {
  it("does not request drafts for an account without the actual capability", async () => {
    fake.permissions = [];
    view(<AdminAnnouncementsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "aktuelle Berechtigung",
    );
    expect(calls("admin_announcements")).toHaveLength(0);
  });

  async function edit() {
    const user = userEvent.setup();
    const page = view(<AdminAnnouncementsPage />);
    await user.click(
      await screen.findByRole("button", { name: "Entwurf bearbeiten" }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText("Inhalt auf Deutsch");
    return { ...page, user, dialog };
  }

  it("saves a new draft rather than silently publishing; uncertain retries retain the exact request key", async () => {
    fake.manageError = { code: "network", message: "uncertain" };
    const { user, dialog } = await edit();
    const body = within(dialog).getByLabelText("Inhalt auf Deutsch");
    await user.clear(body);
    await user.type(body, "Neuer unveröffentlichter Entwurf");
    for (let i = 0; i < 2; i++) {
      await user.click(
        within(dialog).getByRole("button", { name: "Entwurf speichern" }),
      );
      await within(dialog).findByRole("alert");
    }
    const saved = calls("manage_announcement");
    expect(saved[0][1]).toEqual(saved[1][1]);
    expect(saved[0][1]).toMatchObject({
      p_action: "save",
      p_expected_version: 3,
      p_payload: { body_de: "Neuer unveröffentlichter Entwurf" },
    });
    expect(body).toHaveValue("Neuer unveröffentlichter Entwurf");
    expect(saved.every((call) => call[1].p_action !== "publish")).toBe(true);
  });
  it("retains the editor base version across a background detail refresh and shows exact conflict guidance", async () => {
    fake.manageError = { code: "40001", message: "stale" };
    const { user, dialog, client } = await edit();
    await user.type(
      within(dialog).getByLabelText("Titel auf Deutsch"),
      " Entwurf",
    );
    fake.record = {
      ...fake.record!,
      version: 4,
      draft: { ...fake.record!.draft, title_de: "Parallel geändert" },
    };
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["announcements", fake.actor, "admin-detail"],
      });
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Entwurf speichern" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "inzwischen geändert",
    );
    expect(calls("manage_announcement")[0][1].p_expected_version).toBe(3);
  });
  it("invalid local time windows never send a management operation", async () => {
    const { user, dialog } = await edit();
    fireEvent.change(within(dialog).getByLabelText("Anzeigen bis"), {
      target: { value: "2000-01-01T08:00" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Entwurf speichern" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "gültigen Beginn",
    );
    expect(calls("manage_announcement")).toHaveLength(0);
  });
  it("a revoked management list hides the open draft and retained metadata", async () => {
    const { client } = await edit();
    fake.adminError = { code: "42501" };
    await act(async () => {
      await client.invalidateQueries({
        queryKey: ["announcements", fake.actor, "admin"],
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Fiktiver Hinweis 1")).not.toBeInTheDocument();
  });
  it("a server-denied draft save hides retained editor content immediately", async () => {
    fake.manageError = { code: "42501", message: "revoked" };
    const { user, dialog } = await edit();
    await user.type(
      within(dialog).getByLabelText("Titel auf Deutsch"),
      " Entwurf",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Entwurf speichern" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.queryByText("Fiktiver Hinweis 1")).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "aktuelle Berechtigung",
    );
  });
  it("manages publication/recovery through explicit versioned actions and requests bounded filtered pages", async () => {
    fake.more = true;
    const user = userEvent.setup();
    view(<AdminAnnouncementsPage />);
    await screen.findByText("Fiktiver Hinweis 1");
    // A successful change must clear history from the paged result set.
    await user.click(screen.getByRole("button", { name: "Nächste Seite" }));
    await waitFor(() =>
      expect(calls("admin_announcements").at(-1)![1].p_before_id).toBe(id(2)),
    );
    expect(
      await screen.findByRole("button", { name: "Vorherige Seite" }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Jetzt veröffentlichen" }),
    );
    await screen.findByText("Die Änderung wurde serverseitig bestätigt.");
    expect(calls("manage_announcement")[0][1]).toMatchObject({
      p_action: "publish",
      p_expected_version: 3,
      p_payload: {},
    });
    await waitFor(() =>
      expect(calls("admin_announcements").at(-1)![1].p_before_id).toBeNull(),
    );
    expect(
      screen.getByRole("button", { name: "Vorherige Seite" }),
    ).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Status"), "archived");
    await user.click(screen.getByRole("button", { name: "Suchen" }));
    await waitFor(() =>
      expect(calls("admin_announcements").at(-1)![1]).toMatchObject({
        p_state: "archived",
        p_limit: 20,
        p_before_id: null,
      }),
    );
  });
});
it("metadata-only drafts preserve the original exact seconds instead of truncating accepted window instants", () => {
  const previous = fake.record!.draft;
  const values = {
    ...previous,
    starts_at: DateTime.fromISO(previous.starts_at)
      .setZone(previous.time_zone)
      .toFormat("yyyy-MM-dd'T'HH:mm"),
    ends_at: DateTime.fromISO(previous.ends_at)
      .setZone(previous.time_zone)
      .toFormat("yyyy-MM-dd'T'HH:mm"),
  };
  const result = announcementPayload(values, previous);
  expect(result.starts_at).toBe(previous.starts_at);
  expect(result.ends_at).toBe(previous.ends_at);
});
