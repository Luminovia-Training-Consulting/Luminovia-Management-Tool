import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CalendarImport } from "./import";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage("de");
  rpc.mockReset();
});
const content =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fictional-review\r\nDTSTART:20400101T090000Z\r\nDTEND:20400101T100000Z\r\nSUMMARY:Fiktiver Testtermin\r\nEND:VEVENT\r\nEND:VCALENDAR";

async function setup(source = content) {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CalendarImport actor="actor" zone="Europe/Berlin" />
    </QueryClientProvider>,
  );
  await user.click(screen.getByText("ICS-Datei importieren"));
  const file = new File([source], "fictional.ics", { type: "text/calendar" });
  Object.defineProperty(file, "text", { value: async () => source });
  await user.upload(
    screen.getByLabelText("Kalenderdatei (.ics, bis 2 MB)"),
    file,
  );
  return { user, client };
}

it("requires a reviewed file and explicit save, then invalidates the own calendar only after confirmation", async () => {
  rpc.mockResolvedValue({ data: { created: 1, skipped: 0 }, error: null });
  const { user, client } = await setup();
  await screen.findByText("Fiktiver Testtermin");
  expect(rpc).not.toHaveBeenCalled();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await user.click(screen.getByRole("button", { name: "Termine importieren" }));
  expect(
    await screen.findByText("1 Termine importiert, 0 bereits vorhanden."),
  ).toBeVisible();
  expect(rpc).toHaveBeenCalledWith("import_my_calendar", {
    p_events: [
      expect.objectContaining({
        title: "Fiktiver Testtermin",
        time_zone: "UTC",
      }),
    ],
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["events", "actor"] });
});
it("preserves the preview on database failure without claiming a partial import", async () => {
  rpc.mockResolvedValue({ data: null, error: new Error("overlap") });
  const { user } = await setup();
  await user.click(
    await screen.findByRole("button", { name: "Termine importieren" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Der Import wurde nicht bestätigt.",
  );
  expect(screen.getByText("Fiktiver Testtermin")).toBeVisible();
});
it("rejects malformed files before making any request", async () => {
  await setup("not a calendar");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Die Datei konnte nicht gelesen werden",
  );
  expect(
    screen.queryByRole("button", { name: "Termine importieren" }),
  ).not.toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
});
