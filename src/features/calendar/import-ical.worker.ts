/** Parse locally selected calendar content without blocking the browser UI. */
import { parseCalendarImport } from "./import-ical";
import type {
  CalendarImportInput,
  CalendarImportReply,
} from "./import-ical-preview";

globalThis.addEventListener(
  "message",
  ({ data }: MessageEvent<CalendarImportInput>) => {
    let reply: CalendarImportReply;
    try {
      reply = { appointments: parseCalendarImport(...data) };
    } catch (error) {
      reply = {
        error: error instanceof Error ? error.message : "invalid_file",
      };
    }
    globalThis.postMessage(reply);
  },
);
