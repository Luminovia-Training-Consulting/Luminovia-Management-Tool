/** Select only bounded JSON and local media from the exact scanned H5P archive. */
import { Uint8ArrayReader, ZipReader, type FileEntry } from "@zip.js/zip.js";
import catalogue from "../../../deploy/lms-content/h5p/library-catalogue.json";
import {
  consumePackageEntry,
  coursePackageDigest,
} from "./course-package-archive";

const supportedMedia =
  /\.(?:png|jpe?g|gif|webp|avif|mp3|ogg|wav|mp4|webm|vtt)$/i;
const maxArchive = 10 * 1024 * 1024;
const maxContent = 25 * 1024 * 1024;
const maxJson = 512 * 1024;
const allowedEntry = /^content\/(?:[a-zA-Z0-9_ .-]+\/)*[a-zA-Z0-9_ .-]+$/;
const manifestPath = "h5p.json";
const contentPath = "content/content.json";
const validLibrary = /^H5P\.[a-zA-Z0-9]+$/;
const decoder = new TextDecoder("utf-8", { fatal: true });
const installed = new Set(catalogue.installed);
const playable = new Set(catalogue.playable);

export type H5pPlayback = {
  title: string;
  sha256: string;
  assets: { path: string; bytes: ArrayBuffer }[];
};

function validPath(path: string) {
  return (
    path.length <= 240 &&
    allowedEntry.test(path) &&
    !path
      .split("/")
      .some((part) => part === "." || part === ".." || part !== part.trim())
  );
}

async function bytesFor(entry: FileEntry, limit: number, signal?: AbortSignal) {
  if (
    entry.encrypted ||
    ![0, 8].includes(entry.compressionMethod) ||
    !Number.isSafeInteger(entry.uncompressedSize) ||
    entry.uncompressedSize < 1 ||
    entry.uncompressedSize > limit
  )
    throw new Error("h5p_asset_size");
  const bytes = new ArrayBuffer(entry.uncompressedSize);
  await consumePackageEntry(entry, new Uint8Array(bytes), signal);
  return bytes;
}

export async function readH5pPlayback(
  blob: Blob,
  signal?: AbortSignal,
): Promise<H5pPlayback> {
  if (blob.size < 4 || blob.size > maxArchive)
    throw new Error("h5p_archive_size");
  signal?.throwIfAborted();
  const archive = await blob.arrayBuffer();
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(archive)), {
    useWebWorkers: false,
  });
  try {
    const names = new Set<string>();
    const entries = new Map<string, FileEntry>();
    let count = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      signal?.throwIfAborted();
      if (++count > 2048) throw new Error("h5p_entries");
      if (entry.directory) continue;
      const path = entry.filename;
      const folded = path.normalize("NFC").toLowerCase();
      if (names.has(folded)) throw new Error("h5p_duplicate_files");
      names.add(folded);
      if (
        path === manifestPath ||
        path === contentPath ||
        (validPath(path) && supportedMedia.test(path))
      )
        entries.set(path, entry);
    }
    if (
      !entries.has(manifestPath) ||
      !entries.has(contentPath) ||
      entries.size > 256
    )
      throw new Error("h5p_content_missing");
    const assets: H5pPlayback["assets"] = [];
    let total = 0;
    let title = "";
    for (const [path, entry] of entries) {
      const json = path === manifestPath || path === contentPath;
      const bytes = await bytesFor(
        entry,
        Math.min(json ? maxJson : maxContent, maxContent - total),
        signal,
      );
      total += bytes.byteLength;
      if (json) {
        const record: unknown = JSON.parse(decoder.decode(bytes));
        if (!record || typeof record !== "object" || Array.isArray(record))
          throw new Error("h5p_json");
        if (path === manifestPath) {
          const manifest = record as Record<string, unknown>;
          if (
            typeof manifest.title !== "string" ||
            !manifest.title.trim() ||
            manifest.title.trim().length > 200 ||
            typeof manifest.mainLibrary !== "string" ||
            !validLibrary.test(manifest.mainLibrary) ||
            !Array.isArray(manifest.preloadedDependencies)
          )
            throw new Error("h5p_manifest");
          const main = manifest.preloadedDependencies.filter(
            (library) => library?.machineName === manifest.mainLibrary,
          );
          if (
            manifest.preloadedDependencies.length < 1 ||
            manifest.preloadedDependencies.length > 100 ||
            main.length !== 1 ||
            !playable.has(
              `${main[0].machineName}-${main[0].majorVersion}.${main[0].minorVersion}`,
            ) ||
            manifest.preloadedDependencies.some(
              (library) =>
                !library ||
                typeof library !== "object" ||
                !installed.has(
                  `${library.machineName}-${library.majorVersion}.${library.minorVersion}`,
                ),
            )
          )
            throw new Error("h5p_unavailable_library");
          title = manifest.title.trim();
        }
      }
      assets.push({ path, bytes });
    }
    return { assets, title, sha256: await coursePackageDigest(archive) };
  } finally {
    await zip.close();
  }
}
