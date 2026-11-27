import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../lib/i18n";
import { CourseSessionBulkEdit } from "./course-session-bulk-edit";

afterEach(cleanup);

const entries = [
  {
    id: "first",
    row: { starts_at: "2027-01-18T09:00", ends_at: "2027-01-18T10:30" },
  },
  {
    id: "second",
    row: { starts_at: "2027-01-20T09:00", ends_at: "2027-01-20T10:30" },
  },
];

async function setup(disabled = false) {
  await i18n.changeLanguage("de");
  const onApply = vi.fn(() => true);
  const user = userEvent.setup();
  render(
    <CourseSessionBulkEdit
      entries={entries}
      zone="Europe/Berlin"
      disabled={disabled}
      onApply={onApply}
    />,
  );
  await user.click(screen.getByText("Mehrere Termine bearbeiten"));
  return { onApply, user };
}

test("announces selected sessions and disables actions that cannot change the selection", async () => {
  const { user } = await setup();
  const selectAll = screen.getByRole("button", { name: "Alle auswählen" });
  const clear = screen.getByRole("button", { name: "Auswahl aufheben" });
  const preview = screen.getByRole("button", {
    name: "Terminänderungen prüfen",
  });
  expect(clear).toBeDisabled();
  expect(preview).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("0 Termine ausgewählt");
  await user.click(selectAll);
  expect(selectAll).toBeDisabled();
  expect(clear).toBeEnabled();
  expect(preview).toBeEnabled();
  expect(screen.getByRole("status")).toHaveTextContent("2 Termine ausgewählt");
  await user.click(clear);
  expect(screen.getByRole("status")).toHaveTextContent("0 Termine ausgewählt");
});

test("locks filters, selection and time inputs while the parent action is pending", async () => {
  const { user, onApply } = await setup(true);
  await user.click(screen.getByText("Nach Wochentag oder Datum auswählen"));
  expect(screen.getByLabelText("Wochentag")).toBeDisabled();
  expect(screen.getByLabelText("Termine ab")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Alle auswählen" })).toBeDisabled();
  expect(
    screen
      .getAllByRole("checkbox")
      .every((item) => (item as HTMLInputElement).matches(":disabled")),
  ).toBe(true);
  expect(screen.getByLabelText("Um Kalendertage verschieben")).toBeDisabled();
  expect(screen.getByLabelText("Neuer Beginn (optional)")).toBeDisabled();
  expect(onApply).not.toHaveBeenCalled();
});
