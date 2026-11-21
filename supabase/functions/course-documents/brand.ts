/** Accept presentation only from the server's authorised course facts. */
type AcademyPdfBrand = {
    name: string;
    short_name: string;
    theme_color: string;
};

const safeText = (value: unknown, limit: number): value is string =>
    typeof value === "string" && value.trim() === value && value.length >= 1 &&
    [...value].length <= limit && /^[^\p{Cc}\p{Cf}<>]+$/u.test(value);

export function academyPdfBrand(
    kind: string,
    facts: Record<string, unknown>,
): AcademyPdfBrand | undefined {
    if (!["attendance", "completion"].includes(kind) || !Object.hasOwn(facts, "academy_pdf_brand")) {
        return;
    }
    const value = facts.academy_pdf_brand;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("invalid_document_brand");
    }
    const {name, short_name, theme_color} = value as Record<string, unknown>;
    if (
        !safeText(name, 72) || !safeText(short_name, 20) ||
        typeof theme_color !== "string" || !/^#[0-9a-f]{6}$/.test(theme_color)
    ) {
        throw new Error("invalid_document_brand");
    }
    return {
        name: name.normalize("NFC"),
        short_name: short_name.normalize("NFC"),
        theme_color,
    };
}
