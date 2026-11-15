import { describe, expect, it } from "vitest";
import { labelText } from "./api";
describe("self-authored profile labels", () => {
  it("normalizes labels without treating role-like authored text as authority", () => {
    expect(labelText(" Python, mentoring, python, Administrator ")).toEqual([
      "python",
      "mentoring",
      "Administrator",
    ]);
  });
  it("rejects excess/control labels rather than dropping content silently", () => {
    expect(() =>
      labelText(Array.from({ length: 21 }, (_, i) => `label${i}`).join(",")),
    ).toThrow();
    expect(() => labelText("bad\u0000label")).toThrow();
    expect(() => labelText("x".repeat(41))).toThrow();
  });
});
