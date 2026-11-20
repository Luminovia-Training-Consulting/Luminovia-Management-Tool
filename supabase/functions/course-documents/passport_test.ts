/** Actual bundled font/PDF rendering verifies localized provenance and bounded
 * pagination; structured assertions do not substitute for final PNG inspection. */
import {passportLines} from "./passport.ts";
import {renderFactPdf} from "./pdf.ts";
import {PDFDocument} from "./vendor/pdf-runtime.js";

const font = await Deno.readFile(
    new URL("./assets/DejaVuSans.ttf", import.meta.url),
);
export const passportFixture = {
    issued_at: "2026-11-16T04:50:00Z",
    hash: "a".repeat(64),
    data: {
        type: "qualification_passport",
        locale: "de",
        issued_at: "2026-11-16T04:50:00Z",
        display_name: "Fictional Müller - Μαρία - Мария",
        time_zone: "Europe/Berlin",
        self_declared: {
            country: "Deutschland",
            languages: ["Deutsch", "English"],
            teaching_experience:
                "Eigene Lehrerfahrung; kein automatisch erzeugter Bildungsabschluss.",
        },
        qualifications: [
            {
                label_de: "Linux Administration",
                label_en: "Linux administration",
                status: "verified",
                valid_until: "2027-11-16T12:00:00Z",
                record_version: 3,
                current_evidence_status: "available",
                current_evidence: {
                    name: "Fictional-Zertifikat.pdf",
                    version: 2,
                    sha256: "b".repeat(64),
                    bound_at: "2026-11-01T10:00:00Z",
                },
                attestation: {
                    at: "2026-11-02T10:00:00Z",
                    basis: "document_evidence",
                    verified: true,
                    evidence_sha256: "b".repeat(64),
                    evidence_withdrawn: false,
                },
            },
            {
                label_de: "Historisches Fachgebiet",
                label_en: "Historical expertise",
                status: "expired",
                valid_until: "2025-01-01T00:00:00Z",
                record_version: 0,
                current_evidence_status: "none",
                current_evidence: null,
                attestation: null,
            },
            {
                label_de: "Eigene Auswahl",
                label_en: "Own selection",
                status: "unverified",
                valid_until: null,
                record_version: 0,
                current_evidence_status: "none",
                current_evidence: null,
                attestation: null,
            },
        ],
    },
};

function assert(value: unknown): asserts value {
    if (!value) throw new Error("Passport assertion failed");
}

Deno.test("localized own passport preserves explicit states/provenance and renders deterministic Unicode PDF", async () => {
    const lines = passportLines(passportFixture).join("\n");
    for (
        const value of [
        "Geprüft",
        "Ungeprüft",
        "Abgelaufen",
        "Keine aktuelle Bindung",
        "Historischer Nachweis-Hash",
        "keine digitale Signatur",
    ]
        ) assert(lines.includes(value));
    const first = await renderFactPdf(
        "qualification_passport",
        passportFixture,
        font,
    );
    const second = await renderFactPdf(
        "qualification_passport",
        passportFixture,
        font,
    );
    assert(
        first.length > 10000 && first.length === second.length &&
        first.every((value, index) => value === second[index]),
    );
    const pdf = await PDFDocument.load(first);
    assert(pdf.getPageCount() >= 2 && pdf.getTitle() === "Qualifikationspass");
    const english = {
        ...passportFixture,
        data: {...passportFixture.data, locale: "en"},
    };
    assert(
        passportLines(english).some((line) =>
            line.includes("Historical attestation basis")
        ),
    );
    assert(
        (await PDFDocument.load(
            await renderFactPdf("qualification_passport", english, font),
        )).getTitle() === "Qualification passport",
    );
});
Deno.test("passport never renders arbitrary nested private fields and long facts paginate", async () => {
    const facts = {
        ...passportFixture,
        data: {
            ...passportFixture.data,
            object_path: "PRIVATE-PATH",
            certificate_bytes: "PRIVATE-BYTES",
            qualifications: Array.from(
                {length: 60},
                () => passportFixture.data.qualifications[0],
            ),
        },
    };
    assert(!passportLines(facts).join("\n").includes("PRIVATE"));
    assert(
        (await PDFDocument.load(
            await renderFactPdf("qualification_passport", facts, font),
        )).getPageCount() > 10,
    );
});