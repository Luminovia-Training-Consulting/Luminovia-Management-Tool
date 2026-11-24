import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { LoadMore } from "./load-more";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("requests one batch per intersection and observes the next batch without replacing the button", async () => {
  const observers: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const load = vi.fn();
  const { rerender } = render(
    <LoadMore pageKey={24} onLoad={load}>
      More courses
    </LoadMore>,
  );
  const button = screen.getByRole("button", { name: "More courses" });
  const fire = (index: number, isIntersecting: boolean) =>
    act(() =>
      observers[index](
        [{ isIntersecting } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      ),
    );
  fire(0, false);
  expect(load).not.toHaveBeenCalled();
  fire(0, true);
  fire(0, true);
  expect(load).toHaveBeenCalledTimes(1);

  rerender(
    <LoadMore pageKey={48} onLoad={load}>
      More courses
    </LoadMore>,
  );
  expect(screen.getByRole("button")).toBe(button);
  fire(1, true);
  expect(load).toHaveBeenCalledTimes(2);
  await userEvent.click(button);
  expect(load).toHaveBeenCalledTimes(3);
});
