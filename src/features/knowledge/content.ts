/**
 * Structured editor content with link, depth and size bounds. Rebuild JSON from supported nodes;
 * PostgreSQL validates the same contract independently of the browser.
 */
import type { JSONContent } from "@tiptap/react";

/** Structurally valid empty editor state rather than unvalidated HTML. */
export const emptyDocument: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
/** Limit optional highlighting work independently of the larger content limit. */
export const maxHighlightLength = 8_000;

/** Explicit node allowlist for stored knowledge JSON. */
const nodes = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "codeBlock",
  "hardBreak",
  "horizontalRule",
]);
/** Allowed text marks; link destinations receive separate validation. */
const marks = new Set(["bold", "italic", "strike", "code"]);

/** Allow internal absolute paths and HTTP(S)/mailto links; reject controls, backslashes and protocol-relative URLs. */
export function safeLink(value: string): boolean {
  if (
    !value ||
    [...value].some(
      (character) => character.charCodeAt(0) <= 32 || character === "\\",
    )
  )
    return false;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return ["https:", "http:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** Rebuild a bounded tree from allowed nodes/attributes/links; the database independently validates the stored schema. */
export function normalizedDocument(value: JSONContent, depth = 0): JSONContent {
  if (depth > 16 || !value || !nodes.has(value.type ?? ""))
    return { type: "paragraph" };
  // Rebuild through an allowlist: unknown attributes are never copied through
  // object spread or original HTML into the normalized output.
  const result: JSONContent = { type: value.type };
  if (value.type === "text")
    result.text = typeof value.text === "string" ? value.text : "";
  if (value.type === "heading")
    result.attrs = {
      level: [1, 2, 3].includes(Number(value.attrs?.level))
        ? Number(value.attrs?.level)
        : 2,
    };
  if (
    value.type === "codeBlock" &&
    typeof value.attrs?.language === "string" &&
    /^[a-zA-Z0-9_+-]{0,30}$/.test(value.attrs.language)
  )
    result.attrs = { language: value.attrs.language };
  // Validate links separately and assign fixed new-tab attributes.
  // Discard unknown formatting marks instead of retaining them as HTML.
  if (Array.isArray(value.marks) && value.marks.length)
    result.marks = value.marks.flatMap((mark) => {
      if (!mark) return [];
      if (marks.has(mark.type)) return [{ type: mark.type }];
      return mark.type === "link" &&
        typeof mark.attrs?.href === "string" &&
        safeLink(mark.attrs.href)
        ? [
            {
              type: "link",
              attrs: {
                href: mark.attrs.href,
                target: "_blank",
                rel: "noopener noreferrer",
              },
            },
          ]
        : [];
    });
  if (Array.isArray(value.content))
    result.content = value.content.map((child) =>
      normalizedDocument(child, depth + 1),
    );
  return result;
}

/** Extract authored text recursively for validation and search previews. */
export function documentText(value: JSONContent): string {
  return [value.text ?? "", ...(value.content ?? []).map(documentText)].join(
    " ",
  );
}

/** Bound visible text and serialized UTF-8 bytes; allow empty content only when explicitly requested. */
export function contentIsValid(value: JSONContent, allowEmpty = false) {
  const text = documentText(value).trim();
  return (
    (allowEmpty || text.length > 0) &&
    text.length <= 40000 &&
    // UTF-8 byte limits also bound invisible structure and attribute overhead.
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= 200000
  );
}
