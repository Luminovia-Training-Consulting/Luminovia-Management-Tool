/** Exercises real OOXML archive parsing and the register's explicit confirmation boundary. */
import {
  MutationObserver,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, expect, it, vi } from "vitest";
import { AttendanceImportPanel } from "./attendance-import-panel";
import { attendanceCsvHeader } from "./attendance-import";
import { readAttendanceXlsx } from "./attendance-xlsx";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => {},
  useOnline: () => true,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const rel =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const pkg = "http://schemas.openxmlformats.org/package/2006/relationships";
const roster = [
  {
    user_id: "sample-learner",
    name: "Current Roster Name",
    status: null,
    arrival_at: null,
    departure_at: null,
    note: "",
    version: 2,
  },
];
const header = attendanceCsvHeader
  .split(",")
  .map(
    (_, index) =>
      `<c r="${String.fromCharCode(65 + index)}1" t="s"><v>${index}</v></c>`,
  )
  .join("");
const validCells =
  '<c r="A2" t="inlineStr"><is><t>sample-learner</t></is></c>' +
  '<c r="B2" t="inlineStr"><is><t>Untrusted file name</t></is></c>' +
  '<c r="C2" t="inlineStr"><is><t>present</t></is></c>' +
  '<c r="D2" t="inlineStr"><is><t>2026-11-21T09:15+01:00</t></is></c>' +
  '<c r="F2" t="inlineStr"><is><r><t>Reviewed</t></r><r><t> note</t></r></is></c>' +
  '<c r="G2" t="s"><v>7</v></c>';

/** Assemble literal fixture parts with real compression and relationships, including custom worksheet paths. */
async function workbook(
  cells = validCells,
  options: {
    target?: string;
    extraSheet?: string;
    suffix?: string;
    worksheetPrefix?: string;
  } = {},
) {
  const writer = new ZipWriter(new Uint8ArrayWriter(), {
    useWebWorkers: false,
  });
  const parts = {
    "_rels/.rels": `<Relationships xmlns="${pkg}"><Relationship Id="w" Type="${rel}/officeDocument" Target="/xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="Attendance" sheetId="1" r:id="s"/>${options.extraSheet ?? ""}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${pkg}"><Relationship Id="s" Type="${rel}/worksheet" Target="${options.target ?? "worksheets/attendance.xml"}"/><Relationship Id="ss" Type="${rel}/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst xmlns="${ns}">${attendanceCsvHeader
      .split(",")
      .map((label) => `<si><t>${label}</t></si>`)
      .join("")}<si><t>Signed register review</t></si></sst>`,
    "xl/worksheets/attendance.xml": `${options.worksheetPrefix ?? ""}<worksheet xmlns="${ns}"><sheetData><row r="1">${header}</row><row r="2">${cells}</row>${options.suffix ?? ""}</sheetData></worksheet>`,
  };
  for (const [name, value] of Object.entries(parts)) {
    await writer.add(
      name,
      new Uint8ArrayReader(new TextEncoder().encode(value)),
    );
  }
  const bytes = await writer.close();
  const file = new File([], "class-register.XLSX");
  // jsdom's File doesn't implement arrayBuffer; furnish the real archive bytes.
  Object.defineProperties(file, {
    size: { value: bytes.byteLength },
    arrayBuffer: { value: async () => bytes.buffer },
  });
  return file;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  rpc.mockReset();
});

it("reads shared and rich inline strings and binds import rows to the current roster", async () => {
  await expect(readAttendanceXlsx(await workbook(), roster)).resolves.toEqual([
    {
      user_id: "sample-learner",
      status: "present",
      arrival_at: "2026-11-21T09:15+01:00",
      departure_at: null,
      note: "Reviewed note",
      reason: "Signed register review",
      expected_version: 2,
    },
  ]);
});

it.each([
  [
    "cached formula result",
    '<c r="C2" t="str"><f>"present"</f><v>present</v></c>',
  ],
  ["Excel date serial without an offset", '<c r="D2"><v>46347.385</v></c>'],
  [
    "out-of-roster identity",
    '<c r="A2" t="inlineStr"><is><t>foreign-learner</t></is></c>',
  ],
])("rejects a row with a %s", async (_, replacement) => {
  const coordinate = replacement.match(/r="([A-G]2)"/)?.[1];
  const cells = validCells.replace(
    new RegExp(`<c r="${coordinate}"[^>]*>.*?</c>`),
    replacement,
  );
  await expect(
    readAttendanceXlsx(await workbook(cells), roster),
  ).rejects.toMatchObject({ row: 2 });
});

it.each([
  ["external worksheet", { target: "https://example.invalid/sheet.xml" }],
  [
    "multiple worksheets",
    { extraSheet: '<sheet name="Other" sheetId="2" r:id="other"/>' },
  ],
  [
    "DTD",
    {
      worksheetPrefix:
        '<!DOCTYPE worksheet [<!ENTITY undocumented "sample-learner">]>',
    },
  ],
  ["oversized worksheet", { worksheetPrefix: " ".repeat(524_289) }],
])("rejects workbooks with %s", async (_, options) => {
  await expect(
    readAttendanceXlsx(await workbook(validCells, options), roster),
  ).rejects.toMatchObject({ row: 1 });
});

it("reviews the XLSX without uploading it, then submits only current versioned rows on confirmation", async () => {
  // Exercise a click before the mutation observer receives the preview render's
  // options in its passive effect. The committed button owns the reviewed rows.
  const setOptions = MutationObserver.prototype.setOptions;
  vi.spyOn(MutationObserver.prototype, "setOptions").mockImplementation(
    function (this: MutationObserver, options) {
      if (!this.options) setOptions.call(this, options);
    },
  );
  const onSaved = vi.fn(async () => {});
  rpc.mockResolvedValue({ data: { saved: 1 }, error: null });
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <AttendanceImportPanel
        run="run"
        session="selected-session"
        rows={roster}
        onSaved={onSaved}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByText("attendanceImport"));
  fireEvent.change(screen.getByLabelText("attendanceImportFile"), {
    target: { files: [await workbook()] },
  });
  const confirm = await screen.findByRole("button", {
    name: "attendanceImportConfirm",
  });
  expect(screen.getByText(/Current Roster Name/)).toBeVisible();
  expect(screen.queryByText(/Untrusted file name/)).toBeNull();
  expect(rpc).not.toHaveBeenCalled();

  fireEvent.click(confirm);
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    "import_course_session_attendance",
    {
      p_run_id: "run",
      p_session_id: "selected-session",
      p_rows: [
        {
          user_id: "sample-learner",
          status: "present",
          arrival_at: "2026-11-21T09:15+01:00",
          departure_at: null,
          note: "Reviewed note",
          reason: "Signed register review",
          expected_version: 2,
        },
      ],
    },
  );
});
