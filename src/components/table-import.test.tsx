import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TableImport } from "./table-import";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));
vi.mock("../lib/online", () => ({ useOnline: () => true }));

afterEach(cleanup);

function selectCsv(text: string) {
  const bytes = new TextEncoder().encode(text);
  const file = new File([bytes], "test.csv");
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.buffer,
  });
  fireEvent.change(screen.getByLabelText("CSV or XLSX file"), {
    target: { files: [file] },
  });
}

it("previews semicolon CSV and stops on a failed row without submitting later rows", async () => {
  const save = vi.fn(async (name: string) => {
    if (name === "Second") throw new Error("denied");
  });
  const refresh = vi.fn(async () => undefined);
  render(
    <TableImport
      label="Import"
      filename="records"
      columns={["name", "note"]}
      example={["Example", ""]}
      parse={({ name }) => name}
      save={save}
      refresh={refresh}
    />,
  );
  fireEvent.click(screen.getByText("Import"));
  selectCsv('name;note\r\n"First; name";\r\nSecond;\r\nThird;');
  const confirm = await screen.findByRole("button", {
    name: "Create 3 records",
  });
  expect(screen.getByText("2: First; name")).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await screen.findByText(/1 confirmed. Stopped at row 3/);
  expect(save.mock.calls).toEqual([["First; name"], ["Second"]]);
  expect(refresh).toHaveBeenCalledOnce();
});

it("rejects the whole file before confirmation if a data row has the wrong shape", async () => {
  const saveBatch = vi.fn(async () => ({ created: 1, skipped: 0 }));
  render(
    <TableImport
      label="Import"
      filename="records"
      columns={["name", "note"]}
      example={["Example", ""]}
      parse={({ name }) => name}
      saveBatch={saveBatch}
      refresh={async () => undefined}
    />,
  );
  fireEvent.click(screen.getByText("Import"));
  selectCsv("name,note\nFirst,\nSecond");
  await screen.findByText("Check the file format and row 3.");
  expect(screen.queryByRole("button", { name: /create.*records/i })).toBeNull();
  expect(saveBatch).not.toHaveBeenCalled();
});
