/** Shared spreadsheet serialization and downloads for authorized export rows. */
import { saveBlob } from "./blob-download";

/** Escape cell text, line breaks and formula prefixes to keep authored exports from becoming spreadsheet formulas. */
export function csvCell(value: unknown) {
  let text = String(value ?? "").replace(/[\r\n\t]/g, " ");
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Produce UTF-8 CSV with BOM, CRLF and the same safe escaping for every row. */
export function csvText(rows: unknown[][]) {
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/** Download the authorized export rows and release the temporary Blob URL afterwards. */
export function downloadCsv(filename: string, rows: unknown[][]) {
  saveBlob(
    new Blob([csvText(rows)], { type: "text/csv;charset=utf-8" }),
    filename,
  );
}
