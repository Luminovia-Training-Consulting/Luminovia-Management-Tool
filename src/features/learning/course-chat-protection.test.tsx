import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseChatProtection } from "./course-chat-protection";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));
const inactive = { enabled: false, version: 0 };
const initialState = {
  global: inactive,
  company: inactive,
  global_enforced: false,
  can_write: true,
};

beforeEach(async () => {
  rpc.mockReset();
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

function show() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <CourseChatProtection run="course" actor="administrator" />
    </QueryClientProvider>,
  );
}

it("keeps the displayed scope unchanged until the server confirms the versioned write", async () => {
  let confirm: (() => void) | undefined;
  rpc.mockResolvedValueOnce({ data: initialState });
  rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        confirm = () =>
          resolve({
            data: {
              ...initialState,
              global: { enabled: true, version: 1 },
              global_enforced: true,
            },
          });
      }),
  );
  show();
  const global = await screen.findByRole("switch", {
    name: "For all companies",
  });
  const company = screen.getByRole("switch", { name: "For this company" });
  await userEvent.setup().click(global);
  expect(global).not.toBeChecked();
  expect(company).toBeDisabled();
  expect(rpc).toHaveBeenLastCalledWith("set_course_chat_protection", {
    p_run_id: "course",
    p_global: true,
    p_enabled: true,
    p_expected_version: 0,
  });
  confirm?.();
  await waitFor(() => expect(global).toBeChecked());
  expect(company).not.toBeChecked();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Spam protection saved",
  );
});

it("shows the German company setting and academy-wide precedence without global edit access", async () => {
  await i18n.changeLanguage("de");
  rpc.mockResolvedValue({
    data: {
      ...initialState,
      global: null,
      global_enforced: true,
      can_write: false,
    },
  });
  show();
  expect(
    await screen.findByRole("switch", { name: "Für dieses Unternehmen" }),
  ).toBeDisabled();
  expect(
    screen.queryByRole("switch", { name: "Für alle Unternehmen" }),
  ).toBeNull();
  expect(
    screen.getByText("Der Spam-Schutz gilt für alle Unternehmen."),
  ).toBeVisible();
});

it("keeps controls hidden after a scope denial", async () => {
  rpc.mockResolvedValue({ error: { code: "42501" } });
  show();
  await waitFor(() => expect(rpc).toHaveBeenCalledOnce());
  expect(screen.queryByRole("switch")).toBeNull();
});
