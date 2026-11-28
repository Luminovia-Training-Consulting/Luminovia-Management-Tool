import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CalendarImport } from "./import";
import { parseCalendarImport } from "./import-ical";
import type {
  CalendarImportInput,
  CalendarImportReply,
} from "./import-ical-preview";

const processFile =
  vi.fn<(input: CalendarImportInput) => Promise<CalendarImportReply>>();
const terminate = vi.fn();

class TestCalendarWorker {
  onmessage?: (event: { data: CalendarImportReply }) => void;
  postMessage(input: CalendarImportInput) {
    void processFile(input).then((data) => this.onmessage?.({ data }));
  }
  terminate = terminate;
}

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(async () => {
  await i18n.changeLanguage("de");
  rpc.mockReset();
  terminate.mockClear();
  vi.stubGlobal("Worker", TestCalendarWorker);
  processFile.mockReset().mockImplementation(async (input) => {
    try {
      return { appointments: parseCalendarImport(...input) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "invalid_file" };
    }
  });
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
  fireEvent.change(screen.getByLabelText("Termine ab"), {
    target: { value: "2040-01-01" },
  });
  fireEvent.change(screen.getByLabelText("Termine bis (einschließlich)"), {
    target: { value: "2040-01-01" },
  });
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
it("clears a previous window error when the user edits the dates", async () => {
  const { user } = await setup(content.replaceAll("20400101", "20400102"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Im gewählten Zeitraum beginnen keine Termine.",
  );
  fireEvent.change(screen.getByLabelText("Termine bis (einschließlich)"), {
    target: { value: "2040-01-02" },
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("Fiktiver Testtermin")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Vorschau aktualisieren" }),
  );
  expect(await screen.findByText("Fiktiver Testtermin")).toBeVisible();
  expect(rpc).not.toHaveBeenCalled();
});

it("terminates a pending import when the calendar is dismissed", async () => {
  processFile.mockReturnValue(new Promise(() => undefined));
  await setup();
  expect(processFile).toHaveBeenCalledWith([
    content,
    "Europe/Berlin",
    "2040-01-01",
    "2040-01-01",
    expect.any(String),
  ]);
  expect(terminate).not.toHaveBeenCalled();
  cleanup();
  await waitFor(() => expect(terminate).toHaveBeenCalledOnce());
  expect(rpc).not.toHaveBeenCalled();
});
