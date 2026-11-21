/** Exercise the framework date aid through its localized, date-only form. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import i18n from "../../lib/i18n";
import { FrameworkPaymentDatesFields } from "./framework-payment-dates-fields";

afterEach(cleanup);

it("shows the earlier final deadline, preserves dates across language changes and recalculates for a longer assignment", async () => {
  await i18n.changeLanguage("de");
  const view = render(<FrameworkPaymentDatesFields />);
  fireEvent.click(screen.getByText("Zahlungsfristen berechnen"));
  fireEvent.change(
    screen.getByLabelText("Erste tatsächlich erbrachte Einheit"),
    { target: { value: "2026-10-14" } },
  );
  fireEvent.change(
    screen.getByLabelText("Letzte vereinbarte Einheit laut Auftrag"),
    { target: { value: "2026-10-30" } },
  );
  expect(view.container.querySelector("time")).toHaveAttribute(
    "datetime",
    "2026-11-13",
  );
  expect(screen.queryByText("Abschlagszahlung bis")).not.toBeInTheDocument();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(
    screen.getByLabelText("First service unit actually delivered"),
  ).toHaveValue("2026-10-14");
  fireEvent.change(
    screen.getByLabelText("Last agreed service unit in the assignment"),
    { target: { value: "2026-11-04" } },
  );
  expect(
    screen
      .getByText("Final payment by")
      .nextElementSibling?.querySelector("time"),
  ).toHaveAttribute("datetime", "2026-11-18");
  expect(
    screen
      .getByText("Interim payment by")
      .nextElementSibling?.querySelector("time"),
  ).toHaveAttribute("datetime", "2026-11-13");
});
