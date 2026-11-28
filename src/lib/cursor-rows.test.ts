import { expect, it } from "vitest";
import { mergeCursorItems, orderedCursorRows } from "./cursor-rows";

it("retains the first version of overlapping rows and sorts ties consistently in either direction", () => {
  const early = {
    id: "c",
    created_at: "2026-11-22T08:00:00Z",
    text: "earliest",
  };
  const left = {
    id: "a",
    created_at: "2026-11-23T08:00:00Z",
    text: "recent edit",
  };
  const right = { id: "b", created_at: left.created_at, text: "same instant" };
  const pages = [
    [right, left],
    [{ ...left, text: "older edit" }, early],
  ];
  expect(orderedCursorRows(pages, "ascending")).toEqual([early, left, right]);
  expect(orderedCursorRows(pages, "descending")).toEqual([right, left, early]);
  expect(orderedCursorRows(undefined, "ascending")).toEqual([]);
});

it("orders mixed offsets and preserves microsecond precision across pages", () => {
  const left = { id: "a", created_at: "2026-11-23T09:00:00+01:00" };
  const right = { id: "b", created_at: "2026-11-23T08:00:00.000000Z" };
  const next = { id: "c", created_at: "2026-11-23T08:00:00.000001Z" };
  const last = { id: "d", created_at: "2026-11-23T08:00:00.00001Z" };
  const pages = [
    [last, next],
    [right, left],
  ];

  expect(orderedCursorRows(pages, "ascending")).toEqual([
    left,
    right,
    next,
    last,
  ]);
  expect(orderedCursorRows(pages, "descending")).toEqual([
    last,
    next,
    right,
    left,
  ]);
});

it("merges overlapping pages without moving keys and can separate equal IDs from different kinds", () => {
  const newest = { id: "a", kind: "files", title: "New" };
  const replaced = { ...newest, title: "Old" };
  const otherKind = { ...newest, kind: "jobs", title: "Offer" };
  const last = { id: "b", kind: "files", title: "Second file" };
  const pages = [{ items: [newest, otherKind] }, { items: [last, replaced] }];

  expect(mergeCursorItems(pages)).toEqual([newest, last]);
  expect(mergeCursorItems(pages, { preferLast: true })).toEqual([
    replaced,
    last,
  ]);
  expect(
    mergeCursorItems(pages, { key: (row) => `${row.kind}:${row.id}` }),
  ).toEqual([newest, otherKind, last]);
  expect(mergeCursorItems(undefined)).toEqual([]);
});
