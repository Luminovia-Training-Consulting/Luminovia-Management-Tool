/** Run potentially expensive recurrence expansion in a cancellable browser worker. */
import type { ImportedAppointment, parseCalendarImport } from "./import-ical";

export type CalendarImportInput = Parameters<typeof parseCalendarImport>;
export type CalendarImportReply =
  { appointments: ImportedAppointment[] } | { error: string };

export async function previewCalendarImport(
  input: CalendarImportInput,
  signal: AbortSignal,
): Promise<ImportedAppointment[]> {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("./import-ical.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  let cancel: (() => void) | undefined;
  try {
    return await new Promise((resolve, reject) => {
      cancel = () => reject(signal.reason);
      signal.addEventListener("abort", cancel, { once: true });
      worker.onmessage = ({ data }: MessageEvent<CalendarImportReply>) => {
        if ("appointments" in data) resolve(data.appointments);
        else reject(new Error(data.error));
      };
      worker.onerror = () => reject(new Error("invalid_file"));
      worker.onmessageerror = () => reject(new Error("invalid_file"));
      worker.postMessage(input);
    });
  } finally {
    if (cancel) signal.removeEventListener("abort", cancel);
    worker.terminate();
  }
}
