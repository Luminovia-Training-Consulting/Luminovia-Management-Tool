import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { Field } from "./common";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "validation" ? "Bitte prüfe deine Eingaben." : key,
  }),
}));
afterEach(cleanup);

describe("Field accessible validation", () => {
  it.each<[string, ReactElement, string]>([
    ["input", <input key="input" />, "textbox"],
    [
      "select",
      <select key="select">
        <option value="de">Deutsch</option>
      </select>,
      "combobox",
    ],
    ["textarea", <textarea key="textarea" />, "textbox"],
  ])(
    "associates the %s label, hint and validation message",
    (_name, control, role) => {
      render(
        <Field
          id="profile-field"
          label="Profilangabe"
          hint="Nur für dein Profil."
          error
        >
          {control}
        </Field>,
      );
      const input = screen.getByRole(role, { name: "Profilangabe" });
      expect(input).toHaveAccessibleDescription(
        "Nur für dein Profil. Bitte prüfe deine Eingaben.",
      );
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Bitte prüfe deine Eingaben.",
      );
    },
  );

  it("removes stale validation associations after correction while preserving external help", () => {
    const form = (error: boolean) => (
      <>
        <p id="external-help">Weitere Hilfe.</p>
        <Field
          id="email"
          label="E-Mail"
          hint="Deine geschäftliche Adresse."
          error={error}
        >
          <input
            type="email"
            aria-describedby="external-help email-hint email-error external-help"
          />
        </Field>
      </>
    );
    const { rerender } = render(form(true));
    expect(
      screen.getByRole("textbox", { name: "E-Mail" }),
    ).toHaveAccessibleDescription(
      "Weitere Hilfe. Deine geschäftliche Adresse. Bitte prüfe deine Eingaben.",
    );
    rerender(form(false));
    const input = screen.getByRole("textbox", { name: "E-Mail" });
    expect(input).toHaveAccessibleDescription(
      "Weitere Hilfe. Deine geschäftliche Adresse.",
    );
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves a healthy field without validation or dangling description attributes", () => {
    render(
      <Field id="name" label="Anzeigename">
        <input aria-invalid={false} />
      </Field>,
    );
    const input = screen.getByRole("textbox", { name: "Anzeigename" });
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
