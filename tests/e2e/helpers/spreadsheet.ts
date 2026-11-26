/** Author one literal cell in a downloaded fictional test workbook. */
import { expect } from "@playwright/test";
import {
  TextReader,
  TextWriter,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";

export async function fillWorkbookCell(
  template: Uint8Array,
  cell: "E2" | "F2",
  score: number,
  learnerId: string,
) {
  const source = new ZipReader(new Uint8ArrayReader(template));
  const edited = new ZipWriter(new Uint8ArrayWriter());
  const worksheet = "xl/worksheets/sheet1.xml";
  let changed = false;
  try {
    for (const entry of await source.getEntries()) {
      if (entry.directory) continue;
      let xml = await entry.getData(new TextWriter());
      if (entry.filename === worksheet) {
        expect(xml).toContain(learnerId);
        const blank = new RegExp(`<c r="${cell}"[^>]*>[\\s\\S]*?<\\/c>`);
        expect(xml).toMatch(blank);
        xml = xml.replace(blank, `<c r="${cell}"><v>${score}</v></c>`);
        changed = true;
      }
      await edited.add(entry.filename, new TextReader(xml));
    }
    expect(changed).toBe(true);
    return Buffer.from(await edited.close());
  } finally {
    await source.close();
  }
}
