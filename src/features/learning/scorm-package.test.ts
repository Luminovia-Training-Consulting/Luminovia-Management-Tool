/** Verify the parser on actual ZIP bytes and sanitized, unlinked SCORM 1.2 metadata. */
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  scormFixtureManifest,
  scormFixtureZip,
} from "../../../scripts/testing/scorm-fixture.ts";
import { reviewScormPackage, scormPackageMaxBytes } from "./scorm-package";

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

const append = (
  manifest = scormFixtureManifest,
  extra: readonly (readonly [string, string])[] = [],
) =>
  scormFixtureZip([
    ["imsmanifest.xml", manifest],
    ["course/learner page.html", "<p>Fictional course file</p>"],
    ["course/example.css", "body { color: blue; }"],
    ...extra,
  ]);

it("checks the CRC, safe percent-encoded resource path and exact archived byte fingerprint", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const bytes = await scormFixtureZip();
  const review = await reviewScormPackage(bytes);
  expect(review).toMatchObject({
    files: 3,
    sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
    organisation: "Fictional package",
    launches: [
      {
        id: "lesson",
        title: "Exercise <summary>",
        path: "course/learner page.html",
      },
    ],
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("refuses oversized bundles, over 512 entries, and expansions above the ratio cap", async () => {
  await expect(
    reviewScormPackage(new ArrayBuffer(scormPackageMaxBytes + 1)),
  ).rejects.toMatchObject({ code: "file_size" });
  const entries = Array.from({ length: 510 }, (_, index): [string, string] => [
    "data/f" + index + ".txt",
    "",
  ]);
  await expect(
    reviewScormPackage(await append(scormFixtureManifest, entries)),
  ).rejects.toMatchObject({ code: "archive_limits" });
  await expect(
    reviewScormPackage(
      await append(scormFixtureManifest, [["big.txt", "x".repeat(160_000)]]),
    ),
  ).rejects.toMatchObject({ code: "archive_limits" });
});

it("refuses conflicting file or directory paths and nested ZIP file names", async () => {
  for (const entry of [
    ["course/EXAMPLE.css", "collision"],
    ["COURSE/other.css", "implicit folder case collision"],
    ["course", "also a file"],
    ["assets/extra.zip", "inert fixture"],
  ] as const) {
    await expect(
      reviewScormPackage(await append(scormFixtureManifest, [entry])),
    ).rejects.toMatchObject({ code: "unsafe_paths" });
  }
});

it("does not treat symbolic links as packaged files", async () => {
  const archive = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
    zip64: false,
  });
  await archive.add("imsmanifest.xml", new TextReader(scormFixtureManifest));
  await archive.add(
    "course/linked.html",
    new TextReader("fictional-target.html"),
    { unixMode: 0o120777 },
  );
  await expect(
    reviewScormPackage(Uint8Array.from(await archive.close()).buffer),
  ).rejects.toMatchObject({ code: "unsafe_paths" });
});

it("requires an ADL 1.2 namespaced manifest at the root and bars remote references and DTDs", async () => {
  await expect(
    reviewScormPackage(
      await scormFixtureZip([["folder/imsmanifest.xml", scormFixtureManifest]]),
    ),
  ).rejects.toMatchObject({ code: "invalid_manifest" });
  await expect(
    reviewScormPackage(
      await append(
        scormFixtureManifest.replace(
          "<schemaversion>1.2",
          "<schemaversion>2004",
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "unsupported_manifest" });
  await expect(
    reviewScormPackage(
      await append(
        scormFixtureManifest.replace(
          "<manifest ",
          "<!DOCTYPE manifest><manifest ",
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "unsupported_manifest" });
  await expect(
    reviewScormPackage(
      await append(
        scormFixtureManifest.replace(
          "learner%20page.html?mode=lesson",
          "https://remote.example.invalid/lesson.htm",
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "unsafe_paths" });
  await expect(
    reviewScormPackage(
      await append(
        scormFixtureManifest.replace(
          "learner%20page.html?mode=lesson",
          "empty%2Fpath.html",
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "unsafe_paths" });
});

it("requires complete declared files and an acyclic dependency graph", async () => {
  await expect(
    reviewScormPackage(
      await append(scormFixtureManifest.replace("example.css", "absent.css")),
    ),
  ).rejects.toMatchObject({ code: "missing_resources" });
  await expect(
    reviewScormPackage(
      await append(
        scormFixtureManifest.replace(
          '<file href="example.css"/></resource>',
          '<file href="example.css"/><dependency identifierref="sco"/></resource>',
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "invalid_manifest" });
  await expect(
    reviewScormPackage(
      await append(
        scormFixtureManifest.replace(
          'identifierref="asset"',
          'identifierref="absent"',
        ),
      ),
    ),
  ).rejects.toMatchObject({ code: "missing_resources" });
});

it("rejects a damaged stored file without yielding launch metadata", async () => {
  const marker = "UNIQUE SCORM RESOURCE";
  const bytes = await scormFixtureZip(
    [
      ["imsmanifest.xml", scormFixtureManifest],
      ["course/learner page.html", marker],
      ["course/example.css", "body {}"],
    ],
    { level: 0 },
  );
  const raw = new Uint8Array(bytes);
  const needle = new TextEncoder().encode(marker);
  const offset = raw.findIndex((_, index) =>
    needle.every((value, position) => raw[index + position] === value),
  );
  expect(offset).toBeGreaterThan(0);
  raw[offset] ^= 1;
  await expect(reviewScormPackage(bytes)).rejects.toMatchObject({
    code: "invalid_archive",
  });
});

it("honors cancellation at the start of the local review", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    reviewScormPackage(await scormFixtureZip(), controller.signal),
  ).rejects.toHaveProperty("name", "AbortError");
});
