import { z } from "zod";

/** The finite server allowlist also supplies the bilingual category selector. */
export const searchKinds = [
  "jobs",
  "files",
  "wiki",
  "forum",
  "chats",
  "people",
  "courses",
  "clients",
  "contracts",
  "finance",
] as const;
const searchCursorSchema = z.object({
  kind: z.enum(searchKinds),
  title: z.string(),
  id: z.string().uuid(),
});
// Links stay inside the portal, including after browser backslash normalisation.
const resultSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(searchKinds),
  title: z.string(),
  detail: z.string(),
  url: z.string().regex(/^\/(?!\/)[^\u0000-\u0020\u007f\\]*$/),
});
export const unifiedSearchPageSchema = z
  .object({
    items: z.array(resultSchema).max(80),
    has_more: z.boolean(),
    next_cursor: searchCursorSchema.nullable(),
  })
  .refine((page) => !page.has_more || page.next_cursor !== null);
export type SearchCursor = z.infer<typeof searchCursorSchema>;
