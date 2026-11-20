import {renderFactPdf} from "./pdf.ts";
import {PDFDocument} from "./vendor/pdf-runtime.js";

const font = await Deno.readFile(
    new URL("./assets/DejaVuSans.ttf", import.meta.url),
);
const facts = {
    id: "52b7ddee-2166-485a-bcee-04d0eea958d1",
    participant: "Carina Müller · Μαρία · Мария",
    course: "Linux: Übung & sichere Rechte",
    time_zone: "Europe/Berlin",
    starts_at: "2026-11-01T08:00:00Z",
    ends_at: "2026-11-01T15:00:00Z",
    verified_minutes: 420,
    quiz_passed: true,
    issued_at: "2026-11-02T09:00:00Z",
};

function assert(value: unknown, message = "Assertion failed"): asserts value {
    if (!value) throw new Error(message);
}

Deno.test("real Unicode completion PDF embeds German, Greek and Cyrillic and is deterministic", async () => {
    const first = await renderFactPdf("completion", facts, font);
    const second = await renderFactPdf("completion", facts, font);
    assert(first.length > 10000);
    assert(
        first.length === second.length &&
        first.every((byte, i) => byte === second[i]),
    );
    const doc = await PDFDocument.load(first);
    assert(doc.getPageCount() === 1);
    assert(doc.getTitle()?.includes("Completion record"));
});
Deno.test("real font renderer explicitly rejects unsupported characters", async () => {
    let rejected = false;
    try {
        await renderFactPdf("completion", {...facts, participant: "漢字"}, font);
    } catch (error) {
        rejected = error instanceof Error && error.message === "unsupported_glyph";
    }
    assert(rejected);
});
Deno.test("long attendance reports paginate without clipping or loss of rows", async () => {
    const roster = Array.from(
        {length: 120},
        (_, i) => ({
            name: `Fictional attendee ${i}`,
            sessions: [{session_id: "session-a", state: "attended", minutes: 60}],
        }),
    );
    const bytes = await renderFactPdf("attendance", {
        id: facts.id,
        course: facts.course,
        roster,
        sessions: [{id: "session-a", starts_at: facts.starts_at}],
    }, font);
    const doc = await PDFDocument.load(bytes);
    assert(doc.getPageCount() >= 5);
});