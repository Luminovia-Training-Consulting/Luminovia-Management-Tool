/** Exercise real ZIP fixtures built from the reviewed H5P package and interaction definitions. */
import { webcrypto } from "node:crypto";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readH5pPackage } from "./h5p-import";

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
  const imported = await readH5pPackage(file);
  expect(imported.package_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(imported).toMatchObject({
    question: {
      prompt: "Was zeigt ls an?",
      options: ["Verzeichnisinhalt", "Arbeitsverzeichnis"],
      correct: 0,
    },
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
  expect(await readH5pPackage(file)).toMatchObject({
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
  await expect(readH5pPackage(file)).rejects.toMatchObject({
    reason: "license",
  });
});

it("rejects choices that cannot preserve single-answer scoring and content media", async () => {
  const first = await packageFile(multipleChoice, {
    ...item,
    behaviour: { type: "multi" },
  });
  await expect(readH5pPackage(first)).rejects.toMatchObject({
    reason: "question",
  });
  const second = await packageFile(multipleChoice, item, {
    "content/images/image.png": "sample",
  });
  await expect(readH5pPackage(second)).rejects.toMatchObject({
    reason: "question",
  });
});

it("rejects noncanonical duplicate archive members", async () => {
  const file = await packageFile(multipleChoice, item, { "H5P.JSON": "{}" });
  await expect(readH5pPackage(file)).rejects.toMatchObject({
    reason: "archive",
  });
});

it("enforces the JSON byte limit against a real ZIP entry", async () => {
  const file = await packageFile(multipleChoice, {
    ...item,
    question: "x".repeat(120_000),
  });
  await expect(readH5pPackage(file)).rejects.toMatchObject({
    reason: "archive",
  });
});

const choiceSetManifest = {
  ...multipleChoice,
  mainLibrary: "H5P.SingleChoiceSet",
  preloadedDependencies: [
    { machineName: "H5P.SingleChoiceSet", majorVersion: 1, minorVersion: 11 },
  ],
};
const choiceSetItems = [
  {
    question: "<p>Wofür steht pwd?</p>",
    answers: ["Arbeitsverzeichnis", "Dateiliste"],
  },
  {
    question: "Welcher Befehl zeigt die ersten Zeilen?",
    answers: ["head", "tail", "pwd"],
  },
];
const quizSetManifest = {
  ...multipleChoice,
  mainLibrary: "H5P.QuestionSet",
  preloadedDependencies: [
    { machineName: "H5P.QuestionSet", majorVersion: 1, minorVersion: 21 },
    ...multipleChoice.preloadedDependencies,
    { machineName: "H5P.TrueFalse", majorVersion: 1, minorVersion: 8 },
  ],
};
const embedded = {
  library: "H5P.TrueFalse 1.8",
  params: { question: "Die Datei enthält Text.", correct: "true" },
  metadata: {
    title: "Included exercise",
    language: "en",
    license: "CC BY",
    licenseVersion: "4.0",
    authors: [{ name: "Fictional embedded author", role: "Author" }],
  },
};

it("converts ordered SingleChoiceSet alternatives with the first answer correct", async () => {
  const file = await packageFile(choiceSetManifest, {
    choices: choiceSetItems,
  });
  const result = await readH5pPackage(file);
  expect(result).toMatchObject({
    attribution: { library: "H5P.SingleChoiceSet 1.11" },
    questions: choiceSetItems.map(({ question, answers }) => ({
      library: "H5P.SingleChoiceSet 1.11",
      subcontent: null,
      question: {
        prompt: question.replace(/<\/?p>/g, ""),
        options: answers,
        correct: 0,
      },
    })),
  });
});

it("converts native QuestionSet items and retains individually declared authors", async () => {
  const file = await packageFile(quizSetManifest, {
    questions: [{ library: "H5P.MultiChoice 1.16", params: item }, embedded],
  });
  expect(await readH5pPackage(file)).toMatchObject({
    attribution: {
      library: "H5P.QuestionSet 1.21",
      authors: multipleChoice.authors,
    },
    questions: [
      {
        library: "H5P.MultiChoice 1.16",
        question: { correct: 0 },
        subcontent: null,
      },
      {
        library: "H5P.TrueFalse 1.8",
        question: { options: ["True", "False"] },
        subcontent: {
          title: embedded.metadata.title,
          library: embedded.library,
          authors: embedded.metadata.authors,
        },
      },
    ],
  });
});

it("rejects an entire collection that has media, duplicate or unsupported answers", async () => {
  for (const bad of [
    {
      ...embedded,
      params: {
        ...embedded.params,
        media: { type: { library: "H5P.Video 1.6" } },
      },
    },
    { ...embedded, library: "H5P.Essay 1.5" },
    {
      library: "H5P.MultiChoice 1.16",
      params: {
        ...item,
        answers: [
          { text: "Repeat", correct: true },
          { text: "repeat", correct: false },
        ],
      },
    },
  ]) {
    const archive = await packageFile(quizSetManifest, {
      questions: [embedded, bad],
    });
    await expect(readH5pPackage(archive)).rejects.toMatchObject({
      reason: "question",
    });
  }
});

it("rejects undeclared inner dependencies, unknown child licences and oversized sets", async () => {
  const undeclared = await packageFile(
    {
      ...quizSetManifest,
      preloadedDependencies: quizSetManifest.preloadedDependencies.slice(0, 2),
    },
    { questions: [embedded] },
  );
  await expect(readH5pPackage(undeclared)).rejects.toMatchObject({
    reason: "question",
  });
  const restrictive = await packageFile(quizSetManifest, {
    questions: [
      { ...embedded, metadata: { ...embedded.metadata, license: "U" } },
    ],
  });
  await expect(readH5pPackage(restrictive)).rejects.toMatchObject({
    reason: "license",
  });
  const tooMany = await packageFile(choiceSetManifest, {
    choices: Array.from({ length: 21 }, () => choiceSetItems[0]),
  });
  await expect(readH5pPackage(tooMany)).rejects.toMatchObject({
    reason: "question",
  });
});
