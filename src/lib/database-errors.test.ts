import { expect, it } from "vitest";
import { isDatabasePermissionDenied } from "./database-errors";

it("accepts the database denial code without treating session, transport or validation errors as access denial", () => {
  expect(isDatabasePermissionDenied({ code: "42501" })).toBe(true);
  expect(
    isDatabasePermissionDenied(
      Object.assign(new Error("response"), { code: "42501" }),
    ),
  ).toBe(true);
  for (const error of [
    null,
    undefined,
    "42501",
    { code: 42501 },
    { code: "PGRST301" },
    new Error("42501"),
  ]) {
    expect(isDatabasePermissionDenied(error)).toBe(false);
  }
});
