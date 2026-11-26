/** Render a script-free SCORM launch profile without reusing any package DOM nodes. */
import {
  reviewScormPackage,
  ScormReviewError,
  type ScormPackageReview,
} from "./scorm-package";

const staticTags = new Set([
  "article",
  "section",
  "main",
  "header",
  "footer",
  "aside",
  "div",
  "span",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "dl",
  "dt",
  "dd",
  "blockquote",
  "pre",
  "code",
  "samp",
  "kbd",
  "br",
  "hr",
  "b",
  "strong",
  "i",
  "em",
  "s",
  "small",
  "mark",
  "sub",
  "sup",
  "table",
  "caption",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "figure",
  "figcaption",
  "details",
  "summary",
  "title",
]);
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const staticPolicy =
  "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
const staticStyles =
  "body{font:1rem/1.55 system-ui,sans-serif;margin:1rem;overflow-wrap:anywhere;color:#171717;background:#fff}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #888;padding:.35rem}blockquote{border-inline-start:.2rem solid #667;padding-inline-start:1rem;margin-inline:1rem 0}summary{cursor:pointer}";

/** Inert template parsing starts no resource loads. Rebuild only known HTML
 * semantics and text before providing a document to an opaque sandboxed frame. */
export function scormStaticDocument(source: string): string {
  // The fragment parser drops wrapper tags. Reject attributes on those tags
  // before parsing, except ordinary language/direction and author CSS classes.
  for (const [wrapper] of source.matchAll(
    /<(?:html|head|body)(?=[\s/>])[^>]*>/gi,
  )) {
    if (
      !/^<(?:html|head|body)(?:\s+(?:lang|dir|class|id)\s*=\s*(?:"[\w\s-]*"|'[\w\s-]*'))*\s*>$/i.test(
        wrapper,
      )
    )
      throw new ScormReviewError("unsupported_playback");
  }
  const template = document.createElement("template");
  template.innerHTML = source;
  const output = document.createElement("div");
  let elements = 0;
  function copy(node: Node, parent: HTMLElement, depth: number) {
    if (depth > 36 || ++elements > 6000)
      throw new ScormReviewError("unsupported_playback");
    if (node.nodeType === Node.TEXT_NODE) {
      parent.append(document.createTextNode(node.textContent ?? ""));
      return;
    }
    if (node.nodeType === Node.COMMENT_NODE) return;
    if (!(node instanceof Element) || node.namespaceURI !== htmlNamespace)
      throw new ScormReviewError("unsupported_playback");
    if (
      node.localName === "meta" &&
      ((node.attributes.length === 1 &&
        node.getAttribute("charset")?.toLowerCase() === "utf-8") ||
        (node.attributes.length === 2 &&
          node.getAttribute("name")?.toLowerCase() === "viewport" &&
          node.hasAttribute("content")))
    )
      return;
    if (!staticTags.has(node.localName))
      throw new ScormReviewError("unsupported_playback");
    const child = document.createElement(node.localName);
    for (const attribute of node.attributes) {
      if (
        (attribute.name === "lang" &&
          /^[A-Za-z0-9-]{1,32}$/.test(attribute.value)) ||
        (attribute.name === "dir" &&
          ["ltr", "rtl", "auto"].includes(attribute.value)) ||
        (attribute.name === "scope" &&
          node.localName === "th" &&
          ["row", "col", "rowgroup", "colgroup"].includes(attribute.value)) ||
        (["colspan", "rowspan"].includes(attribute.name) &&
          ["th", "td"].includes(node.localName) &&
          /^[1-9][0-9]?$/.test(attribute.value))
      ) {
        child.setAttribute(attribute.name, attribute.value);
      } else if (!["class", "id"].includes(attribute.name))
        throw new ScormReviewError("unsupported_playback");
    }
    for (const content of node.childNodes) copy(content, child, depth + 1);
    if (node.localName !== "title") parent.append(child);
  }
  for (const node of template.content.childNodes) copy(node, output, 0);
  if (!output.textContent?.trim())
    throw new ScormReviewError("unsupported_playback");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${staticPolicy}"><style>${staticStyles}</style></head><body>${output.innerHTML}</body></html>`;
}

/** Revalidate the exact ZIP and every launch. A bad page prevents playback of the entire package. */
export async function loadScormStaticPackage(
  bytes: ArrayBuffer,
  signal?: AbortSignal,
): Promise<{
  report: ScormPackageReview;
  pages: Map<string, string>;
}> {
  const pages = new Map<string, string>();
  let decodedBytes = 0;
  const report = await reviewScormPackage(bytes, signal, (path, content) => {
    if ((decodedBytes += content.byteLength) > 4 * 1024 * 1024)
      throw new ScormReviewError("unsupported_playback");
    let html: string;
    try {
      html = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      throw new ScormReviewError("unsupported_playback");
    }
    pages.set(path, scormStaticDocument(html));
  });
  return { report, pages };
}
