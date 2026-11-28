import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { KnowledgeDocument } from "./reader";

it("reads allowed blocks and marks literally, highlights explicit code and preserves safe links", async () => {
  const code = 'if True:\n    print("<script>literal</script>")';
  const { container } = render(
    <KnowledgeDocument
      label="Example document"
      value={{
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Example heading" }],
          },
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Quarantined link",
                marks: [
                  { type: "link", attrs: { href: "javascript:alert(1)" } },
                ],
              },
              {
                type: "text",
                text: " Safe link",
                marks: [
                  { type: "link", attrs: { href: "/help" } },
                  { type: "bold" },
                ],
              },
            ],
          },
          {
            type: "codeBlock",
            attrs: { language: "python" },
            content: [{ type: "text", text: code }],
          },
          { type: "image", attrs: { src: "https://example.invalid/hidden" } },
        ],
      }}
    />,
  );
  const article = screen.getByRole("article", { name: "Example document" });
  expect(
    within(article).getByRole("heading", { name: "Example heading", level: 3 }),
  ).toBeVisible();
  expect(
    within(article).queryByRole("link", { name: "Quarantined link" }),
  ).toBeNull();
  expect(within(article).getByText("Quarantined link")).toBeVisible();
  const link = within(article).getByRole("link", { name: "Safe link" });
  expect(link).toHaveAttribute("href", "/help");
  expect(link).toHaveAttribute("rel", "noopener noreferrer");
  const block = container.querySelector('pre[data-language="python"]');
  expect(block?.textContent).toBe(code);
  await waitFor(() =>
    expect(block?.querySelector(".hljs-keyword")).toBeTruthy(),
  );
  expect(block?.textContent).toBe(code);
  expect(container.querySelector("script, img, [contenteditable]")).toBeNull();
});
