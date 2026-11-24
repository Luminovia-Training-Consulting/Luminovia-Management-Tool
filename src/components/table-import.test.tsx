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
  let loseResponse = true;
  const save = vi.fn<(name: string, key: string) => Promise<void>>(
    async (name) => {
      if (name === "Second" && loseResponse) {
        loseResponse = false;
        throw new Error("response lost");
      }
    },
  );
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
  expect(screen.getByText(/2: First; name/)).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await screen.findByText(/1 confirmed. Row 3 could not be confirmed/);
  expect(screen.getByText("Saved")).toBeVisible();
  expect(screen.getByText("Unconfirmed")).toBeVisible();
  expect(save.mock.calls.map(([name]) => name)).toEqual([
    "First; name",
    "Second",
  ]);
  expect(refresh).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole("button", { name: "Retry pending rows" }));
  await screen.findByText("Created 3 records.");
  expect(save.mock.calls.map(([name]) => name)).toEqual([
    "First; name",
    "Second",
    "Second",
    "Third",
  ]);
  expect(save.mock.calls[2][1]).toBe(save.mock.calls[1][1]);
  expect(save.mock.calls[3][1]).not.toBe(save.mock.calls[2][1]);
  expect(screen.getAllByText("Saved")).toHaveLength(3);
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

it("corrects rejected rows in place and never resubmits an already confirmed row", async () => {
  const save = vi.fn<(name: string, key: string) => Promise<void>>(
    async (name) => {
      if (name === "Rejected") throw { code: "22023" };
    },
  );
  render(
    <TableImport
      label="Import"
      filename="records"
      columns={["name"]}
      example={["Example"]}
      parse={({ name }) => {
        if (name === "Invalid") throw new Error("invalid");
        return name;
      }}
      save={save}
      refresh={async () => undefined}
    />,
  );
  fireEvent.click(screen.getByText("Import"));
  selectCsv("name\nFirst\nRejected\nInvalid");
  const confirm = await screen.findByRole("button", {
    name: "Create 3 records",
  });
  expect(confirm).toBeDisabled();
  fireEvent.change(screen.getByLabelText("name"), {
    target: { value: "Third" },
  });
  fireEvent.click(confirm);
  await screen.findByText(/1 confirmed. Row 3 could not be confirmed/);
  fireEvent.click(screen.getByText("Correct row 3"));
  const input = screen
    .getAllByLabelText("name")
    .find((item) => (item as HTMLInputElement).value === "Rejected")!;
  fireEvent.change(input, { target: { value: "Second" } });
  fireEvent.click(screen.getByRole("button", { name: "Retry pending rows" }));
  await screen.findByText("Created 3 records.");
  expect(save.mock.calls.map(([name]) => name)).toEqual([
    "First",
    "Rejected",
    "Second",
    "Third",
  ]);
  expect(save.mock.calls[1][1]).not.toBe(save.mock.calls[2][1]);
});
