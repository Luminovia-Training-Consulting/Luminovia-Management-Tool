/**
 * Tiptap editing/read views with bounded extensions and code highlighting. Content passes shared
 * normalization; raw unvalidated HTML is not introduced as a storage format.
 */
import { useState } from "react";
import {
  EditorContent,
  type JSONContent,
  useEditor,
  useEditorState,
} from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import {
  Bold,
  Braces,
  Code2,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Notice } from "../../components/common";
import { emptyDocument, normalizedDocument, safeLink } from "./content";
import "./i18n";

/** Shared syntax highlighting for the explicitly loaded code languages. */
const lowlight = createLowlight(common);
/** Bound editor extensions to the normalized storage contract. */
const extensions = [
  StarterKit.configure({
    codeBlock: false,
    underline: false,
    heading: { levels: [1, 2, 3] },
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      protocols: ["http", "https", "mailto"],
      isAllowedUri: (url) => safeLink(url),
      HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
    },
  }),
  CodeBlockLowlight.extend({
    renderHTML({ node, HTMLAttributes }) {
      return [
        "pre",
        {
          ...HTMLAttributes,
          "data-language": node.attrs.language || "plaintext",
        },
        [
          "code",
          { class: `language-${node.attrs.language || "plaintext"}` },
          0,
        ],
      ];
    },
  }).configure({ lowlight, defaultLanguage: "plaintext" }),
];

/** Bind Tiptap to controlled normalized content with the same contract for reading and editing. */
export function KnowledgeEditor({
  value,
  onChange,
  label,
  disabled = false,
  readOnly = false,
}: {
  value: JSONContent;
  onChange?: (content: JSONContent) => void;
  label: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation("knowledge");
  const commonText = useTranslation().t;
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState("");
  const [badLink, setBadLink] = useState(false);
  const editor = useEditor({
    extensions,
    content: normalizedDocument(value ?? emptyDocument),
    editable: !disabled && !readOnly,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: readOnly ? "article" : "textbox",
        "aria-label": label,
        ...(readOnly ? {} : { "aria-multiline": "true" }),
        class: "knowledge-prose",
      },
    },
    // JSON produced by the editor passes through the same allowlist
    // as loaded content; extensions must not silently expand the storage contract.
    onUpdate: ({ editor }) => onChange?.(normalizedDocument(editor.getJSON())),
  });
  // Observe only toolbar attributes needed by React instead of rerendering
  // the entire editor tree for every transaction.
  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      strike: editor?.isActive("strike") ?? false,
      heading: editor?.isActive("heading") ?? false,
      bullet: editor?.isActive("bulletList") ?? false,
      ordered: editor?.isActive("orderedList") ?? false,
      quote: editor?.isActive("blockquote") ?? false,
      code: editor?.isActive("codeBlock") ?? false,
      inlineCode: editor?.isActive("code") ?? false,
      language: editor?.getAttributes("codeBlock").language as
        string | undefined,
    }),
  });
  return (
    <div className={`knowledge-editor ${readOnly ? "knowledge-readonly" : ""}`}>
      {!readOnly && (
        <div
          className="knowledge-toolbar"
          role="toolbar"
          aria-label={t("toolbar")}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("bold")}
            aria-pressed={active?.bold}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("italic")}
            aria-pressed={active?.italic}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("strike")}
            aria-pressed={active?.strike}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            <Strikethrough size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("heading")}
            aria-pressed={active?.heading}
            disabled={!editor || disabled}
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            <Heading2 size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("bulletList")}
            aria-pressed={active?.bullet}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("orderedList")}
            aria-pressed={active?.ordered}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("quote")}
            aria-pressed={active?.quote}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("inlineCode")}
            aria-pressed={active?.inlineCode}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleCode().run()}
          >
            <Braces size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("code")}
            aria-pressed={active?.code}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          >
            <Code2 size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("link")}
            disabled={!editor || disabled}
            onClick={() => {
              setBadLink(false);
              setHref(editor?.getAttributes("link").href ?? "");
              setLinkOpen(true);
            }}
          >
            <Link2 size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("undo")}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 size={17} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("redo")}
            disabled={!editor || disabled}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 size={17} />
          </Button>
          {active?.code && (
            <label className="knowledge-code-language">
              {t("codeLanguage")}
              <select
                value={active.language ?? "plaintext"}
                onChange={(event) =>
                  editor
                    ?.chain()
                    .focus()
                    .updateAttributes("codeBlock", {
                      language: event.target.value,
                    })
                    .run()
                }
                disabled={disabled}
              >
                {[
                  "plaintext",
                  "javascript",
                  "typescript",
                  "python",
                  "bash",
                  "sql",
                  "java",
                  "css",
                  "json",
                  "html",
                ].map((language) => (
                  <option key={language} value={language}>
                    {language}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      <EditorContent editor={editor} />
      {!readOnly && (
        <small className="knowledge-editor-help">{t("editorHelp")}</small>
      )}
      <Dialog
        open={linkOpen}
        onOpenChange={setLinkOpen}
        title={t("link")}
        description={t("linkHint")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!safeLink(href)) {
              setBadLink(true);
              return;
            }
            editor
              ?.chain()
              .focus()
              .extendMarkRange("link")
              .setLink({ href, target: "_blank", rel: "noopener noreferrer" })
              .run();
            setLinkOpen(false);
          }}
        >
          <Field id="knowledge-link-href" label={t("linkHref")} error={badLink}>
            <input
              id="knowledge-link-href"
              value={href}
              onChange={(event) => setHref(event.target.value)}
              maxLength={2000}
            />
          </Field>
          <div className="form-actions">
            <Button>{commonText("save")}</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                editor?.chain().focus().unsetLink().run();
                setLinkOpen(false);
              }}
            >
              {t("linkRemove")}
            </Button>
          </div>
          {badLink && <Notice kind="error">{t("linkInvalid")}</Notice>}
        </form>
      </Dialog>
    </div>
  );
}
