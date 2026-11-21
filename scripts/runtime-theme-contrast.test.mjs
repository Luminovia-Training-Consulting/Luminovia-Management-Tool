/** Protect the original seven light-brand values and WCAG contrast for shared light/dark status tokens. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const styles = readFileSync(
    fileURLToPath(new URL("../src/styles.css", import.meta.url)),
    "utf8",
);

/** Decode one CSS six-digit hex color into linear-light RGB channels. */
function linearColor(hex) {
    assert.match(hex, /^#[0-9a-f]{6}$/i);
    return [1, 3, 5].map((index) => {
        const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
        return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
    });
}

/** Calculate WCAG relative contrast for the specified foreground/background pair. */
function contrast(foreground, background) {
    const luminance = (color) => {
        const [red, green, blue] = linearColor(color);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const values = [luminance(foreground), luminance(background)].sort(
        (first, second) => second - first,
    );
    return (values[0] + 0.05) / (values[1] + 0.05);
}

/** Parse only the two global token blocks, avoiding component overrides. */
function tokenBlock(selector) {
    const start = styles.indexOf(selector);
    assert.notEqual(start, -1, `Missing theme block ${selector}`);
    const end = styles.indexOf("\n}", start);
    assert.notEqual(end, -1, `Unterminated theme block ${selector}`);
    const tokens = {};
    for (const match of styles.slice(start, end).matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi))
        tokens[match[1]] = match[2].toLowerCase();
    return tokens;
}

const light = tokenBlock(":root {"),
    dark = tokenBlock(':root[data-theme="dark"]');

const officialLight = {
    brand: "#1749b5",
    coral: "#ffae9a",
    peach: "#ffc68e",
    yellow: "#ffdb76",
    mint: "#b8edd9",
    indigo: "#7d88d8",
    lilac: "#ded2fa",
};

for (const [name, value] of Object.entries(officialLight))
    assert.equal(light[name], value, `The approved light ${name} was changed.`);

for (const [theme, tokens] of [
    ["light", light],
    ["dark", {...light, ...dark}],
]) {
    assert(contrast(tokens.ink, tokens.paper) >= 7, `${theme} body/paper contrast`);
    assert(contrast(tokens.ink, tokens.surface) >= 7, `${theme} body/surface contrast`);
    assert(contrast(tokens.ink, tokens["surface-raised"]) >= 7, `${theme} raised action contrast`);
    assert(contrast(tokens.ink, tokens["surface-muted"]) >= 7, `${theme} input contrast`);
    assert(contrast(tokens.muted, tokens.paper) >= 4.5, `${theme} muted text contrast`);
    assert(contrast(tokens.brand, tokens.paper) >= 3, `${theme} focus/accent contrast`);
    for (const pair of [
        ["status-success-ink", "status-success-surface"],
        ["status-warning-ink", "status-warning-surface"],
        ["status-danger-ink", "status-danger-surface"],
        ["status-paid-ink", "status-paid-surface"],
        ["notice-success-ink", "notice-success-surface"],
        ["notice-error-ink", "notice-error-surface"],
        ["status-published-ink", "status-published-surface"],
        ["status-filled-ink", "status-filled-surface"],
        ["status-draft-ink", "status-draft-surface"],
        ["status-archived-ink", "status-archived-surface"],
    ])
        assert(
            contrast(tokens[pair[0]], tokens[pair[1]]) >= 4.5,
            `${theme} ${pair[0]} contrast`,
        );
}

assert.match(styles, /\[data-theme="dark"\]\s+\.button-primary\s*\{[^}]*\bcolor:\s*#102345\s*;/);
assert(contrast("#102345", dark.brand) >= 4.5);