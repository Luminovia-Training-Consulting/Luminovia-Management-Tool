/** Exercise foreground and reconnect events independently of a browser's background timers. */
import { afterEach, expect, it, vi } from "vitest";
import { watchPwaUpdates } from "./pwa-update-check";

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function setup() {
  const visibility = vi.spyOn(document, "visibilityState", "get");
  const online = vi.spyOn(navigator, "onLine", "get");
  visibility.mockReturnValue("visible");
  online.mockReturnValue(true);
  const update = vi.fn().mockResolvedValue(undefined);
  const registration = { active: {}, waiting: null, installing: null, update };
  const offer = vi.fn();
  stop = watchPwaUpdates(
    registration as unknown as ServiceWorkerRegistration,
    offer,
  );
  return { visibility, online, registration, update, offer };
}

function foreground() {
  document.dispatchEvent(new Event("visibilitychange"));
}

it("checks an already installed app when it returns to the foreground or reconnects", async () => {
  vi.useFakeTimers();
  const { visibility, online, update } = setup();
  expect(update).not.toHaveBeenCalled();
  visibility.mockReturnValue("hidden");
  foreground();
  visibility.mockReturnValue("visible");
  online.mockReturnValue(false);
  foreground();
  expect(update).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  expect(update).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(59_999);
  foreground();
  expect(update).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  foreground();
  expect(update).toHaveBeenCalledTimes(2);
});

it("reoffers an installed waiting version without activating it", () => {
  const { registration, update, offer } = setup();
  Object.assign(registration, { waiting: {} });
  foreground();
  expect(offer).toHaveBeenCalledOnce();
  expect(update).not.toHaveBeenCalled();
});

it("handles a failed check and cleans up all subscriptions", async () => {
  vi.useFakeTimers();
  const { update, offer } = setup();
  update.mockRejectedValueOnce(new Error("Offline"));
  window.dispatchEvent(
    new PageTransitionEvent("pageshow", { persisted: true }),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  foreground();
  expect(update).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(60_000);
  stop?.();
  foreground();
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(
    new PageTransitionEvent("pageshow", { persisted: true }),
  );
  expect(update).toHaveBeenCalledTimes(2);
  expect(offer).not.toHaveBeenCalled();
});
