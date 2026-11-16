import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  OwnQualificationEvidence,
  QualificationEvidenceReview,
} from "./evidence";
import { qualificationReviewQuery } from "./api";
const ids = {
  teacher: "11111111-1111-4111-8111-111111111111",
  manager: "22222222-2222-4222-8222-222222222222",
  topic: "33333333-3333-4333-8333-333333333333",
  doc: "44444444-4444-4444-8444-444444444444",
  version: "55555555-5555-4555-8555-555555555555",
  binding: "66666666-6666-4666-8666-666666666666",
};
const state = vi.hoisted(() => ({
  actor: "11111111-1111-4111-8111-111111111111",
  rpc: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../files/api", () => ({ saveQualificationEvidence: state.download }));
const certificate = {
  version_id: ids.version,
  document_id: ids.doc,
  name: "Original.txt",
  sha256: "a".repeat(64),
  version: 1,
  created_at: "2030-01-01T00:00:00Z",
};
const evidence = {
  id: ids.binding,
  version_id: ids.version,
  document_id: ids.doc,
  name: certificate.name,
  sha256: certificate.sha256,
  created_at: certificate.created_at,
};
let record: {
  user_id: string;
  topic_id: string;
  version: number;
  verified: boolean;
  valid_until: string | null;
  evidence: typeof evidence | null;
};
let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.actor = ids.teacher;
  record = {
    user_id: ids.teacher,
    topic_id: ids.topic,
    version: 0,
    verified: false,
    valid_until: null,
    evidence: null,
  };
  state.rpc.mockReset();
  state.download.mockReset();
  state.download.mockResolvedValue(undefined);
  state.rpc.mockImplementation(async (name, args) => {
    if (name === "qualification_review")
      return { data: structuredClone(record), error: null };
    if (name === "own_qualification_certificates")
      return {
        data: { items: [certificate], has_more: false, next_cursor: null },
        error: null,
      };
    if (name === "qualification_history")
      return {
        data: { items: [], has_more: false, next_cursor: null },
        error: null,
      };
    if (name === "save_qualification_evidence") {
      record = {
        ...record,
        version: record.version + 1,
        evidence: args.p_version_id ? evidence : null,
      };
      return { data: structuredClone(record), error: null };
    }
    if (name === "attest_qualification") {
      record = {
        ...record,
        version: record.version + 1,
        verified: true,
        valid_until: args.p_valid_until,
      };
      return { data: structuredClone(record), error: null };
    }
    throw new Error(name);
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function own() {
  render(
    <QueryClientProvider client={client}>
      <OwnQualificationEvidence
        topics={[{ id: ids.topic, label_de: "Python", label_en: "Python" }]}
      />
    </QueryClientProvider>,
  );
}
function manage() {
  state.actor = ids.manager;
  render(
    <QueryClientProvider client={client}>
      <QualificationEvidenceReview
        userId={ids.teacher}
        topicId={ids.topic}
        disabled={false}
      />
    </QueryClientProvider>,
  );
}
async function choose() {
  own();
  await userEvent.selectOptions(
    screen.getByLabelText("Ausgewähltes Thema"),
    ids.topic,
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Zertifikatsversion auswählen",
    }),
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Auswählen: Original.txt, Version 1",
    }),
  );
}
describe("explicit exact-version qualification evidence", () => {
  it("does not query certificates or private topics before user selection", () => {
    own();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("requires explicit consent, pins the selected version and waits for server confirmation", async () => {
    await choose();
    const share = screen.getByRole("button", {
      name: "Version freigeben",
    });
    expect(share).toBeDisabled();
    expect(
      state.rpc.mock.calls.some(
        (call) => call[0] === "save_qualification_evidence",
      ),
    ).toBe(false);
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(share);
    await screen.findByText("Die Freigabe wurde gespeichert.");
    expect(state.rpc).toHaveBeenCalledWith("save_qualification_evidence", {
      p_topic_id: ids.topic,
      p_version_id: ids.version,
      p_expected_version: 0,
      p_request_id: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
    expect(record.verified).toBe(false);
  });
  it("retains draft and request key after a lost response; changing payload creates another command", async () => {
    await choose();
    await userEvent.click(screen.getByRole("checkbox"));
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name, args) =>
      name === "save_qualification_evidence"
        ? { data: null, error: { code: "NETWORK", message: "lost" } }
        : original(name, args),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Version freigeben" }),
    );
    await screen.findByRole("alert");
    await userEvent.click(
      screen.getByRole("button", { name: "Version freigeben" }),
    );
    await waitFor(() =>
      expect(
        state.rpc.mock.calls.filter(
          (call) => call[0] === "save_qualification_evidence",
        ),
      ).toHaveLength(2),
    );
    const calls = state.rpc.mock.calls.filter(
      (call) => call[0] === "save_qualification_evidence",
    );
    expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
  it("withdrawal uses a versioned null grant and does not claim to revoke accepted work", async () => {
    record.evidence = evidence;
    record.verified = true;
    record.version = 4;
    own();
    await userEvent.selectOptions(
      screen.getByLabelText("Ausgewähltes Thema"),
      ids.topic,
    );
    expect(
      await screen.findByText(/Bereits erteilte Verifikationen/),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Freigabe zurückziehen",
      }),
    );
    await screen.findByText("Die Freigabe wurde gespeichert.");
    expect(state.rpc).toHaveBeenCalledWith(
      "save_qualification_evidence",
      expect.objectContaining({ p_version_id: null, p_expected_version: 4 }),
    );
    expect(record.verified).toBe(true);
  });
  it("management performs no extra query before opening the topic and never requests all personal files", async () => {
    record.evidence = evidence;
    manage();
    expect(state.rpc).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    await screen.findByText("Original.txt");
    expect(state.rpc).toHaveBeenCalledWith("qualification_review", {
      p_user_id: ids.teacher,
      p_topic_id: ids.topic,
    });
    expect(
      state.rpc.mock.calls.some(
        (call) => call[0] === "own_qualification_certificates",
      ),
    ).toBe(false);
  });
  it("downloads the binding ID, not a latest-document version", async () => {
    record.evidence = evidence;
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Freigegebene Version herunterladen",
      }),
    );
    expect(state.download).toHaveBeenCalledWith(ids.binding, "Original.txt");
  });
  it("evidence verification retains existing UTC expiry and sends current CAS plus exact binding", async () => {
    record.evidence = evidence;
    record.version = 7;
    record.valid_until = "2045-01-01T10:30:56.789Z";
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Mit diesem Beleg verifizieren",
      }),
    );
    await screen.findByText("Die beleggebundene Verifikation wurde bestätigt.");
    expect(state.rpc).toHaveBeenCalledWith(
      "attest_qualification",
      expect.objectContaining({
        p_user_id: ids.teacher,
        p_topic_id: ids.topic,
        p_evidence_id: ids.binding,
        p_expected_version: 7,
        p_valid_until: "2045-01-01T10:30:56.789Z",
      }),
    );
  });
  it("a dirty evidence review keeps its captured CAS/version after a background change", async () => {
    record.evidence = evidence;
    record.version = 7;
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    fireEvent.change(await screen.findByLabelText("Gültig bis (UTC)"), {
      target: { value: "2044-01-01T00:00" },
    });
    record.version = 8;
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["qualification", ids.manager, ids.teacher, ids.topic],
      });
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Mit diesem Beleg verifizieren" }),
    );
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith(
        "attest_qualification",
        expect.objectContaining({
          p_expected_version: 7,
          p_evidence_id: ids.binding,
        }),
      ),
    );
  });
  it("rejects past expiry without a mutation", async () => {
    record.evidence = evidence;
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    fireEvent.change(await screen.findByLabelText("Gültig bis (UTC)"), {
      target: { value: "2020-01-01T00:00" },
    });
    await userEvent.click(
      screen.getByRole("button", { name: "Mit diesem Beleg verifizieren" }),
    );
    await screen.findByText("Gib ein gültiges zukünftiges UTC-Datum an.");
    expect(
      state.rpc.mock.calls.some((call) => call[0] === "attest_qualification"),
    ).toBe(false);
  });
  it("download revocation hides cached name/hash and gives no stale retry link", async () => {
    record.evidence = evidence;
    state.download.mockRejectedValue(new Error("access_denied"));
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Freigegebene Version herunterladen",
      }),
    );
    await screen.findByRole("alert");
    expect(screen.queryByText("Original.txt")).not.toBeInTheDocument();
    expect(screen.queryByText("a".repeat(64))).not.toBeInTheDocument();
  });
  it("a fresh query error hides previously cached private record", async () => {
    record.evidence = evidence;
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    await screen.findByText("Original.txt");
    state.rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "revoked" },
    });
    await act(async () => {
      await client.refetchQueries({
        queryKey: ["qualification", ids.manager, ids.teacher, ids.topic],
      });
    });
    await screen.findByRole("alert");
    expect(screen.queryByText("Original.txt")).not.toBeInTheDocument();
  });
  it("history is loaded on request and identifies manual versus evidence basis", async () => {
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    await screen.findByText(
      "Für dieses Thema ist kein Zertifikatsbeleg freigegeben.",
    );
    expect(
      state.rpc.mock.calls.some((call) => call[0] === "qualification_history"),
    ).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Prüfverlauf" }));
    await screen.findByText(/keine erfundene/);
    expect(state.rpc).toHaveBeenCalledWith(
      "qualification_history",
      expect.objectContaining({ p_limit: 20, p_before_id: null }),
    );
  });
  it("a denied history request conceals all currently displayed grant metadata", async () => {
    record.evidence = evidence;
    manage();
    await userEvent.click(
      screen.getByRole("button", { name: "Beleg und Prüfverlauf anzeigen" }),
    );
    await screen.findByText("Original.txt");
    const original = state.rpc.getMockImplementation()!;
    state.rpc.mockImplementation(async (name, args) =>
      name === "qualification_history"
        ? { data: null, error: { code: "42501", message: "revoked" } }
        : original(name, args),
    );
    await userEvent.click(screen.getByRole("button", { name: "Prüfverlauf" }));
    await screen.findByRole("alert");
    expect(screen.queryByText("Original.txt")).not.toBeInTheDocument();
  });
  it("the certificate picker uses actual next cursors and literal bounded searches", async () => {
    const original = state.rpc.getMockImplementation()!,
      cursor = { at: "2030-01-01T00:00:00Z", id: ids.version };
    state.rpc.mockImplementation(async (name, args) =>
      name === "own_qualification_certificates"
        ? {
            data: {
              items: [certificate],
              has_more: !args.p_before_id,
              next_cursor: args.p_before_id ? null : cursor,
            },
            error: null,
          }
        : original(name, args),
    );
    own();
    await userEvent.selectOptions(
      screen.getByLabelText("Ausgewähltes Thema"),
      ids.topic,
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Zertifikatsversion auswählen",
      }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Nächste Seite" }),
    );
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith(
        "own_qualification_certificates",
        expect.objectContaining({
          p_before_id: ids.version,
          p_before_at: cursor.at,
          p_limit: 20,
        }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Zertifikatsname"), {
      target: { value: "%_" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Suchen" }));
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith(
        "own_qualification_certificates",
        expect.objectContaining({
          p_search: "%_",
          p_before_id: null,
          p_limit: 20,
        }),
      ),
    );
  });
  it("English controls preserve authored certificate names and explicit permission text", async () => {
    await i18n.changeLanguage("en");
    own();
    await userEvent.selectOptions(
      screen.getByLabelText("Selected topic"),
      ids.topic,
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Choose certificate version" }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Select: Original.txt, Version 1",
      }),
    );
    expect(screen.getByRole("checkbox")).toHaveAccessibleName(
      "I share exactly this certificate version for qualification review by authorised management.",
    );
    expect(
      screen.getByRole("button", { name: "Share version" }),
    ).toBeDisabled();
  });
  it("validates the API DTO instead of rendering arbitrary partial private data", async () => {
    state.rpc.mockResolvedValue({
      data: { evidence: { name: "stale secret" } },
      error: null,
    });
    await expect(
      client.fetchQuery(
        qualificationReviewQuery(ids.teacher, ids.teacher, ids.topic),
      ),
    ).rejects.toThrow();
  });
});
