import { expect, it } from "vitest";
import { orderedCursorRows } from "./cursor-rows";

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
