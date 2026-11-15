import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { sourceImageSize } from "./avatar-api";

describe("bounded source decoding", () => {
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
