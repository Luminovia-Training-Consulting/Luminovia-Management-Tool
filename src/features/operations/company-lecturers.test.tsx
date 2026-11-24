import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CompanyLecturers } from "./company-lecturers";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

afterEach(() => {
  cleanup();
  rpc.mockReset();
});

it.each([true, false])(
  "keeps assignment and removal within the company (staff: %s)",
  async (staff) => {
    await i18n.changeLanguage("de");
    const organisation = { id: "fictional-company", name: "Fictional company" };
    const lecturer = { id: "fictional-lecturer", display_name: "Alex Example" };
    let linked = !staff;
    rpc.mockImplementation(async (name, args) => {
      if (name === "set_company_lecturer") {
        linked = !args.p_remove;
        return { error: null };
      }
      return {
        error: null,
        data: {
          members: linked ? [lecturer] : [],
          candidates: staff && !linked ? [lecturer] : [],
          can_add: staff,
        },
      };
    });
    const client = new QueryClient();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <CompanyLecturers
          actor="fictional-actor"
          organisations={[organisation]}
        />
      </QueryClientProvider>,
    );
    await user.click(screen.getByText("Eigene Dozierende"));
    if (staff) {
      await user.selectOptions(
        await screen.findByRole("combobox"),
        lecturer.id,
      );
      await user.click(
        screen.getByRole("button", { name: "Dozent:in zuordnen" }),
      );
      expect(rpc).toHaveBeenCalledWith("set_company_lecturer", {
        p_organisation_id: organisation.id,
        p_lecturer_id: lecturer.id,
        p_remove: false,
      });
    }
    const remove = await screen.findByRole("button", {
      name: "Alex Example aus dem Unternehmen entfernen",
    });
    if (!staff) expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(remove);
    expect(rpc).toHaveBeenCalledWith("set_company_lecturer", {
      p_organisation_id: organisation.id,
      p_lecturer_id: lecturer.id,
      p_remove: true,
    });
    await screen.findByText(
      "Diesem Unternehmen sind keine Dozierenden zugeordnet.",
    );
    client.clear();
  },
);
