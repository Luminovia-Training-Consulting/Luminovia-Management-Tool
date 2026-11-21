/**
 * Contact/reference presentation, reviewed CAS drafts and uncertain-write retries.
 * Controlled SDK responses do not replace actual database permission verification.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { JobBriefing } from "./briefing";
import {
  briefingKey,
  briefingQuery,
  briefingValues,
  briefingValuesSchema,
  briefingWebUrl,
  type JobBriefingData,
  saveBriefing,
} from "./briefing-api";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: "manager-a",
  online: true,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const clients: QueryClient[] = [];
const empty: JobBriefingData = {
  version: 0,
  reference_url: "",
  reference_label: "",
  reference_description: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  contact_description: "",
  contact_visibility: "after_claim",
  has_contact: false,
  contact_visible: true,
  can_manage: true,
  can_edit: true,
};
let server: JobBriefingData;

/** Supply the SDK's abortable read shape while keeping writes as ordinary thenables. */
function response(value: unknown) {
  const promise = Promise.resolve(value);
  return Object.assign(promise, { abortSignal: () => promise });
}

/** Render one resource with a cache isolated from every other test and real browser sessions. */
function setup(
  data: JobBriefingData = empty,
  managementHint = false,
  archived = false,
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { staleTime: Infinity, retry: false },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  client.setQueryData(briefingKey(state.actor, "job-a"), data);
  const app = (job = "job-a") => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <JobBriefing
          jobId={job}
          managementHint={managementHint}
          archived={archived}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, app, ...render(app()) };
}

beforeEach(async () => {
  state.actor = "manager-a";
  state.online = true;
  server = { ...empty };
  state.rpc
    .mockReset()
    .mockImplementation(() => response({ data: server, error: null }));
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it("renders safe authored reference text but never exposes redacted contact values", () => {
  setup({
    ...empty,
    can_manage: false,
    can_edit: false,
    reference_url: "https://example.invalid/brief",
    reference_label: "Fictional reference",
    reference_description: "<img src=x onerror=alert(1)> exact authored text",
    has_contact: true,
    contact_visible: false,
    contact_name: "Hidden Person",
    contact_email: "hidden@example.invalid",
  });
  const link = screen.getByRole("link", { name: "Fictional reference" });
  expect(link).toHaveAttribute("href", "https://example.invalid/brief");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  expect(screen.getByText(/<img src=x/)).toBeVisible();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByText("Hidden Person")).not.toBeInTheDocument();
  expect(screen.queryByText("hidden@example.invalid")).not.toBeInTheDocument();
  expect(
    screen.getByText(
      "Kontaktangaben stehen nach bestätigter Übernahme zur Verfügung.",
    ),
  ).toBeVisible();
});

it("keeps empty optional sections out of ordinary views and explains missing permission", () => {
  const view = setup({
    ...empty,
    can_manage: false,
    can_edit: false,
    contact_visible: false,
  });
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
  view.unmount();
  setup(
    { ...empty, can_manage: false, can_edit: false, contact_visible: false },
    true,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Für diese Aktion fehlt dir die aktuelle Berechtigung.",
  );
  expect(
    screen.queryByRole("button", {
      name: "Kontakt oder Webverweis bearbeiten",
    }),
  ).not.toBeInTheDocument();
});

it("shows a read-only reason for archived management", () => {
  setup({ ...empty, can_edit: false }, true, true);
  expect(
    screen.getByText(
      "Die Angaben dieses archivierten Auftrags können nicht bearbeitet werden.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("waits for acknowledgement and retries an unchanged uncertain write with exactly one request identity", async () => {
  let finish!: (result: unknown) => void;
  let writes = 0;
  state.rpc.mockImplementation(
    (name: string, parameters: { p_payload: object }) => {
      if (name === "job_briefing")
        return response({ data: server, error: null });
      writes++;
      if (writes === 1)
        return new Promise((resolve) => {
          finish = resolve;
        });
      server = {
        ...empty,
        ...parameters.p_payload,
        version: 1,
        has_contact: true,
      };
      return response({ data: server, error: null });
    },
  );
  setup();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  await user.type(
    screen.getByLabelText("Ansprechpartner:in"),
    "Fictional Contact",
  );
  await user.click(screen.getByRole("button", { name: "Angaben speichern" }));
  expect(
    screen.queryByText("Die Angaben wurden gespeichert."),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Wird gespeichert …" }),
  ).toBeDisabled();
  const original = state.rpc.mock.calls.find(
    ([name]) => name === "save_job_briefing",
  )![1];
  expect(original.p_expected_version).toBe(0);
  expect(original.p_payload.contact_visibility).toBe("after_claim");
  expect(Object.keys(original.p_payload)).toHaveLength(8);
  await act(async () =>
    finish({
      data: null,
      error: { code: "NETWORK", message: "Fictional lost response" },
    }),
  );
  expect(screen.getByLabelText("Ansprechpartner:in")).toHaveValue(
    "Fictional Contact",
  );
  await user.click(
    await screen.findByRole("button", { name: "Angaben speichern" }),
  );
  await screen.findByText("Die Angaben wurden gespeichert.");
  const requests = state.rpc.mock.calls.filter(
    ([name]) => name === "save_job_briefing",
  );
  expect(requests).toHaveLength(2);
  expect(requests[1][1]).toEqual(original);
});

it("keeps the reviewed version/draft across background refresh and requires an explicit conflict reload", async () => {
  const current = {
    ...empty,
    version: 3,
    reference_description: "Original reviewed brief",
  };
  server = current;
  const { client } = setup(current);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  await user.clear(screen.getByLabelText("Beschreibung zur Auftragsreferenz"));
  await user.type(
    screen.getByLabelText("Beschreibung zur Auftragsreferenz"),
    "My draft",
  );
  server = {
    ...current,
    version: 4,
    reference_description: "Latest remote brief",
  };
  await act(async () => {
    client.setQueryData(briefingKey(state.actor, "job-a"), server);
  });
  expect(
    screen.getByLabelText("Beschreibung zur Auftragsreferenz"),
  ).toHaveValue("My draft");
  state.rpc.mockImplementation((name: string) =>
    response(
      name === "job_briefing"
        ? { data: server, error: null }
        : { data: null, error: { code: "40001" } },
    ),
  );
  await user.click(screen.getByRole("button", { name: "Angaben speichern" }));
  await screen.findByText(/Der Auftrag wurde zwischenzeitlich geändert/);
  expect(state.rpc).toHaveBeenCalledWith(
    "save_job_briefing",
    expect.objectContaining({ p_expected_version: 3 }),
  );
  expect(
    screen.getByLabelText("Beschreibung zur Auftragsreferenz"),
  ).toHaveValue("My draft");
  await user.click(
    screen.getByRole("button", { name: "Aktuellen Stand übernehmen" }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Beschreibung zur Auftragsreferenz"),
    ).toHaveValue("Latest remote brief"),
  );
});

it("prevents offline changes and unsafe URLs while preserving the draft during a language switch", async () => {
  state.online = false;
  setup();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  await user.type(
    screen.getByLabelText("Weblink zum Auftrag"),
    "javascript:alert(1)",
  );
  expect(
    screen.getByRole("button", { name: "Angaben speichern" }),
  ).toBeDisabled();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByLabelText("Job web link")).toHaveValue(
    "javascript:alert(1)",
  );
  expect(screen.getByRole("button", { name: "Save details" })).toBeDisabled();
  expect(state.rpc).not.toHaveBeenCalledWith(
    "save_job_briefing",
    expect.anything(),
  );
});

it("does not carry editing state into another actor or job", async () => {
  const view = setup();
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  await user.type(
    screen.getByLabelText("Ansprechpartner:in"),
    "Private draft A",
  );
  view.client.setQueryData(briefingKey(state.actor, "job-b"), empty);
  view.rerender(view.app("job-b"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  expect(screen.getByLabelText("Ansprechpartner:in")).toHaveValue("");
  state.actor = "manager-b";
  view.client.setQueryData(briefingKey(state.actor, "job-b"), empty);
  view.rerender(view.app("job-b"));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("hides cached contact and the open private draft as soon as a write is denied", async () => {
  const current = {
    ...empty,
    version: 1,
    has_contact: true,
    contact_name: "Private contact",
  };
  server = current;
  setup(current);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  state.rpc.mockImplementation(() =>
    response({ data: null, error: { code: "42501" } }),
  );
  await user.click(screen.getByRole("button", { name: "Angaben speichern" }));
  await screen.findByText(
    "Kontakt und Auftragsreferenz konnten nicht geladen werden.",
  );
  expect(screen.queryByText("Private contact")).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("hides previously cached contacts after a denied read refresh", async () => {
  const { client } = setup({
    ...empty,
    has_contact: true,
    contact_name: "Current contact",
  });
  expect(screen.getByText("Current contact")).toBeVisible();
  state.rpc.mockImplementation(() =>
    response({ data: null, error: { code: "42501" } }),
  );
  await act(async () => {
    await client.invalidateQueries({
      queryKey: briefingKey(state.actor, "job-a"),
    });
  });
  await screen.findByText(
    "Kontakt und Auftragsreferenz konnten nicht geladen werden.",
  );
  expect(screen.queryByText("Current contact")).not.toBeInTheDocument();
});

it("validates URLs, optional clearing and closed payloads before any actual mutation", async () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://name:password@example.invalid/a",
    "https://example.invalid/a\nb",
    "//example.invalid/a",
    "https:///missing-host",
    "https:\\example.invalid/path",
    "https://example.invalid\\path",
    "https://example.invalid:",
    "https://%65xample.invalid/path",
    "https://example.invalid:0/path",
    "https://[:::]/brief",
    "https://example.invalid/a\\b",
    "https://999.999.999.999/brief",
  ])
    expect(briefingWebUrl(url)).toBeNull();
  expect(briefingWebUrl("https://example.invalid/reference?q=1#details")).toBe(
    "https://example.invalid/reference?q=1#details",
  );
  expect(
    briefingValuesSchema.safeParse({ ...briefingValues(empty), role: "admin" })
      .success,
  ).toBe(false);
  expect(
    briefingValuesSchema.safeParse({
      ...briefingValues(empty),
      contact_email: "name@example.invalid\r\nBcc: x@example.invalid",
    }).success,
  ).toBe(false);
  server = { ...empty, version: 1 };
  await saveBriefing("job-a", 0, "request-a", briefingValues(empty));
  expect(state.rpc).toHaveBeenCalledWith(
    "save_job_briefing",
    expect.objectContaining({ p_payload: briefingValues(empty) }),
  );
  state.online = false;
  await expect(
    saveBriefing("job-a", 0, "request-b", briefingValues(empty)),
  ).rejects.toThrow("offline");
});

it("keeps a browser-unparseable stored reference readable and repairable without rendering a link", async () => {
  server = {
    ...empty,
    version: 1,
    reference_url: "https://[:::]/brief",
    reference_description: "Retain this authored explanation",
  };
  const client = new QueryClient();
  clients.push(client);
  const data = await client.fetchQuery(briefingQuery(state.actor, "job-a"));
  expect(data.reference_url).toBe(server.reference_url);
  setup(data);
  expect(screen.getByText(server.reference_description)).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  expect(screen.getByLabelText("Weblink zum Auftrag")).toHaveValue(
    server.reference_url,
  );
  expect(
    screen.getByRole("button", { name: "Angaben speichern" }),
  ).toBeDisabled();
});

it("uses PostgreSQL character counts for supplementary Unicode text on reads and edits", async () => {
  const name = "😀".repeat(120);
  server = { ...empty, version: 1, contact_name: name, has_contact: true };
  const client = new QueryClient();
  clients.push(client);
  const data = await client.fetchQuery(briefingQuery(state.actor, "job-a"));
  expect(data.contact_name).toBe(name);
  expect(briefingValuesSchema.safeParse(briefingValues(data)).success).toBe(
    true,
  );
  expect(
    briefingValuesSchema.safeParse({
      ...briefingValues(data),
      contact_name: name + "😀",
    }).success,
  ).toBe(false);
  setup(data);
  expect(screen.getByText(name)).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Kontakt oder Webverweis bearbeiten" }),
  );
  expect(screen.getByLabelText("Ansprechpartner:in")).toHaveValue(name);
  expect(screen.getByLabelText("Ansprechpartner:in")).toHaveAttribute(
    "maxlength",
    "240",
  );
  expect(
    screen.getByRole("button", { name: "Angaben speichern" }),
  ).toBeEnabled();
});

it("canonicalizes IDN and valid shorthand IPv4 before binding the save request", async () => {
  for (const [authored, canonical] of [
    ["https://bücher.example/brief", "https://xn--bcher-kva.example/brief"],
    ["http://127.1/brief", "http://127.0.0.1/brief"],
  ]) {
    server = { ...empty, version: 1, reference_url: canonical };
    const result = await saveBriefing("job-a", 0, "request-a", {
      ...briefingValues(empty),
      reference_url: authored,
    });
    expect(result.reference_url).toBe(canonical);
    expect(state.rpc).toHaveBeenLastCalledWith(
      "save_job_briefing",
      expect.objectContaining({
        p_payload: expect.objectContaining({ reference_url: canonical }),
      }),
    );
  }
});

it("rejects a structurally valid but unadvanced write response as unconfirmed", async () => {
  await expect(
    saveBriefing("job-a", 0, "request-a", briefingValues(empty)),
  ).rejects.toThrow("unconfirmed_briefing");
});
