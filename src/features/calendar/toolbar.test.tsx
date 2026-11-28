/** Native button semantics stay stable while the visible calendar range/view changes. */
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../lib/i18n";
import "./filter-i18n";
import { CalendarToolbar } from "./toolbar";
import { calendarViews } from "./views";

afterEach(cleanup);
it("routes period/view controls and exposes exactly one selected view in both languages", async () => {
  await i18n.changeLanguage("de");
  const navigate = vi.fn(),
    change = vi.fn();
  const view = render(
    <CalendarToolbar
      title="November 2026"
      view="timeGridWeek"
      onNavigate={navigate}
      onView={change}
      getDate={() => "2026-11-18"}
      onGoToDate={vi.fn()}
    />,
  );
  const user = userEvent.setup();
  for (const [label, key] of [
    ["Vorheriger Zeitraum", "prev"],
    ["Heute", "today"],
    ["Nächster Zeitraum", "next"],
  ]) {
    await user.click(screen.getByRole("button", { name: label }));
    expect(navigate).toHaveBeenLastCalledWith(key);
  }
  expect(screen.getByRole("button", { name: "Woche" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const [index, label] of ["Monat", "Woche", "Tag", "Termine"].entries()) {
    await user.click(screen.getByRole("button", { name: label }));
    expect(change).toHaveBeenLastCalledWith(calendarViews[index]);
  }
  view.rerender(
    <CalendarToolbar
      title="18. November 2026"
      view="timeGridDay"
      onNavigate={navigate}
      onView={change}
      getDate={() => "2026-11-18"}
      onGoToDate={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Tag" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("heading", { name: "18. November 2026" }),
  ).toHaveAttribute("aria-live", "polite");
  await i18n.changeLanguage("en");
  expect(screen.getByRole("button", { name: "Day" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(
    screen.getByRole("button", { name: "Previous date range" }),
  ).toHaveAttribute("title", "Previous date range");
});

it("jumps to a civil date by keyboard and restores focus to the date action", async () => {
  await i18n.changeLanguage("en");
  const jump = vi.fn();
  const user = userEvent.setup();
  render(
    <CalendarToolbar
      title="November 2026"
      view="timeGridWeek"
      onNavigate={vi.fn()}
      onView={vi.fn()}
      getDate={() => "2026-11-18"}
      onGoToDate={jump}
    />,
  );
  const choose = screen.getByRole("button", { name: "Choose date" });
  choose.focus();
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", { name: "Choose date" });
  const date = within(dialog).getByLabelText("Date");
  expect(date).toHaveValue("2026-11-18");
  fireEvent.change(date, { target: { value: "2030-10-27" } });
  await user.click(within(dialog).getByRole("button", { name: "Show date" }));
  expect(jump).toHaveBeenCalledExactlyOnceWith("2030-10-27");
  expect(dialog).not.toBeInTheDocument();
  expect(choose).toHaveFocus();
  expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
