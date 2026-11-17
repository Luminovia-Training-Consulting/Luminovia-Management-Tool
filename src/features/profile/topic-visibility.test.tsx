/** Component checks for server-confirmed, independent directory expertise visibility. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { OwnTopicVisibility } from "./topic-visibility";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
const clients: QueryClient[] = [];
function view() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <OwnTopicVisibility actor="owner" />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});
it.each([
  [
    "de",
    "Meine Fachgebiete im Personenverzeichnis und Profil anzeigen",
    "Sichtbarkeit speichern",
    "Sichtbarkeit gespeichert.",
  ],
  [
    "en",
    "Show my expertise in the people directory and profile",
    "Save visibility",
    "Visibility saved.",
  ],
])(
  "saves only after server confirmation in %s",
  async (language, label, saveLabel, success) => {
    await i18n.changeLanguage(language);
    let complete!: (value: unknown) => void;
    fake.rpc.mockImplementation((name: string) =>
      name === "profile_topic_preferences"
        ? Object.assign(
            Promise.resolve({
              data: { visible: true, version: 0, can_share: true },
              error: null,
            }),
            {
              abortSignal() {
                return this;
              },
            },
          )
        : new Promise((resolve) => {
            complete = resolve;
          }),
    );
    view();
    const user = userEvent.setup();
    const checkbox = await screen.findByRole("checkbox", { name: label });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: saveLabel }));
    expect(fake.rpc).toHaveBeenCalledWith("save_profile_topic_preferences", {
      p_visible: false,
      p_expected_version: 0,
    });
    expect(screen.queryByText(success)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: saveLabel })).toBeDisabled();
    complete({
      data: { visible: false, version: 1, can_share: true },
      error: null,
    });
    expect(await screen.findByText(success)).toBeVisible();
    expect(checkbox).not.toBeChecked();
  },
);
it("keeps unsaved selection on server conflict and reloads only on explicit request", async () => {
  await i18n.changeLanguage("de");
  let current = { visible: true, version: 0, can_share: true };
  fake.rpc.mockImplementation((name: string) =>
    name === "profile_topic_preferences"
      ? Object.assign(Promise.resolve({ data: current, error: null }), {
          abortSignal() {
            return this;
          },
        })
      : Promise.resolve({ data: null, error: { code: "40001" } }),
  );
  view();
  const user = userEvent.setup();
  const checkbox = await screen.findByRole("checkbox", {
    name: "Meine Fachgebiete im Personenverzeichnis und Profil anzeigen",
  });
  await user.click(checkbox);
  current = { visible: true, version: 2, can_share: true };
  await user.click(
    screen.getByRole("button", { name: "Sichtbarkeit speichern" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "inzwischen geändert",
  );
  expect(checkbox).not.toBeChecked();
  await user.click(
    screen.getByRole("button", { name: "Sichtbarkeit neu laden" }),
  );
  expect(checkbox).toBeChecked();
});
