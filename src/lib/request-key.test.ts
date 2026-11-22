import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useRequestKey } from "./request-key";

afterEach(cleanup);

it("keeps uncertain retries stable across renders and rotates for changed or cleared input", () => {
  const request = renderHook(() => useRequestKey());
  const original = request.result.current.forInput("reviewed input");
  request.rerender();
  expect(request.result.current.forInput("reviewed input")).toBe(original);
  const edited = request.result.current.forInput("changed input");
  expect(edited).not.toBe(original);
  expect(request.result.current.forInput("changed input")).toBe(edited);
  request.result.current.clear();
  expect(request.result.current.forInput("changed input")).not.toBe(edited);
});

it("keeps the same input in independent forms bound to different requests", () => {
  const first = renderHook(() => useRequestKey());
  const second = renderHook(() => useRequestKey());
  expect(first.result.current.forInput("same input")).not.toBe(
    second.result.current.forInput("same input"),
  );
});
