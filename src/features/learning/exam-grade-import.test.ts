/** Protect spreadsheet preview boundaries for both supported file formats. */
import { expect, it } from "vitest";
import { csvText } from "../../lib/csv";
import { spreadsheetXlsxTemplate } from "./attendance-xlsx";
import {
  examGradeImportHeaders,
  examGradeTemplateRows,
  readExamGradeImport,
} from "./exam-grade-import";

import {
  readTextExamGradeImport,
  textExamGradeHeaders,
  textExamGradeTemplateRows,
} from "./text-exam-grade-import";

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

const submitted = [
  {
    learner_id: learner,
    name: "Sam Fictional",
    draft: { revision: 2, points: [3, 2] },
  },
  {
    learner_id: other,
    name: "Alex Fictional",
    draft: { revision: 0, points: null },
  },
];
const maxima = [6, 4];
const textHeaders = textExamGradeHeaders(maxima.length);
const textCsv = (...rows: unknown[][]) => file(csvText([textHeaders, ...rows]));

it("imports literal question marks against current drafts from CSV and XLSX", async () => {
  const rows = textExamGradeTemplateRows(run, 5, maxima.length, submitted);
  expect(rows[0].slice(4)).toEqual([2, "", ""]);
  rows[0][3] = "Workbook name does not change identity";
  rows[0][5] = 0;
  rows[0][6] = 4;
  const formats = [
    textCsv(...rows),
    file(await spreadsheetXlsxTemplate(textHeaders, rows), "xlsx"),
  ];
  for (const source of formats) {
    await expect(
      readTextExamGradeImport(source, run, 5, maxima, submitted),
    ).resolves.toEqual([
      {
        candidate: submitted[0],
        request: { learner_id: learner, expected_revision: 2, points: [0, 4] },
      },
    ]);
  }
  await expect(
    readTextExamGradeImport(
      textCsv([run, 5, learner, "", 2, 3, 2]),
      run,
      5,
      maxima,
      submitted,
    ),
  ).resolves.toEqual([]);
});

it.each([
  [other, 5, learner, "", 2, 5, 4],
  [run, 4, learner, "", 2, 5, 4],
  [run, 5, run, "", 2, 5, 4],
  [run, 5, learner, "", 1, 5, 4],
  [run, 5, learner, "", 2, 5, ""],
  [run, 5, learner, "", 2, 7, 2],
  [run, 5, learner, "", 2, 5, 1.5],
])("rejects a stale or invalid question mark row", async (...row) => {
  await expect(
    readTextExamGradeImport(textCsv(row), run, 5, maxima, submitted),
  ).rejects.toMatchObject({ row: 2 });
});

it("rejects duplicate submissions in a text exam workbook", async () => {
  const source = textCsv(
    [run, 5, learner, "", 2, "", ""],
    [run, 5, learner, "", 2, 6, 2],
  );
  await expect(
    readTextExamGradeImport(source, run, 5, maxima, submitted),
  ).rejects.toMatchObject({ row: 3 });
});
