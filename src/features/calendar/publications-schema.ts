/** Wire schemas for published calendar windows and managed event receipts. */
import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

const instant = z.string().datetime({ offset: true });

export function validEventLink(value: string) {
  if (!value) return true;
  if (
    value.length > 2000 ||
    [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127) ||
    /[\\]/.test(value) ||
    !/^https:\/\/[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?([/?#].*)?$/.test(
      value,
    )
  )
    return false;
  const host = /^https:\/\/([^/:?#]+)/.exec(value)![1];
  if (
    host.length > 253 ||
    host
      .split(".")
      .some(
        (label) =>
          label.length > 63 ||
          !/^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
      )
  )
    return false;
  if (
    /^[0-9.]+$/.test(host) &&
    (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) ||
      host.split(".").some((part) => Number(part) > 255))
  )
    return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      Boolean(url.hostname) &&
      url.port !== "0"
    );
  } catch {
    return false;
  }
}

export const globalEventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  link_url: z.string().refine(validEventLink),
  starts_at: instant,
  ends_at: instant,
  time_zone: z.string().refine(validZone),
  published: z.boolean(),
  archived_at: instant.nullable(),
  version: z.number().int().positive(),
  updated_at: instant,
});
export type GlobalEvent = z.infer<typeof globalEventSchema>;
const cursor = z.object({ at: instant, id: z.uuid() });

/** A continuation always points to a row on the current, nonempty page. */
export const globalEventsPageSchema = z.discriminatedUnion("has_more", [
  z.object({
    items: z.array(globalEventSchema).min(1).max(100),
    has_more: z.literal(true),
    next_cursor: cursor,
  }),
  z.object({
    items: z.array(globalEventSchema).max(100),
    has_more: z.literal(false),
    next_cursor: z.null(),
  }),
]);
