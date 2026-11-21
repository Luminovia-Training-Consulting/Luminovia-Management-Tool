/** Rich-text input and stored content accepted by private.validate_knowledge_node. */
const string = { type: "string" };
const empty = record({});
const noItems = list(false, 0);
const component = (name: string) => ({
  $ref: "#/components/schemas/" + name,
});
const text = component("KnowledgeText");
const paragraph = component("KnowledgeParagraph");
const block = component("KnowledgeBlock");
const listItem = component("KnowledgeListItem");

function record(
  properties: Record<string, object>,
  required = Object.keys(properties),
) {
  return { type: "object", properties, required, additionalProperties: false };
}

function list(items: object | false, maxItems = 1499) {
  return { type: "array", items, maxItems };
}

function contentNode(type: string, content: object, attrs = empty) {
  return record({ type: { const: type }, attrs, marks: noItems, content }, [
    "type",
  ]);
}

const inline = list({ anyOf: [text, contentNode("hardBreak", noItems)] });
const blocks = list(block);
const headingAttributes = record({ level: { enum: [1, 2, 3] } });
const codeAttributes = record(
  {
    language: {
      anyOf: [
        { ...string, pattern: "^[a-zA-Z0-9_+\\-]{0,30}$" },
        { type: "null" },
      ],
    },
  },
  [],
);
const orderedListAttributes = record(
  {
    start: { type: "integer", minimum: 1, maximum: 1000000 },
    type: { enum: ["1", "a", "A", "i", "I", null] },
  },
  [],
);
const linkAttributes = record(
  {
    href: {
      ...string,
      maxLength: 2000,
      pattern:
        "^(?:[Hh][Tt][Tt][Pp][Ss]?://|[Mm][Aa][Ii][Ll][Tt][Oo]:|/(?!/))[^\\u0000-\\u001f\\u007f\\\\]*$",
    },
    target: { enum: ["_blank", "_self", null] },
    rel: {
      enum: ["noopener noreferrer", "noopener noreferrer nofollow", null],
    },
    class: { type: "null" },
  },
  ["href"],
);
const mark = {
  oneOf: [
    record(
      {
        type: { enum: ["bold", "italic", "underline", "strike", "code"] },
        attrs: empty,
      },
      ["type"],
    ),
    record({ type: { const: "link" }, attrs: linkAttributes }),
  ],
};

export const knowledgeSchemas = {
  KnowledgeDocument: {
    ...contentNode("doc", blocks),
    description:
      "Structured editor document with at most 1500 nodes, depth 16, 40000 text characters and 200000 serialized bytes. The server applies these whole-document bounds and validates links.",
  },
  KnowledgeText: record(
    {
      type: { const: "text" },
      text: { ...string, maxLength: 40000 },
      attrs: empty,
      marks: list(mark, 6),
    },
    ["type", "text"],
  ),
  KnowledgeParagraph: contentNode("paragraph", inline),
  KnowledgeListItem: contentNode("listItem", {
    ...blocks,
    prefixItems: [paragraph],
  }),
  KnowledgeBlock: {
    oneOf: [
      paragraph,
      {
        ...contentNode("heading", inline, headingAttributes),
        required: ["type", "attrs"],
      },
      contentNode("bulletList", list(listItem)),
      contentNode("orderedList", list(listItem), orderedListAttributes),
      contentNode("blockquote", blocks),
      contentNode("codeBlock", list(text), codeAttributes),
      contentNode("horizontalRule", noItems),
    ],
  },
};

export const knowledgeDocument = component("KnowledgeDocument");
