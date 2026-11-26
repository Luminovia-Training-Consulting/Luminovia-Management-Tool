/** Playback accepts exact data for pinned player families and keeps package code outside the portal. */
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readH5pPlayback } from "./h5p-runtime-package";

const manifest = {
  title: " Fictional H5P activity ",
  mainLibrary: "H5P.TrueFalse",
  preloadedDependencies: [
    { machineName: "H5P.TrueFalse", majorVersion: 1, minorVersion: 8 },
  ],
};
const content = '{"question":"<p>Does the label match?</p>","correct":true}';

async function archive(
  header: Record<string, unknown> = manifest,
  extra: [string, string][] = [],
) {
  const files = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    level: 0,
  });
  for (const [name, contents] of [
    ["h5p.json", JSON.stringify(header)],
    ["content/content.json", content],
    ...extra,
  ]) {
    await files.add(name, new TextReader(contents));
  }
  return new Blob([Buffer.from(await files.close())]);
}

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

it("hashes the exact archive and hands off only vetted JSON and path-bounded media", async () => {
  const file = await archive(manifest, [
    ["content/images/figure.png", "fictional PNG bytes"],
    ["content/images/figure.svg", "ignored SVG"],
    ["content/app.js", "ignored JavaScript"],
    ["other/file.png", "outside the playback directory"],
    ["H5P.TrueFalse-1.8/js/h5p-true-false.js", "ignored package script"],
  ]);
  const result = await readH5pPlayback(file);
  expect(result.title).toBe("Fictional H5P activity");
  expect(result.sha256).toBe(
    createHash("sha256")
      .update(Buffer.from(await file.arrayBuffer()))
      .digest("hex"),
  );
  expect(result.assets.map(({ path }) => path)).toEqual([
    "h5p.json",
    "content/content.json",
    "content/images/figure.png",
  ]);
  expect(new TextDecoder().decode(result.assets[1].bytes)).toBe(content);
});

it("rejects uninstalled versions and repurposing a dependency as the activity type", async () => {
  for (const [machineName, minorVersion] of [
    ["H5P.TrueFalse", 9],
    ["H5P.Image", 1],
  ]) {
    const file = await archive({
      ...manifest,
      mainLibrary: machineName,
      preloadedDependencies: [{ machineName, majorVersion: 1, minorVersion }],
    });
    await expect(readH5pPlayback(file)).rejects.toThrow(
      "h5p_unavailable_library",
    );
  }
});

it("rejects case-folded collisions, oversized data and cancelled reviews", async () => {
  const collision = await archive(manifest, [
    ["content/figure.png", "first"],
    ["content/FIGURE.png", "second"],
  ]);
  await expect(readH5pPlayback(collision)).rejects.toThrow(
    "h5p_duplicate_files",
  );
  const traversal = await archive(manifest, [
    ["content/../file.png", "outside the playback directory"],
  ]);
  await expect(readH5pPlayback(traversal)).rejects.toThrow("Unsafe filename");
  await expect(
    readH5pPlayback(new Blob([new Uint8Array(11 * 1024 * 1024)])),
  ).rejects.toThrow("h5p_archive_size");
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(readH5pPlayback(collision, cancelled.signal)).rejects.toThrow();
});
