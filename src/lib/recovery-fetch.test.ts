import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { recoveryFetch } from "./recovery-fetch";

describe("native PKCE username recovery", () => {
  it("retains the SDK verifier for a subsequent one-time code exchange", async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const native = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        calls.push({ url, body });
        if (url.endsWith("/functions/v1/human-recovery"))
          return new Response("{}", {
            status: 202,
            headers: { "Content-Type": "application/json" },
          });
        if (url.includes("/auth/v1/token?grant_type=pkce"))
          return new Response(
            JSON.stringify({
              access_token: "access",
              refresh_token: "refresh",
              expires_in: 3600,
              token_type: "bearer",
              user: {
                id: "11111111-1111-4111-8111-111111111111",
                app_metadata: {},
                user_metadata: {},
                aud: "authenticated",
                created_at: new Date().toISOString(),
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        throw Error(`Unexpected ${url}`);
      },
    );
    const client = createClient(
      "https://backend.example.invalid",
      "publishable-test",
      {
        auth: {
          flowType: "pkce",
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: recoveryFetch("https://backend.example.invalid", native),
        },
      },
    );
    const reset = await client.auth.resetPasswordForEmail("course.lead", {
      redirectTo: "https://portal.example.invalid/auth/callback",
    });
    expect(reset.error).toBeNull();
    expect(calls[0].url).toBe(
      "https://backend.example.invalid/functions/v1/human-recovery",
    );
    expect(calls[0].body).toMatchObject({
      username: "course.lead",
      code_challenge_method: "s256",
      redirect_to: "https://portal.example.invalid/auth/callback",
    });
    const challenge = String(calls[0].body.code_challenge);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const exchange = await client.auth.exchangeCodeForSession(
      "fictional-one-time-code",
    );
    expect(exchange.error).toBeNull();
    const verifier = String(
      calls[1].body.auth_code ? calls[1].body.code_verifier : "",
    );
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const actual = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(actual).toBe(challenge);
  });
  it("keeps email recovery on GoTrue without alias forwarding", async () => {
    const native = vi.fn(async (...args: [RequestInfo | URL, RequestInit?]) => {
      expect(args.length).toBeGreaterThan(0);
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const client = createClient(
      "https://backend.example.invalid",
      "publishable-test",
      {
        auth: {
          flowType: "pkce",
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: recoveryFetch("https://backend.example.invalid", native),
        },
      },
    );
    const result = await client.auth.resetPasswordForEmail(
      "lead@example.invalid",
    );
    expect(result.error).toBeNull();
    expect(String(native.mock.calls[0][0])).toContain("/auth/v1/recover");
  });
});
