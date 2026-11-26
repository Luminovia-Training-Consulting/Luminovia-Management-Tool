/** Exercise real ZIP fixtures built from the reviewed H5P package and interaction definitions. */
import { webcrypto } from "node:crypto";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readH5pQuestion } from "./h5p-import";

const multipleChoice = {
  title: "Dateien im Verzeichnis",
  mainLibrary: "H5P.MultiChoice",
  language: "de",
  embedTypes: ["iframe"],
  preloadedDependencies: [
    { machineName: "H5P.MultiChoice", majorVersion: "1", minorVersion: 16 },
  ],
  license: "CC BY",
  licenseVersion: "4.0",
  authors: [{ name: "Fictional author", role: "Author" }],
  source: "https://example.invalid/lesson",
  licenseExtras: "Retain the author credit.",
  changes: [
    {
      author: "Fictional editor",
      date: "2026-11-26",
      log: "Corrected terminology",
    },
  ],
};

const item = {
  question: "<p>Was zeigt <code>ls</code> an?</p>",
  answers: [
    { text: "<strong>Verzeichnisinhalt</strong>", correct: true },
    { text: "Arbeitsverzeichnis", correct: false },
  ],
  behaviour: { type: "single" },
};

/** Include representative library members without ever loading them as code. */
async function packageFile(
  manifest: object,
  content: object,
  extras: Record<string, string> = {},
) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  await writer.add("h5p.json", new TextReader(JSON.stringify(manifest)));
  await writer.add(
    "content/content.json",
    new TextReader(JSON.stringify(content)),
  );
  for (const [path, source] of Object.entries(extras)) {
    await writer.add(path, new TextReader(source));
  }
  const bytes = await writer.close();
  return {
    name: "question.h5p",
    size: bytes.byteLength,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as File;
}

beforeEach(() => vi.stubGlobal("crypto", webcrypto));
afterEach(() => vi.unstubAllGlobals());

it("maps an H5P.MultiChoice question and retains declared attribution", async () => {
  const file = await packageFile(multipleChoice, item, {
    "H5P.MultiChoice-1.16/js/multichoice.js":
      "globalThis.sampleH5pCodeWasLoaded = true;",
  });
  const imported = await readH5pQuestion(file);
  expect(imported.package_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(imported.question).toEqual({
    prompt: "Was zeigt ls an?",
    options: ["Verzeichnisinhalt", "Arbeitsverzeichnis"],
    correct: 0,
  });
  expect(imported.attribution).toMatchObject({
    license: "CC-BY-4.0",
    authors: multipleChoice.authors,
    source_url: multipleChoice.source,
    license_notice: multipleChoice.licenseExtras,
    changes: multipleChoice.changes,
  });
  expect(globalThis).not.toHaveProperty("sampleH5pCodeWasLoaded");
});

it("uses the H5P.TrueFalse translated labels and original answer index", async () => {
  const file = await packageFile(
    {
      ...multipleChoice,
      mainLibrary: "H5P.TrueFalse",
      license: "PD",
      licenseVersion: "CC0 1.0",
      preloadedDependencies: [
        { machineName: "H5P.TrueFalse", majorVersion: 1, minorVersion: 8 },
      ],
    },
    {
      question: "<p>Ein Filter verändert&nbsp;die Datei.</p>",
      correct: "false",
      l10n: {
        trueText: "Stimmt",
        falseText: "Stimmt nicht",
      },
    },
  );
  expect(await readH5pQuestion(file)).toMatchObject({
    attribution: { license: "CC0-1.0", library: "H5P.TrueFalse 1.8" },
    question: {
      prompt: "Ein Filter verändert die Datei.",
      options: ["Stimmt", "Stimmt nicht"],
      correct: 1,
    },
  });
});

it.each([
  { license: undefined },
  { license: "CC BY-ND" },
  { licenseVersion: "3.0" },
  { authors: [] },
])("rejects unknown or incomplete licence data %j", async (change) => {
  const file = await packageFile({ ...multipleChoice, ...change }, item);
  await expect(readH5pQuestion(file)).rejects.toMatchObject({
    reason: "license",
  });
});

it("rejects choices that cannot preserve single-answer scoring and content media", async () => {
  const first = await packageFile(multipleChoice, {
    ...item,
    behaviour: { type: "multi" },
  });
  await expect(readH5pQuestion(first)).rejects.toMatchObject({
    reason: "question",
  });
  const second = await packageFile(multipleChoice, item, {
    "content/images/image.png": "sample",
  });
  await expect(readH5pQuestion(second)).rejects.toMatchObject({
    reason: "question",
  });
});

it("rejects noncanonical duplicate archive members", async () => {
  const file = await packageFile(multipleChoice, item, { "H5P.JSON": "{}" });
  await expect(readH5pQuestion(file)).rejects.toMatchObject({
    reason: "archive",
  });
});

it("enforces the JSON byte limit against a real ZIP entry", async () => {
  const file = await packageFile(multipleChoice, {
    ...item,
    question: "x".repeat(120_000),
  });
  await expect(readH5pQuestion(file)).rejects.toMatchObject({
    reason: "archive",
  });
});
