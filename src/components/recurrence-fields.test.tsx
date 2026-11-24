import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RecurrenceRule, LocalScheduleEntry } from "../lib/recurrence";
import { RecurrenceFields } from "./recurrence-fields";
import i18n from "../lib/i18n";

afterEach(cleanup);

function Editor({ apply }: { apply: (entries: LocalScheduleEntry[]) => void }) {
  const [rule, setRule] = useState<RecurrenceRule | null>(null);
  return (
    <RecurrenceFields
      anchor={{ starts_at: "2027-01-31T09:00", ends_at: "2027-01-31T10:00" }}
      zone="Europe/Berlin"
      value={rule}
      onChange={setRule}
      onApply={apply}
      max={8}
    />
  );
}

it("previews a monthly rule without saving and exposes the full list", async () => {
  const apply = vi.fn();
  render(<Editor apply={apply} />);
  const user = userEvent.setup();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Wiederholung" }),
    "monthly",
  );
  const count = screen.getByRole("spinbutton", { name: "Anzahl der Termine" });
  await user.clear(count);
  await user.type(count, "6");
  expect(screen.getByRole("status")).toHaveTextContent(
    "6 Termine · Europe/Berlin",
  );
  expect(apply).not.toHaveBeenCalled();
  const summary = screen.getByText("Weitere Termine anzeigen");
  await user.click(summary);
  const detail = summary.closest("details")!;
  expect(detail).toHaveAttribute("open");
  expect(within(detail).getAllByRole("listitem")).toHaveLength(1);
  await user.click(
    screen.getByRole("button", { name: "Wiederholungen ergänzen" }),
  );
  expect(apply.mock.calls[0][0]).toHaveLength(6);
  expect(apply.mock.calls[0][0][1].starts_at).toBe("2027-03-31T09:00");
});

it("uses English labels and suppresses applying an oversized series", async () => {
  await i18n.changeLanguage("en");
  try {
    render(<Editor apply={vi.fn()} />);
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Repeat" }),
      "weekly",
    );
    const count = screen.getByRole("spinbutton", {
      name: "Number of appointments",
    });
    await user.clear(count);
    await user.type(count, "9");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The series can have up to 8 appointments.",
    );
    expect(
      screen.queryByRole("button", { name: "Add repeats" }),
    ).not.toBeInTheDocument();
  } finally {
    await i18n.changeLanguage("de");
  }
});
