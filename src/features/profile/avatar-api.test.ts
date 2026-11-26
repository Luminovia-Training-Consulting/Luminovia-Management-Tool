/**
 * Regressions for encoded image dimensions and bounded browser preparation. Byte/DOM fixtures do
 * not replace actual avatar scanning and access checks.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const { auth } = vi.hoisted(() => ({
  auth: { getSession: vi.fn() },
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ auth }) }));
vi.mock("../../lib/online", () => ({ requireOnline: vi.fn() }));
import { prepareAvatar, readAvatar, sourceImageSize } from "./avatar-api";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("bounded source decoding", () => {
  it("rejects 1 MB before decoding and inspects images below that limit", async () => {
    const oversized = new File([new Uint8Array(1_000_000)], "image.png", {
      type: "image/png",
    });
    const read = vi.spyOn(oversized, "arrayBuffer");
    await expect(prepareAvatar(oversized)).rejects.toThrow(
      "avatar_file_too_large",
    );
    expect(read).not.toHaveBeenCalled();
    const below = new File([new Uint8Array(999_999)], "image.png", {
      type: "image/png",
    });
    const readBelow = vi
      .spyOn(below, "arrayBuffer")
      .mockResolvedValue(new ArrayBuffer(1));
    await expect(prepareAvatar(below)).rejects.toThrow("avatar_image_invalid");
    expect(readBelow).toHaveBeenCalledOnce();
  });
  it("recognises actual PNG, JPEG and lossy/lossless WebP dimensions before decoding", async () => {
    const image = sharp({
      create: { width: 16, height: 8, channels: 4, background: "blue" },
    });
    for (const [mime, bytes] of [
      ["image/png", await image.clone().png().toBuffer()],
      ["image/jpeg", await image.clone().jpeg().toBuffer()],
      ["image/webp", await image.clone().webp().toBuffer()],
      ["image/webp", await image.clone().webp({ lossless: true }).toBuffer()],
    ] as const)
      expect(sourceImageSize(bytes, mime)).toEqual([16, 8]);
  });
  it("rejects unknown formats, MIME disagreement, truncated JPEG and pixel-budget bombs", () => {
    expect(() =>
      sourceImageSize(new TextEncoder().encode("<svg>"), "image/svg+xml"),
    ).toThrow("avatar_image_invalid");
    expect(() =>
      sourceImageSize(new Uint8Array([255, 216, 255]), "image/jpeg"),
    ).toThrow("avatar_image_invalid");
    const png = new Uint8Array(24),
      view = new DataView(png.buffer);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    view.setUint32(16, 5000);
    view.setUint32(20, 5000);
    expect(() => sourceImageSize(png, "image/png")).toThrow(
      "avatar_image_invalid",
    );
    expect(() => sourceImageSize(png, "image/jpeg")).toThrow(
      "avatar_image_invalid",
    );
  });
});

describe("version-bound avatar transport", () => {
  const session = {
    data: {
      session: {
        access_token: "fictional-token",
        user: { id: "fictional-actor" },
      },
    },
    error: null,
  };

  it("sends the selected version and verifies the server confirmation before reading bytes", async () => {
    auth.getSession.mockResolvedValue(session);
    const response = new Response("fictional image", {
      headers: {
        "Content-Type": "image/png",
        "X-Avatar-Version": "selected-version",
      },
    });
    const readBody = vi
      .spyOn(response, "blob")
      .mockResolvedValue(new Blob(["fictional image"], { type: "image/png" }));
    const fetch = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetch);

    await expect(
      readAvatar(
        "fictional-target",
        "selected-version",
        new AbortController().signal,
      ),
    ).resolves.toBeInstanceOf(Blob);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      action: "avatar",
      user_id: "fictional-target",
      version_id: "selected-version",
    });
    expect(readBody).toHaveBeenCalledOnce();
  });

  it("rejects a mismatched server version before reading the response body", async () => {
    auth.getSession.mockResolvedValue(session);
    const response = new Response("wrong image", {
      headers: {
        "Content-Type": "image/png",
        "X-Avatar-Version": "newer-version",
      },
    });
    const readBody = vi
      .spyOn(response, "blob")
      .mockResolvedValue(new Blob(["fictional image"], { type: "image/png" }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(
      readAvatar(
        "fictional-target",
        "selected-version",
        new AbortController().signal,
      ),
    ).rejects.toThrow("avatar_unavailable");
    expect(readBody).not.toHaveBeenCalled();
  });

  it("does not start a request if the preview is aborted during Auth lookup", async () => {
    let finishAuth!: (value: typeof session) => void;
    auth.getSession.mockImplementation(
      () => new Promise((resolve) => (finishAuth = resolve)),
    );
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const pending = readAvatar(
      "fictional-target",
      "selected-version",
      controller.signal,
    );

    await vi.waitFor(() => expect(auth.getSession).toHaveBeenCalledOnce());
    controller.abort();
    finishAuth(session);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
