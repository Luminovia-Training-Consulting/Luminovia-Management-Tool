/**
 * Regressions for browser transfer completion, scan state, Auth/network failures and exact
 * versions. Controlled transport does not replace real RLS/Auth/Storage/browser acceptance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadDocument, maximumFileSize, uploadDocument } from "./api";

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ auth }),
}));

// Controlled browser transport only. Real scanning/Storage permissions remain
// covered by the isolated HTTP/SQL suites, not this client-side fixture.
/** Controlled XMLHttpRequest fixture exposing headers, progress and completion events. */
class Request {
  static requests: Request[] = [];
  constructor() {
    Request.requests.push(this);
  }
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
    data: { session: { access_token: "fictional-access-token" } },
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
      expect(Request.requests).toHaveLength(0);
    },
  );

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
});
