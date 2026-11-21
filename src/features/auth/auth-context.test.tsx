/**
 * Regressions for initial-session/Auth-event ordering and clearing another actor's cached data.
 * SDK fixtures test ordering; actual Auth/RLS/browser acceptance remains separate.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { AuthProvider, useAuth } from "./auth-context";

const { auth } = vi.hoisted(() => ({
  auth: { onAuthStateChange: vi.fn(), getSession: vi.fn() },
}));
vi.mock("../../lib/supabase", () => ({ supabase: { auth } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Expose the actual Auth context state to the assertions. */
function State() {
  const state = useAuth();
  return (
    <p>
      {state.loading
        ? "loading"
        : state.error
          ? "error"
          : (state.session?.user.id ?? "signed out")}
    </p>
  );
}

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup() {
  let callback!: (event: AuthChangeEvent, session: Session | null) => void;
  let resolve!: (value: {
    data: { session: Session | null };
    error: unknown;
  }) => void;
  let reject!: (reason: Error) => void;
  auth.onAuthStateChange.mockImplementation((next) => {
    callback = next;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  auth.getSession.mockReturnValue(
    new Promise((done, fail) => {
      resolve = done;
      reject = fail;
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <State />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return {
    callback: (event: AuthChangeEvent, session: Session | null) =>
      callback(event, session),
    resolve,
    reject,
    client,
  };
}

const session = (id: string) => ({ user: { id } }) as Session;
describe("authoritative auth events and delayed initial sessions", () => {
  it("does not restore a stale initial session after a newer sign-out", async () => {
    const state = setup();
    await act(async () => {
      state.callback("SIGNED_IN", session("actor-a"));
      state.callback("SIGNED_OUT", null);
      state.resolve({ data: { session: session("actor-a") }, error: null });
    });
    expect(screen.getByText("signed out")).toBeInTheDocument();
  });
  it("keeps the newest actor and clears the previous actor private queries before rendering", async () => {
    const state = setup();
    await act(async () => state.callback("SIGNED_IN", session("actor-a")));
    state.client.setQueryData(["private", "actor-a"], "private actor A record");
    await act(async () => {
      state.callback("SIGNED_IN", session("actor-b"));
      state.resolve({ data: { session: session("actor-a") }, error: null });
    });
    expect(screen.getByText("actor-b")).toBeInTheDocument();
    expect(state.client.getQueryData(["private", "actor-a"])).toBeUndefined();
  });
  it("clears data from another assurance level while allowing refresh within the same native session", async () => {
    const state = setup();
    const sessionId = "4ccbc483-f8e3-5413-a691-4e5c4be553db";
    const native = (aal: string, exp: number) => ({
      ...session("privileged-actor"),
      access_token: `fixture.${btoa(JSON.stringify({ session_id: sessionId, aal, exp }))}.fixture`,
    });
    const key = ["private", "privileged-actor"];
    await act(async () => state.callback("SIGNED_IN", native("aal2", 1)));
    state.client.setQueryData(key, "verified fixture record");
    await act(async () => state.callback("TOKEN_REFRESHED", native("aal2", 2)));
    expect(state.client.getQueryData(key)).toBe("verified fixture record");
    await act(async () => state.callback("TOKEN_REFRESHED", native("aal1", 3)));
    expect(state.client.getQueryData(key)).toBeUndefined();
  });
  it("surfaces an initial session error when no newer auth event supplies state", async () => {
    const state = setup();
    await act(async () =>
      state.resolve({
        data: { session: null },
        error: new Error("Session storage failed"),
      }),
    );
    expect(screen.getByText("error")).toBeInTheDocument();
  });
  it("handles an initial session promise rejection instead of hanging or rejecting unhandled", async () => {
    const state = setup();
    await act(async () => state.reject(new Error("Storage unavailable")));
    expect(await screen.findByText("error")).toBeInTheDocument();
  });
});
