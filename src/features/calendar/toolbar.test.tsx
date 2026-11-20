/** Native button semantics stay stable while the visible calendar range/view changes. */
import {afterEach, expect, it, vi} from "vitest";
import {cleanup, render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../lib/i18n";
import "./filter-i18n";
import {CalendarToolbar} from "./toolbar";
import {calendarViews} from "./views";

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
        />,
    );
    const user = userEvent.setup();
    for (const [label, key] of [
        ["Vorheriger Zeitraum", "prev"],
        ["Heute", "today"],
        ["Nächster Zeitraum", "next"],
    ]) {
        await user.click(screen.getByRole("button", {name: label}));
        expect(navigate).toHaveBeenLastCalledWith(key);
    }
    expect(screen.getByRole("button", {name: "Woche"})).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    for (const [index, label] of ["Monat", "Woche", "Tag", "Termine"].entries()) {
        await user.click(screen.getByRole("button", {name: label}));
        expect(change).toHaveBeenLastCalledWith(calendarViews[index]);
    }
    view.rerender(
        <CalendarToolbar
            title="18. November 2026"
            view="timeGridDay"
            onNavigate={navigate}
            onView={change}
        />,
    );
    expect(screen.getByRole("button", {name: "Tag"})).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    expect(
        screen.getByRole("heading", {name: "18. November 2026"}),
    ).toHaveAttribute("aria-live", "polite");
    await i18n.changeLanguage("en");
    expect(screen.getByRole("button", {name: "Day"})).toHaveAttribute(
        "aria-pressed",
        "true",
    );
    expect(
        screen.getByRole("button", {name: "Previous date range"}),
    ).toHaveAttribute("title", "Previous date range");
});