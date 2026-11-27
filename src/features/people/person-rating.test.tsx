import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { PersonRatingButton } from "./person-rating";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => {},
  useOnline: () => true,
}));

function mount(person: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PersonRatingButton
        actor="self"
        person={person}
        name="Fictional contact"
      />
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.rpc.mockReset();
});
afterEach(cleanup);

it("saves an independent star rating with an optional comment and reloads it for editing", async () => {
  let saved = { stars: null as number | null, comment: "" };
  state.rpc.mockImplementation((action, values) => {
    if (action === "person_rating") {
      return { abortSignal: async () => ({ data: saved, error: null }) };
    }
    saved = { stars: values.p_stars, comment: values.p_comment };
    return Promise.resolve({ data: saved, error: null });
  });
  mount("recipient");
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Fictional contact bewerten" }),
  );
  const submit = await screen.findByRole("button", {
    name: "Bewertung speichern",
  });
  expect(submit).toBeDisabled();
  await user.click(screen.getByRole("radio", { name: "4 Sterne" }));
  await user.type(
    screen.getByRole("textbox", { name: /Kommentar/ }),
    "Gute Abstimmung.",
  );
  await user.click(submit);
  expect(
    await screen.findByText("Deine Bewertung wurde gespeichert."),
  ).toBeVisible();
  expect(state.rpc).toHaveBeenCalledWith("save_person_rating", {
    p_person_id: "recipient",
    p_stars: 4,
    p_comment: "Gute Abstimmung.",
  });
  await user.keyboard("{Escape}");
  await user.click(
    screen.getByRole("button", { name: "Fictional contact bewerten" }),
  );
  expect(await screen.findByRole("radio", { name: "4 Sterne" })).toBeChecked();
});

it("shows received comments on the own profile without a rating form", async () => {
  state.rpc.mockReturnValue({
    abortSignal: async () => ({
      error: null,
      data: {
        stars: null,
        comment: "",
        received: [
          {
            id: "1898136a-a868-418a-a3b3-c04978ca3d35",
            stars: 5,
            comment: "Fictional feedback.",
          },
        ],
      },
    }),
  });
  mount("self");
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Erhaltene Bewertungen" }));
  expect(await screen.findByText("Fictional feedback.")).toBeVisible();
  expect(screen.getByText("5 Sterne")).toBeVisible();
  expect(screen.queryByRole("radio")).toBeNull();
});
