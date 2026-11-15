import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Avatar, AvatarEditor } from "./avatar";
const { state, readAvatar } = vi.hoisted(() => ({
  state: { actor: "actor-a", online: true },
  readAvatar: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: vi.fn(),
}));
vi.mock("./avatar-api", () => ({
  avatarQuery: (actor: string, target: string) => ({
    queryKey: ["avatar", actor, target],
    queryFn: async () => ({ version_id: actor }),
    gcTime: 0,
  }),
  readAvatar,
  prepareAvatar: vi.fn(),
  selectAvatar: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  state.actor = "actor-a";
  state.online = true;
});
function setup() {
  const create = vi
    .fn()
    .mockReturnValueOnce("blob:avatar-a")
    .mockReturnValueOnce("blob:avatar-b");
  const revoke = vi.fn();
  class ImageURL extends URL {
    static createObjectURL = create;
    static revokeObjectURL = revoke;
  }
  vi.stubGlobal("URL", ImageURL);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const ui = () => (
    <QueryClientProvider client={client}>
      <Avatar userId="teacher" name="Fictional Teacher" />
    </QueryClientProvider>
  );
  const result = render(ui());
  return { ...result, update: () => result.rerender(ui()), create, revoke };
}
describe("private avatar Blob lifecycle", () => {
  it("revokes object URLs when the actor changes, goes offline or unmounts", async () => {
    const a = new Blob(["first"]),
      b = new Blob(["second"]);
    readAvatar.mockResolvedValueOnce(a).mockResolvedValueOnce(b);
    const view = setup();
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute("src", "blob:avatar-a"),
    );
    state.actor = "actor-b";
    view.update();
    expect(screen.getByRole("img")).not.toHaveAttribute("src");
    await waitFor(() =>
      expect(screen.getByRole("img")).toHaveAttribute("src", "blob:avatar-b"),
    );
    expect(view.revoke).toHaveBeenCalledWith("blob:avatar-a");
    state.online = false;
    view.update();
    expect(screen.getByRole("img")).not.toHaveAttribute("src");
    expect(view.revoke).toHaveBeenCalledWith("blob:avatar-b");
    view.unmount();
  });
  it("disables avatar editing offline and leaves the global connection banner as the only offline status", () => {
    state.online = false;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <div role="status">Global connection banner</div>
        <AvatarEditor name="Fictional Teacher" />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Profilbild auswählen" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Profilbild entfernen" }),
    ).toBeDisabled();
  });

  it("ignores a late prior-actor download and aborts its request", async () => {
    let finish!: (blob: Blob) => void;
    let oldSignal!: AbortSignal;
    readAvatar
      .mockImplementationOnce((_target, signal) => {
        oldSignal = signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      })
      .mockResolvedValueOnce(new Blob(["new actor"]));
    const view = setup();
    await waitFor(() => expect(readAvatar).toHaveBeenCalledTimes(1));
    state.actor = "actor-b";
    view.update();
    await waitFor(() => expect(view.create).toHaveBeenCalledTimes(1));
    expect(oldSignal.aborted).toBe(true);
    await act(async () => finish(new Blob(["old actor response"])));
    expect(view.create).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:avatar-a");
    view.unmount();
    expect(view.revoke).toHaveBeenCalledWith("blob:avatar-a");
  });
});
