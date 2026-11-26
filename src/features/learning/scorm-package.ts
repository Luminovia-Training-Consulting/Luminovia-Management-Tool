/** Inert, browser-local preflight for a bounded subset of SCORM 1.2 package interchange files. */
import { Uint8ArrayReader, ZipReader, type FileEntry } from "@zip.js/zip.js";
import {
  consumePackageEntry,
  coursePackageDigest,
  PackageEntryOverflowError,
} from "./course-package-archive.ts";

export const scormPackageMaxBytes = 10 * 1024 * 1024;
const maxExpandedBytes = 64 * 1024 * 1024;
const maxFileBytes = 8 * 1024 * 1024;
const maxManifestBytes = 256 * 1024;
const maxEntries = 512;
const maxLaunches = 100;
const maxItemDepth = 24;
const maxCompressionRatio = 100;
const manifestName = "imsmanifest.xml";
const ims12 = "http://www.imsproject.org/xsd/imscp_rootv1p1p2";
const adl12 = "http://www.adlnet.org/xsd/adlcp_rootv1p2";
const xml = "http://www.w3.org/XML/1998/namespace";
const ordinaryUnixFileType = 0o100000;
const unixDirectoryType = 0o040000;

type ReviewError =
  | "file_size"
  | "invalid_archive"
  | "archive_limits"
  | "unsafe_paths"
  | "invalid_manifest"
  | "unsupported_manifest"
  | "missing_resources"
  | "unsupported_playback";

export class ScormReviewError extends Error {
  readonly code: ReviewError;

  constructor(code: ReviewError) {
    super(code);
    this.code = code;
  }
}

type Resource = {
  kind: "sco" | "asset";
  dependencies: string[];
  path: string | null;
};
type Launch = { id: string; title: string; path: string };

export type ScormPackageReview = {
  sha256: string;
  files: number;
  expandedBytes: number;
  organisation: string;
  launches: Launch[];
};

/** Canonical lexical paths only. Never pass package-controlled paths to filesystem or URL APIs. */
function archivePath(value: string): string {
  const normalized = value.normalize("NFC");
  if (
    !normalized ||
    normalized.length > 480 ||
    /[\\:%?#\p{Cc}\p{Cf}]/u.test(normalized)
  )
    throw new ScormReviewError("unsafe_paths");
  const parts = normalized.split("/");
  if (
    parts.length > 24 ||
    parts.some(
      (part) =>
        !part ||
        part.length > 160 ||
        part === "." ||
        part === ".." ||
        part.trim() !== part ||
        part.endsWith(".") ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part) ||
        /[<>|*"]/.test(part),
    )
  )
    throw new ScormReviewError("unsafe_paths");
  return normalized;
}

/** Accept local encoded filenames and optional launch query/fragment without navigating to them. */
function referencePath(href: string, parent: string): string {
  const localPath = href.split(/[?#]/, 1)[0].replace(/^\.\//, "");
  if (!localPath) throw new ScormReviewError("missing_resources");
  let decoded: string[];
  try {
    decoded = localPath.split("/").map(decodeURIComponent);
  } catch {
    throw new ScormReviewError("unsafe_paths");
  }
  if (decoded.some((part) => part.includes("/")))
    throw new ScormReviewError("unsafe_paths");
  return archivePath(parent + decoded.join("/"));
}

/** Resolve an explicitly relative directory base without remote URLs or implicit traversals. */
function scopedBase(element: Element, parent = ""): string {
  const base = element.getAttributeNS(xml, "base");
  if (base === null || base === "" || base === "./") return parent;
  if (!base.endsWith("/") || /[?#]/.test(base))
    throw new ScormReviewError("unsupported_manifest");
  return referencePath(base.slice(0, -1), parent) + "/";
}

/** Recognize supported IMS elements by namespace, independent of author prefix choices. */
function imsChildren(element: Element, name: string) {
  return Array.from(element.children).filter(
    (child) => child.namespaceURI === ims12 && child.localName === name,
  );
}

function oneElement(element: Element, name: string): Element {
  const entries = imsChildren(element, name);
  if (entries.length !== 1) throw new ScormReviewError("invalid_manifest");
  return entries[0];
}

function identifier(element: Element, attribute = "identifier") {
  const id = element.getAttribute(attribute);
  if (!id || id.length > 160 || /[\s\p{Cc}\p{Cf}]/u.test(id))
    throw new ScormReviewError("invalid_manifest");
  return id;
}

function title(element: Element, fallback: string) {
  return (
    (imsChildren(element, "title")[0]?.textContent ?? "")
      .replace(/[\s\p{Cc}\p{Cf}]+/gu, " ")
      .trim()
      .slice(0, 180) || fallback
  );
}

/** Resolve SCORM dependencies within the exact reviewed resource set. */
function validateDependencies(resources: ReadonlyMap<string, Resource>) {
  const visited = new Set<string>();
  const active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new ScormReviewError("invalid_manifest");
    if (visited.has(id)) return;
    const resource = resources.get(id);
    if (!resource) throw new ScormReviewError("missing_resources");
    active.add(id);
    resource.dependencies.forEach(visit);
    active.delete(id);
    visited.add(id);
  }
  resources.forEach((_, id) => visit(id));
}

/** Read the default organization and verify the manifest's local SCO/asset graph. */
function inspectManifest(source: string, files: ReadonlySet<string>) {
  const declaration =
    /^\s*<\?xml\s+version=(["'])1\.0\1(?:\s+encoding=(["'])utf-8\2)?(?:\s+standalone=(["'])(?:yes|no)\3)?\s*\?>/i;
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source.replace(declaration, "")))
    throw new ScormReviewError("unsupported_manifest");
  // XML parsing is inert and receives no styles, DTDs or processing instructions.
  const document = new DOMParser().parseFromString(source, "application/xml");
  const manifest = document.documentElement;
  if (
    document.querySelector("parsererror") ||
    manifest.localName !== "manifest"
  )
    throw new ScormReviewError("invalid_manifest");
  if (
    manifest.namespaceURI !== ims12 ||
    imsChildren(manifest, "manifest").length
  )
    throw new ScormReviewError("unsupported_manifest");
  identifier(manifest);
  const metadata = imsChildren(manifest, "metadata");
  const version =
    metadata[0] &&
    imsChildren(metadata[0], "schemaversion")[0]?.textContent?.trim();
  if (metadata.length > 1 || (version && version !== "1.2"))
    throw new ScormReviewError("unsupported_manifest");

  const manifestBase = scopedBase(manifest);
  const resourceSection = oneElement(manifest, "resources");
  const resourceBase = scopedBase(resourceSection, manifestBase);
  const definitions = imsChildren(resourceSection, "resource");
  if (!definitions.length || definitions.length > maxEntries)
    throw new ScormReviewError("invalid_manifest");
  const resources = new Map<string, Resource>();
  for (const element of definitions) {
    const id = identifier(element);
    if (resources.has(id)) throw new ScormReviewError("invalid_manifest");
    const kind = element.getAttributeNS(adl12, "scormtype");
    if (
      (kind !== "sco" && kind !== "asset") ||
      element.getAttribute("type") !== "webcontent"
    )
      throw new ScormReviewError("unsupported_manifest");
    const base = scopedBase(element, resourceBase);
    const href = element.getAttribute("href");
    const path = href ? referencePath(href, base) : null;
    if ((path && !files.has(path)) || (kind === "sco" && !path))
      throw new ScormReviewError("missing_resources");
    if (kind === "sco" && path && !/\.html?$/i.test(path))
      throw new ScormReviewError("unsupported_manifest");
    for (const declaredFile of imsChildren(element, "file")) {
      const filePath = declaredFile.getAttribute("href");
      if (
        !filePath ||
        !files.has(referencePath(filePath, scopedBase(declaredFile, base)))
      )
        throw new ScormReviewError("missing_resources");
    }
    resources.set(id, {
      kind,
      path,
      dependencies: imsChildren(element, "dependency").map((dependency) =>
        identifier(dependency, "identifierref"),
      ),
    });
  }
  validateDependencies(resources);

  const organizations = oneElement(manifest, "organizations");
  const options = imsChildren(organizations, "organization");
  if (!options.length || options.length > 25)
    throw new ScormReviewError("unsupported_manifest");
  const ids = options.map((item) => identifier(item));
  const defaultId =
    organizations.getAttribute("default") ?? (ids.length === 1 ? ids[0] : "");
  const selected = options[ids.indexOf(defaultId)];
  if (!selected || new Set(ids).size !== ids.length)
    throw new ScormReviewError("invalid_manifest");

  // Parse all organization references. Return only the default
  // outline and preserve the order selected by the author.
  let items = 0;
  const launches: Launch[] = [];
  const itemIds = new Set<string>();
  function inspectItems(
    parent: Element,
    depth: number,
    activeOrganization: boolean,
  ) {
    if (depth > maxItemDepth) throw new ScormReviewError("archive_limits");
    for (const item of imsChildren(parent, "item")) {
      if (++items > maxEntries) throw new ScormReviewError("archive_limits");
      const id = identifier(item);
      if (itemIds.has(id)) throw new ScormReviewError("invalid_manifest");
      itemIds.add(id);
      if (item.hasAttribute("identifierref")) {
        const resource = resources.get(identifier(item, "identifierref"));
        if (!resource) throw new ScormReviewError("missing_resources");
        if (activeOrganization && resource.kind === "sco" && resource.path) {
          if (launches.length >= maxLaunches)
            throw new ScormReviewError("archive_limits");
          launches.push({ id, title: title(item, id), path: resource.path });
        }
      }
      inspectItems(item, depth + 1, activeOrganization);
    }
  }
  options.forEach((option) => inspectItems(option, 1, option === selected));
  if (!launches.length) throw new ScormReviewError("unsupported_manifest");
  return { organisation: title(selected, defaultId), launches };
}

/** Verify exact ZIP bytes, CRC and size bounds. Return only metadata and a byte digest. */
export async function reviewScormPackage(
  bytes: ArrayBuffer,
  signal?: AbortSignal,
  inspectLaunch?: (path: string, bytes: Uint8Array) => void,
  runtimeFiles?: Map<string, Uint8Array<ArrayBuffer>>,
): Promise<ScormPackageReview> {
  signal?.throwIfAborted();
  if (bytes.byteLength < 4 || bytes.byteLength > scormPackageMaxBytes)
    throw new ScormReviewError("file_size");
  if (new DataView(bytes).getUint32(0, true) !== 0x04034b50)
    throw new ScormReviewError("invalid_archive");

  const directory = new ZipReader(new Uint8ArrayReader(new Uint8Array(bytes)), {
    useWebWorkers: false,
  });
  const files = new Map<string, FileEntry>();
  const paths = new Map<string, { name: string; directory: boolean }>();
  let expandedBytes = 0;
  let entries = 0;
  try {
    for await (const entry of directory.getEntriesGenerator()) {
      signal?.throwIfAborted();
      if (
        ++entries > maxEntries ||
        entry.encrypted ||
        entry.diskNumberStart !== 0 ||
        ![0, 8].includes(entry.compressionMethod)
      )
        throw new ScormReviewError("archive_limits");
      const type = (entry.unixMode ?? 0) & 0o170000;
      const name = archivePath(
        entry.directory ? entry.filename.replace(/\/$/, "") : entry.filename,
      );
      const folded = name.toLowerCase();
      if (
        entry.symlink ||
        (type !== 0 &&
          type !==
            (entry.directory ? unixDirectoryType : ordinaryUnixFileType)) ||
        paths.has(folded) ||
        (!entry.directory && /\.(?:zip|rar|7z|gz|tar|xz|bz2|jar)$/i.test(name))
      )
        throw new ScormReviewError("unsafe_paths");
      paths.set(folded, { name, directory: entry.directory });
      const limit = name === manifestName ? maxManifestBytes : maxFileBytes;
      const size = entry.uncompressedSize;
      const compressed = entry.compressedSize;
      if (
        !Number.isSafeInteger(size) ||
        !Number.isSafeInteger(compressed) ||
        size < 0 ||
        compressed < 0 ||
        compressed > bytes.byteLength ||
        (entry.directory && size !== 0) ||
        size > limit ||
        size > Math.max(compressed, 1) * maxCompressionRatio ||
        (expandedBytes += size) > maxExpandedBytes
      )
        throw new ScormReviewError("archive_limits");
      if (!entry.directory) files.set(name, entry);
    }
    // Treat file/folder aliases consistently, including implicit folders.
    const folders = new Map<string, string>();
    for (const { name } of paths.values()) {
      const parts = name.split("/");
      for (let prefix = 1; prefix < parts.length; prefix++) {
        const folder = parts.slice(0, prefix).join("/");
        const key = folder.toLowerCase();
        const declared = paths.get(key);
        const inferred = folders.get(key);
        if (
          (declared && (!declared.directory || declared.name !== folder)) ||
          (inferred && inferred !== folder)
        )
          throw new ScormReviewError("unsafe_paths");
        folders.set(key, folder);
      }
    }

    const manifest = files.get(manifestName);
    if (!manifest) throw new ScormReviewError("invalid_manifest");
    const manifestBytes = new Uint8Array(manifest.uncompressedSize);
    await consumePackageEntry(manifest, manifestBytes, signal);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes);
    } catch {
      throw new ScormReviewError("invalid_manifest");
    }
    const structure = inspectManifest(text, new Set(files.keys()));
    const launchPaths = new Set(structure.launches.map(({ path }) => path));
    for (const [name, entry] of files) {
      if (name === manifestName) continue;
      // Check every CRC. Static playback only reads the actual launch bytes, bounded
      // more tightly than general package resources and retained by the caller alone.
      const isLaunch = launchPaths.has(name);
      const retain =
        runtimeFiles &&
        (isLaunch ||
          /\.(?:html?|m?js|css|png|gif|jpe?g|webp|mp3|mp4|ogg|wav|woff2?|vtt)$/i.test(
            name,
          ));
      if (retain || (inspectLaunch && isLaunch)) {
        if (isLaunch && entry.uncompressedSize > maxManifestBytes)
          throw new ScormReviewError("archive_limits");
        const content = new Uint8Array(entry.uncompressedSize);
        await consumePackageEntry(entry, content, signal);
        if (retain) runtimeFiles.set(name, content);
        if (isLaunch) inspectLaunch?.(name, content);
      } else await consumePackageEntry(entry, null, signal);
    }
    signal?.throwIfAborted();
    const sha256 = await coursePackageDigest(bytes);
    signal?.throwIfAborted();
    return {
      ...structure,
      sha256,
      files: files.size,
      expandedBytes,
    };
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof PackageEntryOverflowError)
      throw new ScormReviewError("archive_limits");
    if (error instanceof ScormReviewError) throw error;
    throw new ScormReviewError("invalid_archive");
  } finally {
    await directory.close();
  }
}
