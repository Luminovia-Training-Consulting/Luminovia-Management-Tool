/**
 * Erlaubter strukturierter Editorinhalt samt Link-, Tiefen- und Größenbegrenzung. Es wird ein neuer JSON-Baum aus unterstützten Knoten erzeugt; PostgreSQL validiert den Vertrag unabhängig vom Browser.
 */
import type { JSONContent } from "@tiptap/react";
/** Strukturell gültiger leerer Editorstart statt ungeprüftem HTML. */
export const emptyDocument: JSONContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};
/** Explizite Knotenallowlist des gespeicherten Wissens-JSON. */
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
/** Erlaubte Textformatierungen; Links erhalten eine gesonderte Zielvalidierung. */
const marks = new Set(["bold", "italic", "strike", "code"]);
/** Erlaubt interne absolute Pfade und HTTP(S)/mailto-Ziele und verwirft Steuerzeichen, Backslashes und Protokollabkürzungen. */
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
/** Emit only the supported JSON schema. The database independently validates it. */
/** Erzeugt einen neuen begrenzten Editorbaum ausschließlich aus erlaubten Knoten, Attributen und sicheren Links. */
export function normalizedDocument(value: JSONContent, depth = 0): JSONContent {
  if (depth > 16 || !value || !nodes.has(value.type ?? ""))
    return { type: "paragraph" };
  // Whitelisting erzeugt den Baum neu: unbekannte Attribute werden nicht
  // durch Objektspread oder originalen HTML-Inhalt in die Ausgabe übernommen.
  const result: JSONContent = { type: value.type };
  if (value.type === "text") result.text = value.text ?? "";
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
  // Links werden gesondert validiert und bekommen feste neue-Tab-Attribute.
  // Unbekannte Formatierungsmarken verschwinden statt als HTML weiterzuleben.
  if (value.marks?.length)
    result.marks = value.marks.flatMap((mark) =>
      marks.has(mark.type)
        ? [{ type: mark.type }]
        : mark.type === "link" &&
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
          : [],
    );
  if (value.content)
    result.content = value.content.map((child) =>
      normalizedDocument(child, depth + 1),
    );
  return result;
}
/** Extrahiert verfassten Text rekursiv aus dem strukturierten Dokument für Validierung und Suchvorschauen. */
export function documentText(value: JSONContent): string {
  return [value.text ?? "", ...(value.content ?? []).map(documentText)].join(
    " ",
  );
}
/** Begrenzt sowohl sichtbaren Text als auch serialisierte UTF-8-Bytes und erlaubt Leerinhalt nur ausdrücklich. */
export function contentIsValid(value: JSONContent, allowEmpty = false) {
  const text = documentText(value).trim();
  return (
    (allowEmpty || text.length > 0) &&
    text.length <= 40000 &&
    // UTF-8-Bytes begrenzen zusätzlich unsichtbare Struktur-/Attributlast.
    new TextEncoder().encode(JSON.stringify(value)).byteLength <= 200000
  );
}
