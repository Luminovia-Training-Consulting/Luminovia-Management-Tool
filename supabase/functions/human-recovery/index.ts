/** Retired alias recovery endpoint. Continue recovery through native email Auth. */
Deno.serve(() => Response.json(
  { error: "email_recovery_required" },
  { status: 410, headers: { "Cache-Control": "no-store" } },
));
