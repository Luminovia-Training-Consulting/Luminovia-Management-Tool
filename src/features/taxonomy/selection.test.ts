/**
 * Regressions for active options and retaining already referenced archived topics. Pure
 * selection tests do not replace native taxonomy access checks.
 */
import { describe, expect, it } from "vitest";
import { selectableTopics } from "./selection";
describe("active taxonomy choices and historical removals", () => {
  it("excludes new archived options while retaining a selected archived identity", () => {
    const active = { id: "active", archived_at: null },
      retained = { id: "old", archived_at: "2026-01-01" },
      hidden = { id: "other-old", archived_at: "2026-01-01" };
    const all = [active, retained, hidden];
    expect(selectableTopics(all, ["old"])).toEqual([active, retained]);
    expect(all).toHaveLength(3);
    expect(selectableTopics(all, ["old"])[1]).toBe(retained);
  });
  it("removes the archived option after explicit deselection, keeping legacy active fixtures", () => {
    expect(
      selectableTopics(
        [
          { id: "legacy-active" },
          { id: "archived", archived_at: "2026-01-01" },
        ],
        [],
      ),
    ).toEqual([{ id: "legacy-active" }]);
  });
});
