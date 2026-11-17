/** Guest-only presentation follows explicit server role records, not an inferred missing permission. */
import { expect, it } from "vitest";
import { guestRouteAllowed, isGuestOnly } from "./guest-navigation";
it("requires explicit guest-only membership", () => {
  expect(isGuestOnly(["guest"])).toBe(true);
  for (const roles of [undefined, [], ["admin"], ["guest", "lecturer"]])
    expect(isGuestOnly(roles)).toBe(false);
});
it("keeps own settings and help while blocking operational routes", () => {
  for (const path of ["/profile", "/settings", "/wiki", "/help", "/profile/"])
    expect(guestRouteAllowed(path)).toBe(true);
  for (const path of [
    "/",
    "/jobs",
    "/chats",
    "/notifications",
    "/courses",
    "/admin",
    "/profile/other",
    "/support",
  ])
    expect(guestRouteAllowed(path)).toBe(false);
});
