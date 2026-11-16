/**
 * Gezielt gebaute Office-ZIP-Fixtures prüfen erlaubte Formate und den byteweisen VBA-Markerfilter. Die Fixture beschreibt Dateistruktur, ohne echte Kundenunterlagen zu verwenden.
 */
import { validateFile } from "./validation.ts";

// Lässt eine konkrete Fixturebedingung als echten Testfehler scheitern; es gibt keinen stillen Erfolgsersatz.
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

const encoder = new TextEncoder();
const formats = [
  [
    "docx",
    "word/document.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [
    "xlsx",
    "xl/workbook.xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [
    "pptx",
    "ppt/presentation.xml",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
] as const;

/** Real stored ZIP local/central records and CRCs keep the MIME detector in the
 * test path. These packages contain fictional content, never private files. */
// Baut die kontrollierte Office-ZIP-Struktur mit tatsächlichen Dateimarkern, statt einen MIME-String als Beweis zu verwenden.
function archive(
  format: typeof formats[number],
  extraName?: string,
  extraBytes = encoder.encode("fictional data"),
  comment = "",
): Uint8Array {
  const [, main, mime] = format;
  const entries = [
    [
      "[Content_Types].xml",
      encoder.encode(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${main}" ContentType="${mime}.main+xml"/></Types>`,
      ),
    ],
    [main, encoder.encode("<fictional>Lesson</fictional>")],
    ...(extraName ? [[extraName, extraBytes]] : []),
  ] as [string, Uint8Array][];
  const locals: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const filename = encoder.encode(name);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + filename.length + data.length);
    const header = new DataView(local.buffer);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, filename.length, true);
    local.set(filename, 30);
    local.set(data, 30 + filename.length);
    const central = new Uint8Array(46 + filename.length);
    const record = new DataView(central.buffer);
    record.setUint32(0, 0x02014b50, true);
    record.setUint16(4, 20, true);
    record.setUint16(6, 20, true);
    record.setUint32(16, crc, true);
    record.setUint32(20, data.length, true);
    record.setUint32(24, data.length, true);
    record.setUint16(28, filename.length, true);
    record.setUint32(42, offset, true);
    central.set(filename, 46);
    locals.push(local);
    directory.push(central);
    offset += local.length;
  }
  const directoryLength = directory.reduce(
    (size, entry) => size + entry.length,
    0,
  );
  const tail = new Uint8Array(22 + encoder.encode(comment).length);
  const end = new DataView(tail.buffer);
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, directoryLength, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, tail.length - 22, true);
  tail.set(encoder.encode(comment), 22);
  const result = new Uint8Array(offset + directoryLength + tail.length);
  let at = 0;
  for (const bytes of [...locals, ...directory, tail]) {
    result.set(bytes, at);
    at += bytes.length;
  }
  return result;
}

// Bestätigt, dass die konkrete Byte-/MIME-Fixture wirklich abgewiesen wird.
async function rejected(bytes: Uint8Array, format: typeof formats[number]) {
  let error: unknown;
  try {
    await validateFile(bytes, `fictional.${format[0]}`, format[2]);
  } catch (cause) {
    error = cause;
  }
  assert(error instanceof Error && error.message === "unsupported_type");
}

Deno.test("real non-macro OOXML ZIPs retain their allowed document MIME types", async () => {
  for (const format of formats) {
    assert(
      await validateFile(
        archive(format),
        `fictional.${format[0]}`,
        format[2],
      ) === format[2],
    );
  }
});

Deno.test("macro project names remain blocked for all allowed Office types and ASCII casing", async () => {
  for (const format of formats) {
    for (const name of ["vbaProject.bin", "VBAPROJECT.BIN", "vBaPrOjEcT.BiN"]) {
      await rejected(archive(format, `attachments/${name}`), format);
    }
  }
});

Deno.test("macro checks include the final bytes and do not mistake short prefixes for projects", async () => {
  const format = formats[0];
  await rejected(
    archive(format, undefined, undefined, "vBaPrOjEcT.BiN"),
    format,
  );
  assert(
    await validateFile(
      archive(format, undefined, undefined, "vbaProject.bi"),
      "fictional.docx",
      format[2],
    ) === format[2],
  );
});

Deno.test("macro checks preserve exact non-letter bytes and binary content", async () => {
  const format = formats[0];
  const bytes = archive(
    format,
    "word/media/fixture.bin",
    encoder.encode("vbaProject\u000eBIN and vbaProjectXbin"),
  );
  assert(await validateFile(bytes, "fictional.docx", format[2]) === format[2]);
});

Deno.test("Office packages cannot bypass declared MIME or extension checks", async () => {
  const bytes = archive(formats[0]);
  for (
    const [name, mime] of [["fictional.xlsx", formats[0][2]], [
      "fictional.docx",
      formats[1][2],
    ]]
  ) {
    let rejected = false;
    try {
      await validateFile(bytes, name, mime);
    } catch {
      rejected = true;
    }
    assert(rejected);
  }
});
