/** Accept JSON and media for installed H5P libraries, keeping executable assets outside this data path. */
export const allowedMedia = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  mp4: "video/mp4",
  webm: "video/webm",
  vtt: "text/vtt",
};
const harmlessTags = new Set([
  "b",
  "strong",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "br",
  "p",
  "div",
  "span",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ol",
  "ul",
  "li",
  "sub",
  "sup",
  "table",
  "caption",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "blockquote",
]);
const voidTags = new Set(["br"]);
const droppedTags = new Set([
  "script",
  "style",
  "template",
  "iframe",
  "svg",
  "math",
  "object",
  "embed",
]);
const filePattern = /^content\/(?:[a-zA-Z0-9_ .-]+\/)*[a-zA-Z0-9_ .-]+$/;
const dependencyPattern =
  /^(?:H5P(?:Editor)?\.[a-zA-Z0-9]+|FontAwesome)-\d{1,3}\.\d{1,3}$/;

export function mediaType(path) {
  if (
    !filePattern.test(path) ||
    path
      .split("/")
      .some((part) => part === "." || part === ".." || part !== part.trim())
  )
    return null;
  return allowedMedia[path.split(".").at(-1)?.toLowerCase()] ?? null;
}

function escapeText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function richText(value) {
  const html = new DOMParser().parseFromString(value, "text/html").body;
  const extract = (node, depth = 0) => {
    if (depth > 24) throw new Error("H5P markup is too deeply nested");
    if (node.nodeType === Node.TEXT_NODE)
      return escapeText(node.textContent ?? "");
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const tag = node.localName;
    if (droppedTags.has(tag)) return "";
    const content = Array.from(node.childNodes, (child) =>
      extract(child, depth + 1),
    ).join("");
    if (!harmlessTags.has(tag)) return content;
    return voidTags.has(tag) ? `<${tag}>` : `<${tag}>${content}</${tag}>`;
  };
  return Array.from(html.childNodes, (node) => extract(node)).join("");
}

function deobfuscate(value) {
  return value.trim().replace(/[\u0000-\u0020\u007f]/g, "");
}

export function sanitizePackageContent(raw, catalogue, depth = 0) {
  if (depth > 48) throw new Error("H5P data is too deeply nested");
  if (typeof raw === "string") {
    const compact = deobfuscate(raw);
    if (/^(?:https?:|data:|blob:|javascript:|\/\/|\\\\)/i.test(compact))
      return "";
    return raw.includes("<") ? richText(raw) : raw;
  }
  if (Array.isArray(raw))
    return raw.map((item) =>
      sanitizePackageContent(item, catalogue, depth + 1),
    );
  if (!raw || typeof raw !== "object") return raw;
  if (
    typeof raw.library === "string" &&
    !catalogue.has(raw.library.replace(" ", "-"))
  )
    throw new Error(
      "Embedded H5P content needs a library outside the installed catalogue",
    );
  return Object.fromEntries(
    Object.entries(raw)
      .filter(
        ([key]) =>
          key !== "__proto__" && key !== "constructor" && key !== "prototype",
      )
      .map(([key, item]) => [
        key,
        sanitizePackageContent(item, catalogue, depth + 1),
      ]),
  );
}

export function checkedManifest(raw, catalogue, playable) {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.title !== "string" ||
    !raw.title.trim() ||
    raw.title.trim().length > 200 ||
    typeof raw.mainLibrary !== "string" ||
    !/^H5P\.[a-zA-Z0-9]+$/.test(raw.mainLibrary) ||
    !Array.isArray(raw.preloadedDependencies) ||
    raw.preloadedDependencies.length < 1 ||
    raw.preloadedDependencies.length > 100
  )
    throw new Error("Invalid H5P manifest");
  const dependencies = raw.preloadedDependencies.map(
    ({ machineName, majorVersion, minorVersion }) => {
      const name = `${machineName}-${majorVersion}.${minorVersion}`;
      if (!dependencyPattern.test(name) || !catalogue.has(name))
        throw new Error("H5P needs a library outside the installed catalogue");
      return {
        machineName,
        majorVersion: Number(majorVersion),
        minorVersion: Number(minorVersion),
      };
    },
  );
  const main = dependencies.filter(
    ({ machineName }) => machineName === raw.mainLibrary,
  );
  if (
    main.length !== 1 ||
    !playable.has(
      `${main[0].machineName}-${main[0].majorVersion}.${main[0].minorVersion}`,
    )
  )
    throw new Error("The package main library is unavailable");
  const metadata = Object.fromEntries(
    Object.entries(raw).filter(([key]) =>
      [
        "title",
        "language",
        "license",
        "licenseVersion",
        "licenseExtras",
        "authors",
        "source",
        "changes",
        "mainLibrary",
      ].includes(key),
    ),
  );
  const safeMetadata = sanitizePackageContent(metadata, catalogue);
  // The browser only receives this vetted declaration. Editor code and package resources are ignored here.
  return {
    ...safeMetadata,
    embedTypes: ["iframe"],
    preloadedDependencies: dependencies,
  };
}
