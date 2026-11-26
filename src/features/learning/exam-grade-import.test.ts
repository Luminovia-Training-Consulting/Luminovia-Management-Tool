/** Protect spreadsheet preview boundaries for both supported file formats. */
import { expect, it } from "vitest";
import { csvText } from "../../lib/csv";
import { spreadsheetXlsxTemplate } from "./attendance-xlsx";
import {
  examGradeImportHeaders,
  examGradeTemplateRows,
  readExamGradeImport,
} from "./exam-grade-import";

const run = "19bcd476-8f8b-4cc8-9e5d-19dea2550be2";
const learner = "ef67dd2e-eb97-40f1-81f4-dcb6ef7ef28a";
const other = "ef67dd2e-eb97-40f1-81f4-dcb6ef7ef28b";
const roster = [
  { participant_id: learner, name: "Alex, Fictional", score: 80 },
  { participant_id: other, name: "=Fictional literal", score: null },
];
function file(content: string | Blob, extension = "csv") {
  const source = new File([content], `scores.${extension}`);
  return Object.assign(source, {
    arrayBuffer: () =>
      new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(source);
      }),
  });
}
const csv = (...rows: unknown[][]) =>
  file(csvText([examGradeImportHeaders, ...rows]));

it("uses the roster identity and shows the previous score, including zero as a new grade", async () => {
  await expect(
    readExamGradeImport(
      csv([run, 3, learner, "Edited name", 85], [run, 3, other, "", 0]),
      run,
      3,
      roster,
    ),
  ).resolves.toEqual([
    {
      participant_id: learner,
      name: "Alex, Fictional",
      expected_score: 80,
      score: 85,
    },
    {
      participant_id: other,
      name: "=Fictional literal",
      expected_score: null,
      score: 0,
    },
  ]);
  await expect(
    readExamGradeImport(
      csv([run, 3, learner, "", 80], [run, 3, other, "", ""]),
      run,
      3,
      roster,
    ),
  ).resolves.toEqual([]);
});

it.each([
  [other, 3, learner, "", 80],
  [run, 2, learner, "", 80],
  [run, 3, run, "", 80],
  [run, 3, learner, "", 86.5],
  [run, 3, learner, "", 101],
  [run, 3, learner, "", "=80"],
])(
  "rejects a row outside its current exam sheet or score domain",
  async (...row) => {
    await expect(
      readExamGradeImport(csv(row), run, 3, roster),
    ).rejects.toMatchObject({ row: 2 });
  },
);

it("rejects duplicate identities even when the first score cell stays blank", async () => {
  await expect(
    readExamGradeImport(
      csv([run, 3, learner, "", ""], [run, 3, learner, "", 91]),
      run,
      3,
      roster,
    ),
  ).rejects.toMatchObject({ row: 3 });
});

it("round-trips the literal XLSX worksheet and keeps CSV template names safe", async () => {
  const rows = examGradeTemplateRows(run, 3, roster);
  expect(csvText([examGradeImportHeaders, ...rows])).toContain(
    `"'=Fictional literal"`,
  );
  rows[1][4] = 100;
  const workbook = await spreadsheetXlsxTemplate(examGradeImportHeaders, rows);
  await expect(
    readExamGradeImport(file(workbook, "xlsx"), run, 3, roster),
  ).resolves.toEqual([
    {
      participant_id: other,
      name: "=Fictional literal",
      expected_score: null,
      score: 100,
    },
  ]);
});
