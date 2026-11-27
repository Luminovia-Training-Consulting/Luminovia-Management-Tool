/** Apply scoped company defaults only after an explicit decision about edited fields. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { OperationalPresetPicker } from "./operational-presets";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));

afterEach(cleanup);

it("requires confirmation before replacing edited course data with a customer's defaults", async () => {
  await i18n.changeLanguage("de");
  const user = userEvent.setup();
  const organisation = "2ea5200e-fd12-4790-ac69-e4a264d32336";
  const preset = {
    id: "c12310f9-0ca9-4304-959a-018a32f96152",
    revision: 2,
    archived_at: null,
    name: "Fiktive Hybrid-Schulung",
    config: {
      time_zone: "Europe/Berlin",
      starts_at: "10:00",
      ends_at: "16:00",
      contact_id: null,
      delivery: {
        mode: "hybrid",
        venue_id: null,
        meeting_platform: "teams",
        teaching_instructions: "",
      },
    },
  };
  fake.rpc.mockReturnValue({
    abortSignal: () => Promise.resolve({ data: [preset], error: null }),
  });
  const apply = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OperationalPresetPicker
        actor="actor"
        organisation={organisation}
        dirtyZone
        dirtyDelivery
        disabled={false}
        onApply={apply}
        onClear={vi.fn()}
      />
    </QueryClientProvider>,
  );
  await user.click(screen.getByText("Operative Kundenvorlagen"));
  await screen.findByRole("option", { name: preset.name });
  await user.selectOptions(
    screen.getByLabelText("Kundenvorlage wählen"),
    preset.id,
  );
  expect(
    screen.getByText("Europe/Berlin · Hybrid · 10:00 – 16:00"),
  ).toBeVisible();
  expect(apply).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Vorgaben übernehmen" }));
  expect(apply).toHaveBeenLastCalledWith(preset, false, false);
  await user.click(
    screen.getByRole("checkbox", {
      name: "Bereits bearbeitete Zeitzone ersetzen",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Vorgaben übernehmen" }));
  expect(apply).toHaveBeenLastCalledWith(preset, true, false);
  expect(fake.rpc).toHaveBeenCalledWith("training_operational_presets", {
    p_organisation_id: organisation,
  });
});
