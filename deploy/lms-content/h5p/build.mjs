/** Build a standalone static H5P origin from pinned upstream releases. */
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";

const root = dirname(fileURLToPath(import.meta.url));
const dist = join(root, "dist");
const player = join(root, "node_modules/h5p-standalone/dist");
const sources = {
  "H5P.TrueFalse":
    "088b932daf65e80fbd4bf79332634272ae81760463bf7191ad4aac1921239273",
  "H5P.MultiChoice":
    "1c60785f1e9b6630b30d4e9bcc4b7ec1c8976f05bf50c41ddbb25e59fd2c8fdb",
  "H5P.SingleChoiceSet":
    "db11ba42647411182bed2880c95199a98db6dba5134bb038fd416d8e23b96cd8",
  "H5P.QuestionSet":
    "8b066b98e88a238fae31638ee2c5d12f26707bfb2555a7dbff08609038e68c07",
};

async function officialPackage(library, expectedHash) {
  // Allow reproducible offline builds from an operator's pre-fetched release archives.
  const cache = process.env.LUMINOVIA_H5P_BUILD_ARCHIVE_DIRECTORY;
  const bytes = cache
    ? await readFile(join(cache, `${library}.h5p`))
    : await (async () => {
        const response = await fetch(
          `https://api.h5p.org/v1/content-types/${library}`,
          {
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok)
          throw new Error(`Upstream H5P package ${library} is unavailable`);
        const reader = response.body.getReader();
        const buffers = [];
        let count = 0;
        try {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            count += chunk.value.byteLength;
            if (count > 8 * 1024 * 1024)
              throw new Error("Upstream package exceeds build bounds");
            buffers.push(chunk.value);
          }
        } finally {
          await reader.cancel();
        }
        return Buffer.concat(buffers);
      })();
  if (createHash("sha256").update(bytes).digest("hex") !== expectedHash)
    throw new Error(`Pinned H5P release content changed for ${library}`);
  return bytes;
}

const libraryFolder = /^(?:H5P(?:Editor)?\.[A-Za-z0-9]+|FontAwesome|jQuery\.ui)-\d+\.\d+$/;
const safePart = /^[a-zA-Z0-9._-]+$/;
const catalogue = new Set();
const written = new Map();
const testSample =
  process.env.PORTAL_TEST_MODE === "1"
    ? process.env.LUMINOVIA_H5P_BUILD_TEST_SAMPLE
    : undefined;
let verifiedSample;
for (const [library, digest] of Object.entries(sources)) {
  const bytes = await officialPackage(library, digest);
  if (testSample && library === "H5P.TrueFalse") verifiedSample = bytes;
  const zip = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    for (const item of await zip.getEntries()) {
      const parts = item.filename.split("/");
      if (item.directory || !libraryFolder.test(parts[0]) || parts.length < 2)
        continue;
      if (
        parts.some(
          (part) => !safePart.test(part) || part === "." || part === "..",
        )
      )
        throw new Error(`Invalid filename in pinned H5P release ${library}`);
      // No server or user-provided code enters this build directory.
      if (
        !/\.(?:js|css|json|png|jpe?g|gif|webp|svg|woff2?|ttf|eot|mp3|ogg|wav|txt|md|map)$/i.test(
          item.filename,
        )
      )
        continue;
      const bytes = await item.getData(new Uint8ArrayWriter(), {
        checkSignature: true,
      });
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (written.has(item.filename)) {
        if (written.get(item.filename) !== digest)
          throw new Error(`Conflicting pinned copies of ${item.filename}`);
        continue;
      }
      if (parts.length === 2 && parts[1] === "library.json")
        catalogue.add(parts[0]);
      written.set(item.filename, digest);
      const target = join(dist, "libraries", ...parts);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
  } finally {
    await zip.close();
  }
}

await cp(player, join(dist, "player"), { recursive: true });
for (const name of [
  "index.html",
  "launch.mjs",
  "virtual-files.js",
  "content-policy.mjs",
  "serve.mjs",
]) {
  await cp(join(root, name), join(dist, name));
}
const declared = JSON.parse(
  await readFile(join(root, "library-catalogue.json"), "utf8"),
);
if (
  JSON.stringify([...catalogue].sort()) !==
    JSON.stringify(declared.installed) ||
  declared.playable.some((name) => !catalogue.has(name))
)
  throw new Error("Pinned library catalogue needs review");
await writeFile(join(dist, "catalogue.json"), JSON.stringify(declared));
// Exercise the native upload using the exact bytes already verified by this
// build. Keep the archive out of the deployable content runtime.
if (testSample) await writeFile(testSample, verifiedSample, { mode: 0o600 });
console.log(
  `Built trusted H5P runtime and ${catalogue.size} pinned libraries in ${dist}`,
);
