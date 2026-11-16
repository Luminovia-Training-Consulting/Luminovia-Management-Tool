import { createCalendarFeedHandler, renderCalendar } from "./handler.ts";
const token = "a".repeat(64),
  item = {
    id: "bb1f0c6e-1c6c-4f3d-adc5-a374e60dcd97",
    kind: "assignment" as const,
    title: "Fictional ä course",
    starts_at: "2026-10-25T00:30:00Z",
    ends_at: "2026-10-25T01:30:00Z",
    time_zone: "Europe/Berlin",
  };
const assert = (value: unknown, message = "Assertion failed") => {
  if (!value) throw new Error(message);
};
Deno.test("subscription request hashes capability, emits private UTC calendar, and rechecks access", async () => {
  const calls: string[] = [];
  let hash = "";
  const handler = createCalendarFeedHandler({
    snapshot: async (value) => {
      calls.push("read");
      hash = value;
      return { label: "Fictional calendar", items: [item] };
    },
    recheck: async (value) => {
      assert(value === hash);
      calls.push("recheck");
      return true;
    },
  });
  const response = await handler(
    new Request("https://example.invalid/calendar-feed?token=" + token),
  );
  assert(response.status === 200);
  assert(calls.join(",") === "read,recheck");
  assert(hash !== token && /^[0-9a-f]{64}$/.test(hash));
  assert(response.headers.get("cache-control")?.includes("no-store"));
  const body = await response.text();
  assert(body.includes("DTSTART:20261025T003000Z"));
  assert(body.includes("DTEND:20261025T013000Z"));
  assert(!body.includes(token));
  assert(!body.includes("ORGANIZER"));
  assert(!body.includes("METHOD:PUBLISH"));
});
Deno.test("revocation after snapshot prevents late confidential response", async () => {
  const handler = createCalendarFeedHandler({
    snapshot: async () => ({ label: "Private", items: [item] }),
    recheck: async () => false,
  });
  const response = await handler(
    new Request("https://example.invalid/calendar-feed?token=" + token),
  );
  assert(response.status === 404);
  assert(!(await response.text()).includes(item.title));
});
Deno.test("invalid, duplicated or unrecognized capability query never reaches database", async () => {
  let calls = 0;
  const handler = createCalendarFeedHandler({
    snapshot: async () => {
      calls++;
      return null;
    },
    recheck: async () => false,
  });
  for (
    const path of [
      "",
      "?token=short",
      "?token=" + token + "&token=" + token,
      "?token=" + token + "&extra=1",
    ]
  ) {
    assert(
      (await handler(new Request("https://example.invalid/feed" + path)))
        .status === 404,
    );
  }
  assert(calls === 0);
  assert(
    (await handler(
      new Request("https://example.invalid/feed?token=" + token, {
        method: "POST",
      }),
    )).status === 405,
  );
});
Deno.test("unavailable data/errors stay generic and do not expose token or content", async () => {
  for (const kind of ["missing", "error"]) {
    const handler = createCalendarFeedHandler({
      snapshot: async () => {
        if (kind === "error") throw new Error(token);
        return null;
      },
      recheck: async () => false,
    });
    const response = await handler(
      new Request("https://example.invalid/feed?token=" + token),
    );
    assert(response.status === 404);
    assert(await response.text() === "calendar_unavailable");
  }
});
Deno.test("calendar escaping and UTF8 folding prevent authored property injection", () => {
  const content = renderCalendar({
    label: "Calendar\r\nBEGIN:VEVENT",
    items: [{
      ...item,
      title: "👩‍🏫 ä ".repeat(100) + ",;\\\r\nATTENDEE:foreign@example.invalid",
    }],
  });
  assert(
    content.split("\r\n").every((line) =>
      new TextEncoder().encode(line).length <= 75
    ),
  );
  const unfolded = content.replace(/\r\n /g, "");
  assert(
    unfolded.split("\r\n").filter((line) => line === "BEGIN:VEVENT").length ===
      1,
  );
  assert(!unfolded.includes("\r\nATTENDEE:"));
});
