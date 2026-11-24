import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useOnline } from "./online";

afterEach(() => vi.restoreAllMocks());

it("shares browser listeners and updates all subscribers until they unmount", () => {
  let online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const add = vi.spyOn(window, "addEventListener");
  const remove = vi.spyOn(window, "removeEventListener");
  const first = renderHook(useOnline);
  const second = renderHook(useOnline);
  const network = (calls: { calls: Parameters<typeof add>[] }) =>
    calls.calls
      .map(([type]) => type)
      .filter((type) => type === "offline" || type === "online");

  expect(network(add.mock)).toEqual(["online", "offline"]);
  act(() => {
    online = false;
    window.dispatchEvent(new Event("offline"));
  });
  expect(first.result.current).toBe(false);
  expect(second.result.current).toBe(false);
  first.unmount();
  expect(network(remove.mock)).toEqual([]);
  act(() => {
    online = true;
    window.dispatchEvent(new Event("online"));
  });
  expect(second.result.current).toBe(true);
  second.unmount();
  expect(network(remove.mock)).toEqual(["online", "offline"]);
});
