import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import "../lib/i18n";
import { PwaInstallOffer } from "./pwa-install";

afterEach(cleanup);

function browserOffer() {
  const prompt = vi.fn(async () => undefined);
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    { prompt },
  );
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

const install = () =>
  screen.queryByRole("button", { name: /^(Install app|App installieren)$/ });

it("offers the native dialog only while available and consumes it once after a click", async () => {
  const { rerender } = render(<PwaInstallOffer enabled={false} />);
  const browser = browserOffer();
  expect(browser.event.defaultPrevented).toBe(true);
  expect(install()).toBeNull();
  rerender(<PwaInstallOffer enabled />);
  const button = install();
  expect(button).toBeVisible();
  expect(browser.prompt).not.toHaveBeenCalled();
  await userEvent.click(button!);
  expect(browser.prompt).toHaveBeenCalledTimes(1);
  expect(install()).toBeNull();
});

it("lets the user dismiss the offer and hides it after browser installation", async () => {
  render(<PwaInstallOffer enabled />);
  const first = browserOffer();
  await userEvent.click(
    screen.getByRole("button", { name: /^(Later|Später)$/ }),
  );
  expect(first.prompt).not.toHaveBeenCalled();
  expect(install()).toBeNull();
  const next = browserOffer();
  expect(install()).toBeVisible();
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
  expect(next.prompt).not.toHaveBeenCalled();
  expect(install()).toBeNull();
});
