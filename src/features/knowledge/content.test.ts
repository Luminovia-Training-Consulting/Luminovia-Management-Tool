/**
 * Regressions for node/link allowlists, structure/size limits and rejection of executable
 * destinations. Pure normalization checks do not replace server validation.
 */
import type { JSONContent } from "@tiptap/react";
import { describe, expect, it } from "vitest";
import {
  contentIsValid,
  documentText,
  normalizedDocument,
  safeLink,
} from "./content";

describe("knowledge content boundary", () => {
  it("preserves code as literal text with an explicit language", () => {
    const code = '<script>alert("example")</script>\nprint("hello")';
    const doc = normalizedDocument({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "python", arbitrary: "discard" },
          content: [{ type: "text", text: code }],
        },
      ],
    });
    expect(doc.content?.[0]).toEqual({
      type: "codeBlock",
      attrs: { language: "python" },
      content: [{ type: "text", text: code }],
    });
    expect(documentText(doc)).toContain(code);
  });
  it("drops unsupported executable nodes, arbitrary attributes and unsafe link marks", () => {
    const doc = normalizedDocument({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: { src: "data:text/html,<script>bad</script>" },
        },
        {
          type: "paragraph",
          attrs: { onclick: "bad" },
          content: [
            {
              type: "text",
              text: "Safe visible text",
              marks: [
                { type: "link", attrs: { href: "javascript:alert(1)" } },
                { type: "bold" },
              ],
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(doc)).not.toContain("javascript:");
    expect(JSON.stringify(doc)).not.toContain("onclick");
    expect(JSON.stringify(doc)).not.toContain("data:text/html");
    expect(doc.content?.[1].content?.[0].marks).toEqual([{ type: "bold" }]);
  });
  it("renders a validated structure even when nested stored values are malformed", () => {
    const malformed = {
      type: "doc",
      content: [
        null,
        { type: "paragraph", content: "not a child list" },
        {
          type: "text",
          text: { unexpected: "not visible text" },
          marks: [null, { type: "bold" }],
        },
        { type: "text", text: "plain", marks: "not a mark list" },
      ],
    };
    expect(normalizedDocument(malformed as unknown as JSONContent)).toEqual({
      type: "doc",
      content: [
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "text", text: "", marks: [{ type: "bold" }] },
        { type: "text", text: "plain" },
      ],
    });
  });
  it("permits explicit safe protocols and internal paths but rejects protocol-relative and control/backslash URLs", () => {
    for (const link of [
      "https://example.invalid",
      "http://example.invalid",
      "mailto:team@example.invalid",
      "/wiki?page=demo",
    ])
      expect(safeLink(link)).toBe(true);
    for (const link of [
      "//external.invalid",
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "https:\\external.invalid",
      "https://example.invalid\n",
    ])
      expect(safeLink(link)).toBe(false);
  });
  it("keeps empty drafts separate from publishable content and enforces size limits", () => {
    const empty = { type: "doc", content: [{ type: "paragraph" }] };
    expect(contentIsValid(empty, true)).toBe(true);
    expect(contentIsValid(empty)).toBe(false);
    expect(
      contentIsValid({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(40001) }],
          },
        ],
      }),
    ).toBe(false);
  });
});
