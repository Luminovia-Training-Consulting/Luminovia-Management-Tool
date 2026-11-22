/** Verify that browser activation failure still releases the temporary download resources. */
import { afterEach, expect, it, vi } from "vitest";
import { saveBlob } from "./blob-download";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("removes the link and revokes its URL when download activation throws", async () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:fictional-download";
      static revokeObjectURL = revoke;
    },
  );
  const failure = new Error("Download activation failed");
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.isConnected).toBe(true);
    throw failure;
  });

  expect(() => saveBlob(new Blob(["Fictional data"]), "report.csv")).toThrow(
    failure,
  );
  expect(document.querySelector('a[download="report.csv"]')).toBeNull();
  expect(revoke).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:fictional-download");
});
