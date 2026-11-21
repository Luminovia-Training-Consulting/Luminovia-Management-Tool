/** Reads a single-sheet XLSX attendance template locally, without evaluating workbook features. */
import { Uint8ArrayReader, ZipReader, type FileEntry } from "@zip.js/zip.js";
import type { AttendanceRow } from "./attendance-api";
import {
  AttendanceImportError,
  attendanceCsvHeader,
  maxAttendanceImportRows,
  validateAttendanceRows,
} from "./attendance-import";

const maxWorkbookBytes = 1_048_576;
const maxXmlBytes = 524_288;
const maxArchiveEntries = 128;
const namespace = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const strictNamespace = "http://purl.oclc.org/ooxml/spreadsheetml/main";
const relationships =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const strictRelationships =
  "http://purl.oclc.org/ooxml/officeDocument/relationships";

/** Extract one XML part through a fixed-size buffer and verify both bytes and ZIP signature. */
async function readXml(entry: FileEntry | undefined, root: string) {
  if (!entry || entry.encrypted || entry.uncompressedSize > maxXmlBytes) {
    throw new AttendanceImportError(1);
  }
  const bytes = new Uint8Array(entry.uncompressedSize);
  let offset = 0;
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        if (chunk.byteLength > bytes.length - offset) {
          throw new AttendanceImportError(1);
        }
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      },
    }),
    { checkSignature: true },
  );
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (offset !== bytes.length || /<!DOCTYPE/i.test(source)) {
    throw new AttendanceImportError(1);
  }
  const document = new DOMParser().parseFromString(source, "application/xml");
  const element = document.documentElement;
  if (element.localName !== root || document.querySelector("parsererror")) {
    throw new AttendanceImportError(1);
  }
  return element;
}

/** Take only direct elements belonging to the current XML part's namespace. */
function children(element: Element, name: string) {
  return Array.from(element.children).filter(
    (child) =>
      child.localName === name && child.namespaceURI === element.namespaceURI,
  );
}

/** Map a package relationship to a ZIP entry without dereferencing external targets. */
function partPath(rels: Element, source: string, type: string, id?: string) {
  if (
    rels.namespaceURI !==
      "http://schemas.openxmlformats.org/package/2006/relationships" &&
    rels.namespaceURI !== "http://purl.oclc.org/ooxml/package/relationships"
  ) {
    throw new AttendanceImportError(1);
  }
  const matches = children(rels, "Relationship").filter((rel) => {
    const value = rel.getAttribute("Type");
    return (
      (value === `${relationships}/${type}` ||
        value === `${strictRelationships}/${type}`) &&
      (id === undefined || rel.getAttribute("Id") === id)
    );
  });
  if (!matches.length) return undefined;
  const target = matches[0].getAttribute("Target");
  if (
    matches.length !== 1 ||
    matches[0].getAttribute("TargetMode") === "External" ||
    !target
  ) {
    throw new AttendanceImportError(1);
  }
  const archive = "https://workbook.invalid";
  const path = new URL(target, `${archive}/${source}`);
  if (path.origin !== archive || path.search || path.hash) {
    throw new AttendanceImportError(1);
  }
  return decodeURIComponent(path.pathname.slice(1));
}

/** Join single and rich-text runs without reading hidden phonetic annotations. */
function plainText(container: Element) {
  return Array.from(container.children)
    .filter((part) => part.namespaceURI === container.namespaceURI)
    .map((part) => {
      if (part.localName === "t") return part.textContent;
      return part.localName === "r" ? children(part, "t")[0]?.textContent : "";
    })
    .join("")
    .replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

/** Read only literal cells. Cached formula results cannot become attendance edits. */
function cellText(cell: Element, strings: string[], row: number) {
  if (children(cell, "f").length) throw new AttendanceImportError(row);
  const value = children(cell, "v")[0]?.textContent ?? "";
  switch (cell.getAttribute("t")) {
    case "s": {
      const text = strings[Number(value)];
      if (!/^\d+$/.test(value) || text === undefined)
        throw new AttendanceImportError(row);
      return text;
    }
    case "inlineStr": {
      const text = children(cell, "is")[0];
      return text ? plainText(text) : "";
    }
    case null:
    case "n":
    case "d":
    case "str":
      return value;
    case "b":
      if (value === "1") return "TRUE";
      if (value === "0") return "FALSE";
      throw new AttendanceImportError(row);
    default:
      throw new AttendanceImportError(row);
  }
}

/** Translate sparse worksheet cells into the same seven columns as the CSV template. */
function* worksheetRows(sheet: Element, strings: string[]) {
  const data = children(sheet, "sheetData")[0];
  if (!data) throw new AttendanceImportError(1);
  let previous = 0;
  for (const row of children(data, "row")) {
    const reference = row.getAttribute("r");
    if (reference !== null && !/^[1-9]\d*$/.test(reference)) {
      throw new AttendanceImportError(previous + 1);
    }
    const rowNumber = reference === null ? previous + 1 : Number(reference);
    if (
      !Number.isSafeInteger(rowNumber) ||
      rowNumber <= previous ||
      rowNumber > 1 + maxAttendanceImportRows
    ) {
      throw new AttendanceImportError(rowNumber);
    }
    previous = rowNumber;
    const columns: string[] = Array(7).fill("");
    let lastColumn = -1;
    for (const cell of children(row, "c")) {
      const reference = cell.getAttribute("r");
      const coordinate = reference?.match(/^([A-G])([1-9]\d*)$/);
      const column =
        reference === null
          ? lastColumn + 1
          : (coordinate?.[1].charCodeAt(0) ?? 0) - 65;
      if (
        column <= lastColumn ||
        column > 6 ||
        (coordinate && Number(coordinate[2]) !== rowNumber)
      ) {
        throw new AttendanceImportError(rowNumber);
      }
      lastColumn = column;
      columns[column] = cellText(cell, strings, rowNumber);
      if (columns[column].includes("\0"))
        throw new AttendanceImportError(rowNumber);
    }
    if (columns.some(Boolean)) yield { rowNumber, columns };
  }
}

/** Build a preview in memory. The caller still must confirm the ordinary versioned import RPC. */
export async function readAttendanceXlsx(file: File, current: AttendanceRow[]) {
  if (
    file.size > maxWorkbookBytes ||
    !file.name.toLowerCase().endsWith(".xlsx")
  ) {
    throw new AttendanceImportError(1);
  }
  const zip = new ZipReader(
    new Uint8ArrayReader(new Uint8Array(await file.arrayBuffer())),
    {
      useWebWorkers: false,
    },
  );
  try {
    const entries = new Map<string, FileEntry>();
    let count = 0;
    for await (const entry of zip.getEntriesGenerator()) {
      if (++count > maxArchiveEntries || entries.has(entry.filename)) {
        throw new AttendanceImportError(1);
      }
      if (!entry.directory) entries.set(entry.filename, entry);
    }
    const root = await readXml(entries.get("_rels/.rels"), "Relationships");
    const workbookPath = partPath(root, "", "officeDocument");
    if (!workbookPath) throw new AttendanceImportError(1);
    const workbook = await readXml(entries.get(workbookPath), "workbook");
    if (
      workbook.namespaceURI !== namespace &&
      workbook.namespaceURI !== strictNamespace
    ) {
      throw new AttendanceImportError(1);
    }
    const tabs = children(workbook, "sheets")[0];
    const sheets = tabs ? children(tabs, "sheet") : [];
    if (
      sheets.length !== 1 ||
      (sheets[0].hasAttribute("state") &&
        sheets[0].getAttribute("state") !== "visible")
    ) {
      throw new AttendanceImportError(1);
    }
    const sheetId =
      sheets[0].getAttributeNS(relationships, "id") ??
      sheets[0].getAttributeNS(strictRelationships, "id");
    if (!sheetId) throw new AttendanceImportError(1);
    const filenameStart = workbookPath.lastIndexOf("/") + 1;
    const relPath = `${workbookPath.slice(0, filenameStart)}_rels/${workbookPath.slice(filenameStart)}.rels`;
    const rels = await readXml(entries.get(relPath), "Relationships");
    const sheetPath = partPath(rels, workbookPath, "worksheet", sheetId);
    if (!sheetPath) throw new AttendanceImportError(1);
    const stringsPath = partPath(rels, workbookPath, "sharedStrings");
    const sharedStrings = stringsPath
      ? await readXml(entries.get(stringsPath), "sst")
      : undefined;
    const strings = sharedStrings
      ? children(sharedStrings, "si").map(plainText)
      : [];
    const sheet = await readXml(entries.get(sheetPath), "worksheet");
    if (sheet.namespaceURI !== workbook.namespaceURI)
      throw new AttendanceImportError(1);
    const rows = worksheetRows(sheet, strings);
    const header = rows.next().value;
    if (
      header?.rowNumber !== 1 ||
      header.columns.join(",") !== attendanceCsvHeader
    ) {
      throw new AttendanceImportError(1);
    }
    return validateAttendanceRows(rows, current);
  } catch (error) {
    if (error instanceof AttendanceImportError) throw error;
    throw new AttendanceImportError(1, { cause: error });
  } finally {
    await zip.close();
  }
}
