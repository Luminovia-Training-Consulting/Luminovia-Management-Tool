/** Invitation controls never claim membership until the server confirms it. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import {
  TopicInvitationInbox,
  TopicInvitationManager,
} from "./topic-invitations";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function view(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
  return client;
}

it("awaits acceptance, keeps the invitation visible on failure and navigates only after confirmed membership", async () => {
  await i18n.changeLanguage("de");
  let resolve!: (value: unknown) => void;
  let result = 0;
  fake.rpc.mockImplementation((name: string) => {
    if (name === "topic_invitation_inbox")
      return Promise.resolve({
        data: [
          {
            id: "invite",
            room_id: "room",
            title: "Fictional group",
            inviter_name: "Fictional owner",
          },
        ],
        error: null,
      });
    if (name === "respond_topic_invitation") {
      result++;
      return result === 1
        ? Promise.resolve({ data: null, error: { code: "offline" } })
        : new Promise((r) => {
            resolve = r;
          });
    }
    return Promise.resolve({ data: [], error: null });
  });
  const navigate = vi.fn();
  const client = view(<TopicInvitationInbox actor="actor" onRoom={navigate} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Annehmen" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("nicht bestätigt");
  expect(screen.getByText("Fictional group")).toBeVisible();
  expect(navigate).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Annehmen" }));
  expect(navigate).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Annehmen" })).toBeDisabled();
  resolve({ data: "room", error: null });
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("room"));
  expect(fake.rpc).toHaveBeenCalledWith("respond_topic_invitation", {
    p_id: "invite",
    p_accept: true,
  });
  client.clear();
});
it("sends and revokes only through server-confirmed owner actions", async () => {
  await i18n.changeLanguage("en");
  fake.rpc.mockImplementation(async (name: string) =>
    name === "topic_invitation_sent"
      ? {
          data: [{ id: "pending", invitee_name: "Fictional recipient" }],
          error: null,
        }
      : { data: "ok", error: null },
  );
  const client = view(
    <TopicInvitationManager
      actor="owner"
      room="room"
      candidates={[
        { id: "peer", display_name: "Fictional peer", roles: ["lecturer"] },
      ]}
    />,
  );
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Select a person"), "peer");
  await user.click(screen.getByRole("button", { name: "Send invitation" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("invite_topic_member", {
      p_room_id: "room",
      p_invitee_id: "peer",
    }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: "Revoke invitation for Fictional recipient",
    }),
  );
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("revoke_topic_invitation", {
      p_id: "pending",
    }),
  );
  client.clear();
});
