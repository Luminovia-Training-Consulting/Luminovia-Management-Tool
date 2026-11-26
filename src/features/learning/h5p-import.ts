/** Read only the two JSON members needed to convert a reviewed H5P question. */
import { Uint8ArrayReader, ZipReader, type FileEntry } from "@zip.js/zip.js";
import { z } from "zod";
import {
  consumePackageEntry,
  coursePackageDigest,
} from "./course-package-archive";
import { objectiveQuestionInput } from "./question-bank-schema";
import {
  h5pAttributionSchema,
  h5pCollectionImportSchema,
  h5pCollectionLibraries,
  h5pCollectionLimit,
  h5pQuestionImportSchema,
  h5pSimpleLibraries,
  h5pCollectionItemSchema,
  type H5pCollectionItem,
  type H5pImport,
} from "./h5p-import-schema";

const maxPackageSize = 8 * 1024 * 1024;
const maxJsonSize = 96 * 1024;
const maxEntries = 2048;
const packagePaths = ["h5p.json", "content/content.json"] as const;
const supportedRoles = ["Author", "Editor", "Licensee", "Originator"] as const;

const dependencyVersion = z.union([
  z.number().int().nonnegative(),
  z
    .string()
    .regex(/^\d{1,4}$/)
    .transform(Number),
]);
const manifest = z.object({
  title: z.string(),
  mainLibrary: z.string(),
  language: z.string().regex(/^([a-z]{2}|und)$/),
  preloadedDependencies: z
    .array(
      z.object({
        machineName: z.string(),
        majorVersion: dependencyVersion,
        minorVersion: dependencyVersion,
      }),
    )
    .min(1)
    .max(100),
  embedTypes: z
    .array(z.enum(["div", "iframe"]))
    .min(1)
    .max(2),
  license: z.string().optional(),
  licenseVersion: z.string().optional(),
  licenseExtras: z.string().optional(),
  author: z.string().optional(),
  authors: z
    .array(
      z.object({
        name: z.string(),
        role: z.enum(supportedRoles),
      }),
    )
    .max(10)
    .optional(),
  source: z.string().optional(),
  changes: z
    .array(
      z.object({
        date: z.string(),
        author: z.string(),
        log: z.string(),
      }),
    )
    .max(10)
    .optional(),
});
const question = z.object({
  question: z.string(),
  media: z.object({ type: z.unknown().optional() }).optional(),
});
const multiChoice = question.extend({
  answers: z
    .array(z.object({ text: z.string(), correct: z.boolean() }))
    .min(2)
    .max(6),
  behaviour: z
    .object({ type: z.enum(["auto", "single", "multi"]).optional() })
    .optional(),
});
const trueFalse = question.extend({
  correct: z.enum(["true", "false"]),
  l10n: z
    .object({
      trueText: z.string().optional(),
      falseText: z.string().optional(),
    })
    .optional(),
});

const choiceSet = z.object({
  choices: z
    .array(
      z.object({
        question: z.string(),
        answers: z.array(z.string()).min(2).max(4),
      }),
    )
    .min(1)
    .max(h5pCollectionLimit),
});
const containedAttribution = manifest
  .pick({
    title: true,
    language: true,
    license: true,
    licenseVersion: true,
    licenseExtras: true,
    author: true,
    authors: true,
    source: true,
    changes: true,
  })
  .partial();
const questionSet = z.object({
  questions: z
    .array(
      z.object({
        library: z.enum(["H5P.MultiChoice 1.16", "H5P.TrueFalse 1.8"]),
        params: z.unknown(),
        metadata: containedAttribution.optional(),
      }),
    )
    .min(1)
    .max(h5pCollectionLimit),
});

export class H5pImportError extends Error {
  constructor(readonly reason: "archive" | "question" | "license") {
    super(reason);
  }
}

/** Enforce the actual byte length as well as the archive's declared size. */
async function readJson(entry: FileEntry | undefined): Promise<unknown> {
  if (
    !entry ||
    entry.uncompressedSize < 1 ||
    entry.uncompressedSize > maxJsonSize ||
    ![0, 8].includes(entry.compressionMethod)
  )
    throw new H5pImportError("archive");
  const bytes = new Uint8Array(entry.uncompressedSize);
  await consumePackageEntry(entry, bytes);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

const entities: Readonly<Record<string, string>> = {
  amp: "&",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lt: "<",
  gt: ">",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  minus: "−",
};

const isControlCharacter = (character: string) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127;
};

/** Treat ordinary editor formatting as text. Never construct a DOM from uploaded content. */
function plainText(input: string) {
  const unformatted = input
    .replace(/<\/?(?:p|h2|h3|br)\s*\/?>/gi, " ")
    .replace(/<\/?(?:strong|em|b|i|code)\s*>/gi, "");
  if (unformatted.includes("<")) throw new H5pImportError("question");
  const decoded = unformatted.replace(
    /&(#x[\da-f]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gi,
    (_, name: string) => {
      if (!name.startsWith("#")) {
        if (!Object.hasOwn(entities, name))
          throw new H5pImportError("question");
        return entities[name];
      }
      const hex = name[1]?.toLowerCase() === "x";
      const code = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code < 32 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
        throw new H5pImportError("question");
      return String.fromCodePoint(code);
    },
  );
  if (
    [...decoded].some(
      (character) =>
        isControlCharacter(character) && !"\r\n\t".includes(character),
    )
  )
    throw new H5pImportError("question");
  return decoded.replace(/\s+/g, " ").trim();
}

/** Keep CC attribution and supplied modification notices, rejecting ambiguous licences. */
function attribution(
  data: z.infer<typeof containedAttribution> & {
    title: string;
    language: string;
  },
  library: string,
) {
  const code = data.license?.trim().toUpperCase();
  const version = data.licenseVersion?.trim().toUpperCase();
  const cc0 =
    (code === "CC0 1.0" && (!version || version === "1.0")) ||
    (code === "CC0" && version === "1.0") ||
    (code === "PD" && (version === "CC0 1.0" || version === "CCO 1.0"));
  const ccBy = (code === "CC BY" || code === "CC-BY") && version === "4.0";
  if (!cc0 && !ccBy) throw new H5pImportError("license");

  try {
    const authors = data.authors?.length
      ? data.authors
      : data.author
        ? [{ name: data.author, role: "Author" as const }]
        : [];
    if (ccBy && !authors.length) throw new H5pImportError("license");
    const source = data.source ? new URL(data.source.trim()) : null;
    if (source && (source.username || source.password))
      throw new H5pImportError("license");
    const parsed = h5pAttributionSchema.safeParse({
      title: plainText(data.title),
      language: data.language,
      library,
      license: cc0 ? "CC0-1.0" : "CC-BY-4.0",
      authors: authors.map((author) => ({
        ...author,
        name: plainText(author.name),
      })),
      source_url: source?.href ?? null,
      license_notice: data.licenseExtras
        ? plainText(data.licenseExtras) || null
        : null,
      changes: (data.changes ?? []).map(({ author, date, log }) => ({
        author: plainText(author),
        date: plainText(date),
        log: plainText(log),
      })),
    });
    if (!parsed.success) throw new H5pImportError("license");
    return parsed.data;
  } catch {
    throw new H5pImportError("license");
  }
}

/** Convert only documented, text-only interactions with deterministic LMS scoring. */
function normalizeQuestion(data: unknown, library: string, language: string) {
  let imported;
  if (library === "H5P.MultiChoice 1.16") {
    const result = multiChoice.safeParse(data);
    if (!result.success || result.data.behaviour?.type === "multi")
      throw new H5pImportError("question");
    const { question, answers, media } = result.data;
    if (
      media?.type != null ||
      answers.filter(({ correct }) => correct).length !== 1
    )
      throw new H5pImportError("question");
    imported = {
      prompt: plainText(question),
      options: answers.map(({ text }) => plainText(text)),
      correct: answers.findIndex(({ correct }) => correct),
    };
  } else if (library === "H5P.TrueFalse 1.8") {
    const result = trueFalse.safeParse(data);
    if (!result.success || result.data.media?.type != null)
      throw new H5pImportError("question");
    const { question, correct, l10n } = result.data;
    imported = {
      prompt: plainText(question),
      options: [
        plainText(l10n?.trueText ?? (language === "de" ? "Wahr" : "True")),
        plainText(l10n?.falseText ?? (language === "de" ? "Falsch" : "False")),
      ],
      correct: correct === "true" ? 0 : 1,
    };
  } else throw new H5pImportError("question");

  return validateQuestion(imported);
}

function validateQuestion(imported: unknown) {
  const parsed = objectiveQuestionInput.safeParse(imported);
  if (
    !parsed.success ||
    new Set(parsed.data.options.map((answer) => answer.toLowerCase())).size !==
      parsed.data.options.length
  )
    throw new H5pImportError("question");
  return parsed.data;
}

/** Convert supported collections to separate, native-scored bank questions. */
function normalizeCollection(
  data: unknown,
  library: string,
  definition: z.infer<typeof manifest>,
): H5pCollectionItem[] {
  if (library === "H5P.SingleChoiceSet 1.11") {
    const parsed = choiceSet.safeParse(data);
    if (!parsed.success) throw new H5pImportError("question");
    return parsed.data.choices.map(({ question, answers }) => ({
      question: validateQuestion({
        prompt: plainText(question),
        options: answers.map(plainText),
        correct: 0,
      }),
      library,
      subcontent: null,
    }));
  }

  const parsed = questionSet.safeParse(data);
  if (!parsed.success) throw new H5pImportError("question");
  const declared = new Set(
    definition.preloadedDependencies.map(
      (item) => `${item.machineName} ${item.majorVersion}.${item.minorVersion}`,
    ),
  );
  return parsed.data.questions.map(
    ({ library: itemLibrary, params, metadata }) => {
      if (!declared.has(itemLibrary)) throw new H5pImportError("question");
      const question = normalizeQuestion(
        params,
        itemLibrary,
        metadata?.language ?? definition.language,
      );
      // Retain explicit child credits separately. An undeclared child licence
      // is inherited only when there are no independent child credits.
      const hasCredits =
        metadata &&
        (metadata.license !== undefined ||
          metadata.licenseVersion !== undefined ||
          metadata.author !== undefined ||
          metadata.authors !== undefined ||
          metadata.source !== undefined ||
          metadata.licenseExtras !== undefined ||
          metadata.changes !== undefined);
      const subcontent = hasCredits
        ? attribution(
            {
              ...metadata,
              title:
                metadata.title ??
                Array.from(question.prompt).slice(0, 150).join(""),
              language: metadata.language ?? definition.language,
            },
            itemLibrary,
          )
        : null;
      const result = h5pCollectionItemSchema.safeParse({
        question,
        library: itemLibrary,
        subcontent,
      });
      if (!result.success) throw new H5pImportError("question");
      return result.data;
    },
  );
}

/** Inspect archive metadata, decompress only JSON and fingerprint the original bytes. */
export async function readH5pPackage(file: File): Promise<H5pImport> {
  if (
    !file.name.toLowerCase().endsWith(".h5p") ||
    !file.size ||
    file.size > maxPackageSize
  )
    throw new H5pImportError("archive");
  const bytes = await file.arrayBuffer();
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)), {
    useWebWorkers: false,
    checkSignature: true,
    strictness: "strict",
  });
  try {
    const selected = new Map<string, FileEntry>();
    const names = new Set<string>();
    for await (const entry of zip.getEntriesGenerator()) {
      const filename = entry.directory
        ? entry.filename.replace(/\/$/, "")
        : entry.filename;
      const canonical = filename.toLowerCase();
      if (
        names.size >= maxEntries ||
        filename.length > 240 ||
        names.has(canonical) ||
        entry.encrypted ||
        entry.symlink ||
        /[\\:]/u.test(filename) ||
        [...filename].some(isControlCharacter) ||
        filename
          .split("/")
          .some((segment) => !segment || segment === "." || segment === "..")
      )
        throw new H5pImportError("archive");
      names.add(canonical);
      if (!entry.directory && packagePaths.some((path) => filename === path))
        selected.set(filename, entry);
      else if (canonical.startsWith("content/"))
        throw new H5pImportError("question");
    }

    const data = manifest.safeParse(
      await readJson(selected.get(packagePaths[0])),
    );
    if (!data.success) throw new H5pImportError("archive");
    const main = data.data.preloadedDependencies.filter(
      ({ machineName }) => machineName === data.data.mainLibrary,
    );
    if (main.length !== 1) throw new H5pImportError("question");
    const library = `${main[0].machineName} ${main[0].majorVersion}.${main[0].minorVersion}`;
    const collection = h5pCollectionLibraries.some(
      (candidate) => candidate === library,
    );
    if (
      !collection &&
      !h5pSimpleLibraries.some((candidate) => candidate === library)
    )
      throw new H5pImportError("question");
    const body = await readJson(selected.get(packagePaths[1]));
    const common = {
      package_sha256: await coursePackageDigest(bytes),
      attribution: attribution(data.data, library),
    };
    const result = collection
      ? h5pCollectionImportSchema.safeParse({
          ...common,
          questions: normalizeCollection(body, library, data.data),
        })
      : h5pQuestionImportSchema.safeParse({
          ...common,
          question: normalizeQuestion(body, library, data.data.language),
        });
    if (!result.success) throw new H5pImportError("question");
    return result.data;
  } catch (error) {
    if (error instanceof H5pImportError) throw error;
    throw new H5pImportError("archive");
  } finally {
    await zip.close();
  }
}
