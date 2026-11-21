/** Route username recovery through the alias resolver without touching SDK PKCE storage. */
export function recoveryFetch(baseUrl: string, nativeFetch: typeof fetch): typeof fetch {
    const base = baseUrl.replace(/\/$/, "");
    return async (input, init) => {
        const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const url = new URL(requestUrl);
        if (method !== "POST" || url.origin + url.pathname !== `${base}/auth/v1/recover`)
            return nativeFetch(input, init);
        const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : null);
        let body: Record<string, unknown>;
        try {
            body = JSON.parse(String(raw)) as Record<string, unknown>;
        } catch {
            return nativeFetch(input, init);
        }
        const identifier = body.email;
        if (typeof identifier !== "string" || identifier.includes("@"))
            return nativeFetch(input, init);
        const response = await nativeFetch(`${base}/functions/v1/human-recovery`, {
            method: "POST",
            headers: init?.headers ?? (input instanceof Request ? input.headers : undefined),
            body: JSON.stringify({
                username: identifier,
                code_challenge: body.code_challenge,
                code_challenge_method: body.code_challenge_method,
                redirect_to: url.searchParams.get("redirect_to"),
            }),
        });
        if (!response.ok) return response;
        return new Response("{}", {
            status: 200,
            headers: {"Content-Type": "application/json", "Cache-Control": "no-store"},
        });
    };
}
