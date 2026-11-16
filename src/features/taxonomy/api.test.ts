/**
 * Vitest-Regressionen für Aliasvalidierung, Akteurscache und echte Request-Abbruchweitergabe. Lokale SDK-/DOM-Fixtures isolieren den Browservertrag; echte Datenbank-/API-Abnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { describe, expect, it, vi } from "vitest";
import { taxonomyPayload, taxonomyQuery } from "./api";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const values = {
  label_de: " Thema ",
  label_en: " Topic ",
  kind: "topic" as const,
  parent_id: "",
  aliases: " Alias, alias, Zweites ",
  description_de: "",
  description_en: "",
};
describe("shared taxonomy form contract", () => {
  it("normalizes search aliases and roots without treating labels as authority", () => {
    expect(taxonomyPayload(values)).toEqual({
      ...values,
      label_de: "Thema",
      label_en: "Topic",
      parent_id: null,
      aliases: ["alias", "Zweites"],
    });
  });
  it("rejects control text and excessive aliases or labels before sending a mutation", () => {
    expect(() =>
      taxonomyPayload({ ...values, label_de: "bad\u0000label" }),
    ).toThrow();
    expect(() =>
      taxonomyPayload({ ...values, aliases: "bad\nname" }),
    ).toThrow();
    expect(() =>
      taxonomyPayload({
        ...values,
        aliases: Array.from({ length: 21 }, (_, index) => `alias${index}`).join(
          ",",
        ),
      }),
    ).toThrow();
    expect(() => taxonomyPayload({ ...values, label_en: " " })).toThrow();
  });
  it("isolates catalogue keys by actor and forwards actual cancellation to the SDK", async () => {
    const abortSignal = vi.fn().mockResolvedValue({ data: [], error: null });
    rpc.mockReturnValue({ abortSignal });
    const a = taxonomyQuery("actor-a", "alias", "tool", true),
      b = taxonomyQuery("actor-b", "alias", "tool", true);
    expect(a.queryKey).not.toEqual(b.queryKey);
    const signal = new AbortController().signal;
    await a.queryFn!({ signal } as never);
    expect(rpc).toHaveBeenCalledWith("taxonomy_catalogue", {
      p_search: "alias",
      p_kind: "tool",
      p_include_archived: true,
    });
    expect(abortSignal).toHaveBeenCalledWith(signal);
  });
});
