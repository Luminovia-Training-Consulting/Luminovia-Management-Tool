/** Select the expected one-use action from a message in the fictional Mailpit rehearsal. */
import assert from "node:assert/strict";

/**
 * Newer templates also link to the sign-in page. The verifier uses only the
 * action for the owned stack and refuses missing, foreign or ambiguous actions.
 */
export function academyAuthMailLink(html, origin, pathname, type, tokenParam) {
  const links = [...html.matchAll(/href="([^"]+)"/g)]
    .map(([, href]) => href.replaceAll("&amp;", "&"))
    .filter((href) => URL.canParse(href))
    .map((href) => new URL(href))
    .filter(
      (url) =>
        url.origin === origin &&
        url.pathname === pathname &&
        !url.username &&
        !url.password &&
        url.searchParams.getAll("type").length === 1 &&
        url.searchParams.get("type") === type &&
        url.searchParams.getAll(tokenParam).length === 1 &&
        url.searchParams.get(tokenParam),
    );
  assert.equal(links.length, 1, "Expected exactly one local Auth action link.");
  return links[0];
}
