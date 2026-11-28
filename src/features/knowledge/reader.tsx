import {
  Fragment,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { JSONContent } from "@tiptap/react";
import { maxHighlightLength, normalizedDocument } from "./content";
import type { highlightCode } from "./knowledge-syntax";

const CodeText = memo(function CodeText({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [highlight, setHighlight] = useState<typeof highlightCode>();
  const shouldHighlight =
    code.length > 0 &&
    code.length <= maxHighlightLength &&
    language !== "plaintext";
  useEffect(() => {
    if (!shouldHighlight) return;
    let active = true;
    void import("./knowledge-syntax")
      .then(({ highlightCode: render }) => {
        if (active) setHighlight(() => render);
      })
      // A missing optional chunk must leave the original text readable.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [shouldHighlight]);
  const rendered = useMemo(
    () => (shouldHighlight && highlight ? highlight(language, code) : code),
    [code, highlight, language, shouldHighlight],
  );
  return (
    <pre data-language={language}>
      <code className={`language-${language}`}>{rendered}</code>
    </pre>
  );
});

function renderText(node: JSONContent) {
  return (node.marks ?? []).reduceRight<ReactNode>((text, mark) => {
    switch (mark.type) {
      case "bold":
        return <strong>{text}</strong>;
      case "italic":
        return <em>{text}</em>;
      case "strike":
        return <s>{text}</s>;
      case "code":
        return <code>{text}</code>;
      case "link":
        return (
          <a href={mark.attrs?.href} target="_blank" rel="noopener noreferrer">
            {text}
          </a>
        );
      default:
        return text;
    }
  }, node.text);
}

function renderNode(node: JSONContent): ReactNode {
  if (node.type === "text") return renderText(node);
  if (node.type === "codeBlock")
    return (
      <CodeText
        code={node.content?.map(({ text }) => text ?? "").join("") ?? ""}
        language={node.attrs?.language || "plaintext"}
      />
    );
  const children = node.content?.map((child, index) => (
    <Fragment key={index}>{renderNode(child)}</Fragment>
  ));
  switch (node.type) {
    case "paragraph":
      return <p>{children}</p>;
    case "heading": {
      const tag =
        node.attrs?.level === 1 ? "h1" : node.attrs?.level === 3 ? "h3" : "h2";
      const Heading = tag;
      return <Heading>{children}</Heading>;
    }
    case "bulletList":
      return <ul>{children}</ul>;
    case "orderedList":
      return <ol>{children}</ol>;
    case "listItem":
      return <li>{children}</li>;
    case "blockquote":
      return <blockquote>{children}</blockquote>;
    case "hardBreak":
      return <br />;
    case "horizontalRule":
      return <hr />;
    default:
      return children;
  }
}

/** Read normalized knowledge JSON without initializing an editor or accepting raw HTML. */
export const KnowledgeDocument = memo(function KnowledgeDocument({
  value,
  label,
}: {
  value: JSONContent;
  label: string;
}) {
  const contents = useMemo(
    () => renderNode(normalizedDocument(value)),
    [value],
  );
  return (
    <div className="knowledge-editor knowledge-readonly">
      <article className="knowledge-prose" aria-label={label}>
        {contents}
      </article>
    </div>
  );
});
