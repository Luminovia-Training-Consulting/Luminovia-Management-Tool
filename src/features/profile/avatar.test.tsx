/**
 * Regressions for identity-bound avatar bytes, offline state and object-URL lifetime. Controlled
 * transports do not replace real avatar authorization.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Avatar, AvatarEditor } from "./avatar";

const { state, readAvatar } = vi.hoisted(() => ({
  state: {
    actor: "actor-a",
    online: true,
    canView: true,
    ownVersion: "actor-a" as string | null,
    selection: vi.fn(),
    selectAvatar: vi.fn(async (versionId: string | null) => {
      state.ownVersion = versionId;
    }),
  },
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
    queryFn: async () => {
      state.selection();
      const version_id = target === actor ? state.ownVersion : actor;
      return state.canView && version_id ? { version_id } : null;
    },
    gcTime: 0,
  }),
  readAvatar,
  prepareAvatar: vi.fn(),
  selectAvatar: state.selectAvatar,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  state.actor = "actor-a";
  state.online = true;
  state.canView = true;
  state.ownVersion = "actor-a";
  vi.useRealTimers();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
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
    expect(readAvatar).toHaveBeenCalledWith(
      "teacher",
      "actor-a",
      expect.any(AbortSignal),
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
      .mockImplementationOnce((_target, _version, signal) => {
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
  it("revalidates selection on focus without downloading the same immutable avatar again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    readAvatar.mockResolvedValue(new Blob(["same exact clean version"]));
    const view = setup();
    await waitFor(() => expect(view.create).toHaveBeenCalledTimes(1));
    focusManager.setFocused(false);
    vi.setSystemTime(Date.now() + 31000);
    await act(async () => focusManager.setFocused(true));
    await waitFor(() => expect(state.selection).toHaveBeenCalledTimes(2));
    expect(readAvatar).toHaveBeenCalledTimes(1);
    state.canView = false;
    focusManager.setFocused(false);
    vi.setSystemTime(Date.now() + 31000);
    await act(async () => focusManager.setFocused(true));
    await waitFor(() =>
      expect(view.revoke).toHaveBeenCalledWith("blob:avatar-a"),
    );
    expect(screen.getByRole("img")).not.toHaveAttribute("src");
    expect(readAvatar).toHaveBeenCalledTimes(1);
  });
  it("revalidates revoked selection on reconnect while retaining the no-private-offline-URL guard", async () => {
    readAvatar.mockResolvedValue(new Blob(["same exact clean version"]));
    const view = setup();
    await waitFor(() => expect(view.create).toHaveBeenCalledTimes(1));
    state.online = false;
    onlineManager.setOnline(false);
    view.update();
    expect(screen.getByRole("img")).not.toHaveAttribute("src");
    state.canView = false;
    state.online = true;
    await act(async () => {
      view.update();
      onlineManager.setOnline(true);
    });
    await waitFor(() =>
      expect(state.selection.mock.calls.length).toBeGreaterThan(1),
    );
    expect(screen.getByRole("img")).not.toHaveAttribute("src");
    expect(readAvatar).toHaveBeenCalledTimes(1);
  });
  it("updates only the own avatar selection and leaves another profile's active image cache intact", async () => {
    readAvatar.mockResolvedValue(new Blob(["private image"]));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <Avatar userId="teacher" name="Fictional Teacher" />
        <AvatarEditor name="Fictional Teacher" />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(readAvatar).toHaveBeenCalledTimes(2));
    const teacherImage = client.getQueryCache().find({
      queryKey: ["avatar-image", "actor-a", "teacher", "actor-a"],
    });
    const ownImage = client.getQueryCache().find({
      queryKey: ["avatar-image", "actor-a", "actor-a", "actor-a"],
    });
    expect(teacherImage).toBeDefined();
    expect(ownImage).toBeDefined();

    await act(async () => {
      screen.getByRole("button", { name: "Profilbild entfernen" }).click();
    });
    await waitFor(() => expect(state.selectAvatar).toHaveBeenCalledWith(null));
    await waitFor(() =>
      expect(
        client.getQueryCache().find({
          queryKey: ["avatar-image", "actor-a", "teacher", "actor-a"],
        }),
      ).toBeDefined(),
    );
    expect(
      client.getQueryCache().find({
        queryKey: ["avatar-image", "actor-a", "actor-a", "actor-a"],
      }),
    ).toBeUndefined();
  });
});
