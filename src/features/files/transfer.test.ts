/**
 * Regressions for browser transfer completion, scan state, Auth/network failures and exact
 * versions. Controlled transport does not replace real RLS/Auth/Storage/browser acceptance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadDocument,
  downloadCourseScormPackage,
  learningSubmissionMaxBytes,
  maximumFileSize,
  saveOrganisationContract,
  saveDownload,
  saveExpenseReceipt,
  saveQualificationEvidence,
  uploadAcademyAnswerKeyPdf,
  uploadAcademyCourseMaterial,
  uploadAcademyAttendancePdf,
  uploadAcademyCourseChatAttachment,
  uploadAcademyStudentExamPdf,
  uploadCourseAssignmentSubmission,
  uploadCourseScormPackage,
  uploadCourseSubmission,
  uploadDocument,
  uploadExpenseReceipt,
  uploadOrganisationContract,
  uploadPortfolioEvidence,
} from "./api";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ auth }),
}));

// Controlled browser transport only. Real scanning/Storage permissions remain
// covered by the isolated HTTP/SQL suites, not this client-side fixture.
/** Controlled XMLHttpRequest fixture exposing headers, progress and completion events. */
class Request {
  static requests: Request[] = [];
  upload = { onprogress: null as null | ((event: ProgressEvent) => void) };
  onerror: null | (() => void) = null;
  ontimeout: null | (() => void) = null;
  onload: null | (() => void) = null;
  responseText = "";
  status = 0;
  timeout = 0;
  form?: FormData;
  headers: Record<string, string> = {};
  open = vi.fn();

  constructor() {
    Request.requests.push(this);
  }

  setRequestHeader = (name: string, value: string) => {
    this.headers[name] = value;
  };
  send = (form: FormData) => {
    this.form = form;
  };

  progress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.(
      new ProgressEvent("progress", { loaded, total, lengthComputable }),
    );
  }

  respond(status: number, body: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(body);
    this.onload?.();
  }
}

const file = () =>
  new File(["Fictional PDF bytes"], "lesson.pdf", { type: "application/pdf" });
beforeEach(() => {
  Request.requests = [];
  auth.getSession.mockReset().mockResolvedValue({
    data: {
      session: {
        access_token: "fictional-access-token",
        user: { id: "fictional-actor" },
      },
    },
    error: null,
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  vi.stubGlobal("XMLHttpRequest", Request);
  vi.stubEnv("VITE_SUPABASE_URL", "https://fictional.example.invalid/backend");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fictional");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Call the real upload function and wait for its controlled XMLHttpRequest instance. */
async function transfer(onProgress?: (percent: number) => void) {
  const promise = uploadDocument(file(), { scope: "personal" }, onProgress);
  await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
  return { promise, request: Request.requests[0] };
}

describe("online, authenticated document transfers", () => {
  it("rejects an independent copy after the active account changed", async () => {
    await expect(
      uploadDocument(file(), {
        scope: "personal",
        expectedActor: "previous-account",
      }),
    ).rejects.toThrow("account_changed");
    await expect(
      uploadAcademyCourseMaterial(
        file(),
        "course",
        "retry",
        undefined,
        "previous-account",
      ),
    ).rejects.toThrow("account_changed");
    expect(Request.requests).toHaveLength(0);
  });

  it("uses the SCORM scan scope and returns the exact clean version", async () => {
    await expect(
      uploadCourseScormPackage(new File([], "short.zip"), "course", "retry"),
    ).rejects.toThrow("file_size");
    const large = new File([], "large.zip");
    Object.defineProperty(large, "size", { value: 10 * 1024 * 1024 + 1 });
    await expect(
      uploadCourseScormPackage(large, "course", "retry"),
    ).rejects.toThrow("file_size");
    const sample = new File(["Fictional ZIP"], "sample.zip", {
      type: "application/zip",
    });
    for (const [document, accepted] of [
      [
        {
          status: "clean",
          kind: "scorm_package",
          current_version_id: "checked",
        },
        true,
      ],
      [
        { status: "clean", kind: "material", current_version_id: "checked" },
        false,
      ],
      [{ status: "clean", kind: "scorm_package" }, false],
    ] as const) {
      const pending = uploadCourseScormPackage(sample, "course", "retry");
      await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
      const request = Request.requests.pop()!;
      expect(request.open).toHaveBeenCalledWith(
        "POST",
        "https://fictional.example.invalid/backend/functions/v1/files?mode=scorm-package",
      );
      expect(request.form?.get("scorm_course_id")).toBe("course");
      expect(request.form?.get("client_id")).toBe("retry");
      request.respond(200, { document });
      if (accepted) await expect(pending).resolves.toBe("checked");
      else await expect(pending).rejects.toThrow("upload_failed");
    }
  });

  it("downloads the published SCORM bytes using the course and version grant", async () => {
    const signal = new AbortController().signal;
    const bytes = new Blob(["Fictional scanned archive"]);
    const fetch = vi.fn().mockResolvedValue(new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    await expect(
      downloadCourseScormPackage("course", "checked", signal),
    ).resolves.toBeInstanceOf(Blob);
    expect(fetch).toHaveBeenCalledWith(
      "https://fictional.example.invalid/backend/functions/v1/files",
      expect.objectContaining({
        method: "POST",
        signal,
        body: JSON.stringify({
          action: "course_scorm_download",
          run_id: "course",
          version_id: "checked",
        }),
      }),
    );
  });

  it("scans an assignment submission through the exact course and assignment route", async () => {
    const empty = new File([], "empty.txt");
    expect(() =>
      uploadCourseAssignmentSubmission(empty, "course", "assignment", "retry"),
    ).toThrow("file_size");
    expect(Request.requests).toHaveLength(0);

    const bytes = new File(["Fictional exercise"], "exercise.txt", {
      type: "text/plain",
    });
    const pending = uploadCourseAssignmentSubmission(
      bytes,
      "course",
      "assignment",
      "retry",
    );
    await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
    const request = Request.requests[0];
    expect(request.open).toHaveBeenCalledWith(
      "POST",
      "https://fictional.example.invalid/backend/functions/v1/files?mode=assignment-submission",
    );
    expect([...request.form!]).toEqual([
      ["file", bytes],
      ["course_run_id", "course"],
      ["assignment_id", "assignment"],
      ["client_id", "retry"],
    ]);
    request.respond(200, { document: { status: "clean" } });
    await expect(pending).resolves.toMatchObject({ status: "clean" });
  });

  it("uploads company PDFs only to the dedicated company reservation", async () => {
    const bytes = file();
    const pending = uploadOrganisationContract(bytes, "company-id", "retry-id");
    await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
    const request = Request.requests[0];
    expect([...request.form!]).toEqual([
      ["file", bytes],
      ["client_id", "retry-id"],
      ["kind", "organisation_contract"],
      ["contract_organisation_id", "company-id"],
    ]);
    request.respond(200, { document: { status: "clean" } });
    await expect(pending).resolves.toMatchObject({ status: "clean" });
  });

  it("rejects invalid receipt sizes before starting a transfer", async () => {
    for (const size of [0, learningSubmissionMaxBytes + 1]) {
      const bytes = file();
      Object.defineProperty(bytes, "size", { value: size });
      await expect(
        uploadExpenseReceipt(bytes, "retry-id", "fictional-actor"),
      ).rejects.toThrow("file_size");
    }
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(Request.requests).toHaveLength(0);
  });

  it.each([
    ["expense_receipt", "scanned-version", "fictional-actor", true],
    ["material", "scanned-version", "fictional-actor", false],
    ["expense_receipt", null, "fictional-actor", false],
    ["expense_receipt", "scanned-version", "another-actor", false],
  ] as const)(
    "validates a receipt with kind %s, version %s, and owner %s",
    async (kind, current_version_id, owner_id, accepted) => {
      const bytes = file();
      const pending = uploadExpenseReceipt(
        bytes,
        "retry-id",
        "fictional-actor",
      );
      await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
      const request = Request.requests[0];
      expect(request.open).toHaveBeenCalledWith(
        "POST",
        "https://fictional.example.invalid/backend/functions/v1/files?mode=expense-receipt",
      );
      expect([...request.form!]).toEqual([
        ["file", bytes],
        ["client_id", "retry-id"],
      ]);
      const document = { status: "clean", kind, current_version_id, owner_id };
      request.respond(200, { document });
      if (accepted) await expect(pending).resolves.toEqual(document);
      else await expect(pending).rejects.toThrow("upload_failed");
    },
  );

  it("does not start a receipt upload after the account changes", async () => {
    await expect(
      uploadExpenseReceipt(file(), "retry-id", "previous-account"),
    ).rejects.toThrow("account_changed");
    expect(Request.requests).toHaveLength(0);
  });

  it("rejects invalid company PDF sizes before opening a transfer", () => {
    for (const size of [0, maximumFileSize + 1]) {
      const bytes = new File([], "empty.pdf");
      Object.defineProperty(bytes, "size", { value: size });
      expect(() =>
        uploadOrganisationContract(bytes, "company-id", "retry-id"),
      ).toThrow("file_size");
    }
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(Request.requests).toHaveLength(0);
  });
  it.each([
    ["academy-material", uploadAcademyCourseMaterial],
    ["academy-student-exam", uploadAcademyStudentExamPdf],
    ["academy-answer-key", uploadAcademyAnswerKeyPdf],
  ] as const)(
    "sends %s through the scoped gateway with its stable retry key",
    async (mode, upload) => {
      const promise = upload(file(), "course-id", "upload-id");
      await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
      const request = Request.requests[0];
      expect(request.open).toHaveBeenCalledWith(
        "POST",
        `https://fictional.example.invalid/backend/functions/v1/files?mode=${mode}`,
      );
      expect([...request.form!.keys()].sort()).toEqual([
        "academy_course_id",
        "client_id",
        "file",
      ]);
      expect(request.form!.get("academy_course_id")).toBe("course-id");
      expect(request.form!.get("client_id")).toBe("upload-id");
      expect(request.headers.Authorization).toBe(
        "Bearer fictional-access-token",
      );
      request.respond(200, {
        document: { status: "clean", current_version_id: "reviewed-version" },
      });
      await expect(promise).resolves.toMatchObject({
        current_version_id: "reviewed-version",
      });
    },
  );
  it.each([
    { mode: "course-submission", exam: undefined },
    { mode: "exam-submission", exam: true },
  ])(
    "sends $mode with the exact course, file and retry key",
    async ({ mode, exam }) => {
      const bytes = file();
      const promise = uploadCourseSubmission(
        bytes,
        "fictional-course",
        "draft-key",
        exam,
      );
      await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
      const request = Request.requests[0];
      expect(request.open).toHaveBeenCalledWith(
        "POST",
        `https://fictional.example.invalid/backend/functions/v1/files?mode=${mode}`,
      );
      expect([...request.form!]).toEqual([
        ["file", bytes],
        ["course_run_id", "fictional-course"],
        ["client_id", "draft-key"],
      ]);
      request.respond(200, {
        document: { status: "clean", current_version_id: "fictional-version" },
      });
      await expect(promise).resolves.toMatchObject({
        current_version_id: "fictional-version",
      });
    },
  );

  it("rejects empty and oversized exam drafts before opening an upload", () => {
    for (const size of [0, 10 * 1024 * 1024 + 1]) {
      const bytes = new File([new Uint8Array(size)], "exam.pdf", {
        type: "application/pdf",
      });
      expect(() =>
        uploadCourseSubmission(bytes, "fictional-course", "draft-key", true),
      ).toThrow("file_size");
    }
    expect(Request.requests).toHaveLength(0);
  });

  it("rejects empty and oversized portfolio evidence before opening an upload", async () => {
    for (const size of [0, 10 * 1024 * 1024 + 1]) {
      const bytes = new File([new Uint8Array(size)], "evidence.pdf", {
        type: "application/pdf",
      });
      await expect(uploadPortfolioEvidence(bytes, "retry-key")).rejects.toThrow(
        "file_size",
      );
    }
    expect(Request.requests).toHaveLength(0);
  });

  it("returns the exact scan-confirmed version from the portfolio file gateway", async () => {
    const bytes = file();
    const pending = uploadPortfolioEvidence(bytes, "retry-key");
    await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
    const request = Request.requests[0];
    expect(request.open).toHaveBeenCalledWith(
      "POST",
      "https://fictional.example.invalid/backend/functions/v1/files?mode=portfolio-evidence",
    );
    expect([...request.form!]).toEqual([
      ["file", bytes],
      ["client_id", "retry-key"],
    ]);
    request.respond(200, {
      document: {
        status: "clean",
        kind: "portfolio_evidence",
        current_version_id: "evidence-version",
      },
    });
    await expect(pending).resolves.toBe("evidence-version");
  });

  it.each([
    { kind: "material", current_version_id: "wrong-version" },
    { kind: "portfolio_evidence", current_version_id: null },
  ])(
    "rejects an unrelated or missing portfolio receipt version",
    async (document) => {
      const pending = uploadPortfolioEvidence(file(), "retry-key");
      await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
      Request.requests[0].respond(200, {
        document: { status: "clean", ...document },
      });
      await expect(pending).rejects.toThrow("upload_failed");
    },
  );

  it("sends an academy chat draft only with its room, retry key and file", async () => {
    const promise = uploadAcademyCourseChatAttachment(
      file(),
      "course-room",
      "key",
    );
    await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
    const request = Request.requests[0];
    expect(request.open).toHaveBeenCalledWith(
      "POST",
      "https://fictional.example.invalid/backend/functions/v1/files?mode=academy-course-chat",
    );
    expect([...request.form!.keys()].sort()).toEqual([
      "academy_room_id",
      "client_id",
      "file",
    ]);
    expect(request.form!.get("academy_room_id")).toBe("course-room");
    expect(request.form!.get("client_id")).toBe("key");
    request.respond(200, {
      document: { status: "clean", current_version_id: "reviewed-version" },
    });
    await expect(promise).resolves.toMatchObject({
      current_version_id: "reviewed-version",
    });
  });

  it("sends academy evidence only to the exact session PDF transport", async () => {
    const promise = uploadAcademyAttendancePdf(
      file(),
      "exact-session",
      "request",
    );
    await vi.waitFor(() => expect(Request.requests).toHaveLength(1));
    const request = Request.requests[0];
    expect(request.open).toHaveBeenCalledWith(
      "POST",
      "https://fictional.example.invalid/backend/functions/v1/files?mode=academy-attendance",
    );
    expect([...request.form!.keys()].sort()).toEqual([
      "academy_session_id",
      "client_id",
      "file",
    ]);
    expect(request.form!.get("academy_session_id")).toBe("exact-session");
    expect(request.form!.get("client_id")).toBe("request");
    request.respond(200, {
      document: { status: "clean", current_version_id: "scanned-version" },
    });
    await expect(promise).resolves.toMatchObject({
      current_version_id: "scanned-version",
    });
  });

  it("keeps sent bytes below completion until the server confirms clean storage", async () => {
    const progress = vi.fn();
    const { promise, request } = await transfer(progress);
    request.progress(1, 2);
    request.progress(1, 1);
    request.progress(2, 1);
    request.progress(1, 1, false);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([48, 95, 95]);
    expect(request.headers).toEqual({
      Authorization: "Bearer fictional-access-token",
      apikey: "sb_publishable_fictional",
    });
    expect(request.open).toHaveBeenCalledWith(
      "POST",
      "https://fictional.example.invalid/backend/functions/v1/files",
    );
    expect(request.form?.get("file")).toBeInstanceOf(File);
    expect(request.form?.get("scope")).toBe("personal");
    expect(request.form?.get("kind")).toBe("material");
    const document = { id: "fictional-document", status: "clean" };
    request.respond(201, { document });
    await expect(promise).resolves.toEqual(document);
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it("does not confirm a successful HTTP response while scanning is still pending", async () => {
    const progress = vi.fn();
    const { promise, request } = await transfer(progress);
    const rejected = expect(promise).rejects.toThrow("upload_failed");
    request.respond(202, {
      document: { id: "fictional-document", status: "scanning" },
    });
    await rejected;
    expect(progress).not.toHaveBeenCalledWith(100);
  });

  it("retains the same explicit client identity and attachment context for a retry", async () => {
    const context = {
      scope: "room" as const,
      roomId: "fictional-room",
      jobId: "fictional-job",
      replaceId: "fictional-previous",
      ownerId: "fictional-owner",
      clientId: "fictional-retry",
    };
    for (const status of [503, 201]) {
      const previousRequests = Request.requests.length;
      const promise = uploadDocument(file(), context);
      const completed =
        status === 503
          ? expect(promise).rejects.toThrow("upload_failed")
          : expect(promise).resolves.toMatchObject({ status: "clean" });
      await vi.waitFor(() =>
        expect(Request.requests).toHaveLength(previousRequests + 1),
      );
      const request = Request.requests.at(-1)!;
      for (const [key, value] of Object.entries({
        scope: "room",
        kind: "chat",
        room_id: "fictional-room",
        job_id: "fictional-job",
        replace_id: "fictional-previous",
        owner_id: "fictional-owner",
        client_id: "fictional-retry",
      }))
        expect(request.form?.get(key)).toBe(value);
      request.respond(
        status,
        status === 201 ? { document: { status: "clean" } } : {},
      );
      await completed;
    }
  });

  it.each(["onerror", "ontimeout"] as const)(
    "rejects %s without claiming a completed upload",
    async (event) => {
      const progress = vi.fn();
      const { promise, request } = await transfer(progress);
      const rejected = expect(promise).rejects.toThrow("upload_failed");
      request[event]?.();
      await rejected;
      expect(progress).not.toHaveBeenCalledWith(100);
    },
  );

  it("surfaces server quarantine rejection and treats malformed responses as failures", async () => {
    let pending = await transfer();
    let rejected = expect(pending.promise).rejects.toThrow("quarantined");
    pending.request.respond(422, { error: "quarantined" });
    await rejected;
    Request.requests = [];
    pending = await transfer();
    rejected = expect(pending.promise).rejects.toThrow("upload_failed");
    pending.request.status = 200;
    pending.request.responseText = "not JSON";
    pending.request.onload?.();
    await rejected;
  });

  it.each([0, maximumFileSize + 1])(
    "rejects size %s before authentication or transmission",
    async (size) => {
      const invalid = file();
      Object.defineProperty(invalid, "size", { value: size });
      await expect(
        uploadDocument(invalid, { scope: "personal" }),
      ).rejects.toThrow("file_size");
      expect(auth.getSession).not.toHaveBeenCalled();
      expect(Request.requests).toHaveLength(0);
    },
  );

  it("blocks offline bytes before contacting Auth or the file endpoint", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(uploadDocument(file(), { scope: "personal" })).rejects.toThrow(
      "offline",
    );
    await expect(downloadDocument("fictional-file")).rejects.toThrow("offline");
    await expect(
      saveQualificationEvidence("fictional-binding", "Proof.txt"),
    ).rejects.toThrow("offline");
    expect(auth.getSession).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(Request.requests).toHaveLength(0);
  });

  it.each([null, new Error("fictional Auth transport failure")])(
    "rejects a missing/failed session without sending private bytes",
    async (error) => {
      auth.getSession.mockResolvedValue({ data: { session: null }, error });
      await expect(
        uploadDocument(file(), { scope: "personal" }),
      ).rejects.toThrow("authentication_required");
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      await expect(
        saveQualificationEvidence("fictional-binding", "Proof.txt"),
      ).rejects.toThrow("authentication_required");
      expect(fetch).not.toHaveBeenCalled();
      expect(Request.requests).toHaveLength(0);
    },
  );

  it("does not fetch private bytes when a preview is aborted during Auth lookup", async () => {
    const session = {
      data: {
        session: {
          access_token: "fictional-access-token",
          user: { id: "fictional-actor" },
        },
      },
      error: null,
    };
    let finishAuth!: (value: typeof session) => void;
    auth.getSession.mockImplementation(
      () => new Promise((resolve) => (finishAuth = resolve)),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const pending = downloadDocument(
      "fictional-file",
      "reviewed-version",
      controller.signal,
    );

    await vi.waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce());
    controller.abort();
    finishAuth(session);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not save a company PDF when cancellation arrives during the final Auth check", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("Fictional company contract bytes."));
    vi.stubGlobal("fetch", fetch);
    let finishFinalAuth!: (value: {
      data: { session: { user: { id: string } } };
      error: null;
    }) => void;
    auth.getSession
      .mockResolvedValueOnce({
        data: {
          session: {
            access_token: "fictional-access-token",
            user: { id: "fictional-actor" },
          },
        },
        error: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFinalAuth = resolve;
          }),
      );
    const create = vi.fn(() => "blob:should-not-be-saved");
    class DownloadURL extends URL {
      static createObjectURL = create;
    }
    vi.stubGlobal("URL", DownloadURL);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const controller = new AbortController();
    const pending = saveOrganisationContract(
      "fictional-company",
      "fictional-contract",
      "Agreement.pdf",
      controller.signal,
    );

    await vi.waitFor(() => expect(auth.getSession).toHaveBeenCalledTimes(2));
    controller.abort();
    finishFinalAuth({
      data: { session: { user: { id: "fictional-actor" } } },
      error: null,
    });

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(create).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  it("fetches the reviewed exact version without caching private response bytes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response("fictional reviewed bytes"));
    vi.stubGlobal("fetch", fetch);
    const blob = await downloadDocument("fictional-file", "reviewed-version");
    expect(await blob.text()).toBe("fictional reviewed bytes");
    expect(fetch).toHaveBeenCalledWith(
      "https://fictional.example.invalid/backend/functions/v1/files",
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        body: JSON.stringify({
          action: "download",
          id: "fictional-file",
          version_id: "reviewed-version",
        }),
        headers: {
          Authorization: "Bearer fictional-access-token",
          apikey: "sb_publishable_fictional",
          "Content-Type": "application/json",
        },
      }),
    );
  });

  it.each([
    new Response(JSON.stringify({ error: "document_forbidden" }), {
      status: 403,
    }),
    new Response("upstream unavailable", { status: 502 }),
  ])(
    "never resolves error pages as private document bytes",
    async (response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(downloadDocument("fictional-file")).rejects.toThrow(
        response.status === 403 ? "document_forbidden" : "download_failed",
      );
    },
  );

  it("keeps the expense and reviewed version in a receipt download", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "access_denied" }), {
          status: 403,
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      saveExpenseReceipt("expense-id", "reviewed-version", "Receipt.pdf"),
    ).rejects.toThrow("access_denied");
    expect(fetch).toHaveBeenCalledWith(
      "https://fictional.example.invalid/backend/functions/v1/files",
      expect.objectContaining({
        cache: "no-store",
        body: JSON.stringify({
          action: "expense_receipt_download",
          expense_id: "expense-id",
          version_id: "reviewed-version",
        }),
      }),
    );
  });

  it.each(["document", "qualification", "company contract"] as const)(
    "saves %s only after authenticated bytes arrive, pins its gateway identity and releases its Blob URL",
    async (kind) => {
      vi.useFakeTimers();
      let complete!: (response: Response) => void;
      const response = new Promise<Response>((resolve) => {
        complete = resolve;
      });
      const fetch = vi.fn().mockReturnValue(response);
      vi.stubGlobal("fetch", fetch);
      const create = vi.fn<(blob: Blob) => string>(
        () => "blob:fictional-reviewed-download",
      );
      const revoke = vi.fn();

      class DownloadURL extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      }

      vi.stubGlobal("URL", DownloadURL);
      const anchor = document.createElement("a");
      const click = vi.spyOn(anchor, "click").mockImplementation(() => {});
      const element = vi
        .spyOn(document, "createElement")
        .mockReturnValue(anchor);
      auth.getSession.mockResolvedValue({
        data: {
          session: {
            access_token: "fictional-refreshed-token",
            user: { id: "fictional-actor" },
          },
        },
        error: null,
      });
      const name = "Reviewed original V1.txt";
      const saved =
        kind === "document"
          ? saveDownload("fictional-document", name, "reviewed-version")
          : kind === "qualification"
            ? saveQualificationEvidence("fictional-topic-binding", name)
            : saveOrganisationContract(
                "fictional-company",
                "fictional-document",
                name,
              );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      expect(element).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith(
        "https://fictional.example.invalid/backend/functions/v1/files",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer fictional-refreshed-token",
            apikey: "sb_publishable_fictional",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            kind === "document"
              ? {
                  action: "download",
                  id: "fictional-document",
                  version_id: "reviewed-version",
                }
              : kind === "qualification"
                ? {
                    action: "qualification_evidence_download",
                    evidence_id: "fictional-topic-binding",
                  }
                : {
                    action: "organisation_contract_download",
                    organisation_id: "fictional-company",
                    id: "fictional-document",
                  },
          ),
          cache: "no-store",
        },
      );
      // Token rotation for the initiating account must not discard the download.
      auth.getSession.mockResolvedValue({
        data: {
          session: {
            access_token: "fictional-rotated-token",
            user: { id: "fictional-actor" },
          },
        },
        error: null,
      });
      complete(new Response("Fictional original reviewed bytes."));
      await saved;
      expect(create).toHaveBeenCalledOnce();
      const blob = create.mock.calls[0][0];
      expect(await blob.text()).toBe("Fictional original reviewed bytes.");
      expect(element).toHaveBeenCalledExactlyOnceWith("a");
      expect(anchor.href).toBe("blob:fictional-reviewed-download");
      expect(anchor.download).toBe(name);
      expect(anchor.rel).toBe("noopener");
      expect(click).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(999);
      expect(revoke).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(revoke).toHaveBeenCalledExactlyOnceWith(
        "blob:fictional-reviewed-download",
      );
    },
  );

  it.each([
    [
      "file preview",
      () => downloadDocument("fictional-file", "reviewed-version"),
    ],
    ["file download", () => saveDownload("fictional-file", "Private.txt")],
    [
      "qualification download",
      () => saveQualificationEvidence("fictional-binding", "Proof.txt"),
    ],
  ] as const)(
    "discards a delayed %s after the active account changes",
    async (_, transfer) => {
      let complete!: (response: Response) => void;
      const fetch = vi.fn().mockReturnValue(
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const create = vi.fn(() => "blob:previous-account");
      vi.stubGlobal(
        "URL",
        class extends URL {
          static createObjectURL = create;
          static revokeObjectURL = vi.fn();
        },
      );
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      const pending = transfer();
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      auth.getSession.mockResolvedValue({
        data: {
          session: { access_token: "next-token", user: { id: "next-actor" } },
        },
        error: null,
      });
      complete(new Response("Previous account's fictional private bytes"));

      await expect(pending).rejects.toThrow("account_changed");
      expect(create).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    },
  );

  it.each([
    [403, JSON.stringify({ error: "access_denied" }), "access_denied"],
    [503, JSON.stringify({}), "download_failed"],
    [502, "upstream unavailable", "download_failed"],
  ])(
    "never saves rejected qualification bytes for HTTP%s",
    async (status, body, code) => {
      const create = vi.fn();

      class DownloadURL extends URL {
        static createObjectURL = create;
      }

      vi.stubGlobal("URL", DownloadURL);
      const click = vi
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(body, { status })),
      );
      await expect(
        saveQualificationEvidence("fictional-topic-binding", "Proof.txt"),
      ).rejects.toThrow(code);
      expect(create).not.toHaveBeenCalled();
      expect(click).not.toHaveBeenCalled();
    },
  );

  it("keeps a failed qualification transfer retryable without creating or saving partial private bytes", async () => {
    const failure = new Error("fictional transport interrupted");
    const fetch = vi.fn().mockRejectedValue(failure);
    vi.stubGlobal("fetch", fetch);
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await expect(
      saveQualificationEvidence("fictional-topic-binding", "Proof.txt"),
    ).rejects.toBe(failure);
    expect(click).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
